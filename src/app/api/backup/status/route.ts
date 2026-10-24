// ============================================================
// /api/backup/status — Status & daftar backup DIDIQC dari Cloudflare R2
//
// HANYA untuk superadmin (session aktif, bukan akun password tambahan).
// Read-only: membaca status JSON dan daftar object di prefix backup.
// Tidak pernah mengunggah/menghapus apa pun dari route ini.
//
// Environment (server-only, tidak pernah ke frontend):
//   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PREFIX
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETENTION_KEEP_DEFAULT = 15;

function r2Config() {
  const endpoint = process.env.R2_ENDPOINT || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";
  const bucket = process.env.R2_BUCKET || "didikqc";
  const prefix = process.env.R2_PREFIX || "database_didiqc";
  const configured = Boolean(endpoint && accessKeyId && secretAccessKey && bucket);
  return { endpoint, accessKeyId, secretAccessKey, bucket, prefix, configured };
}

interface BackupItem {
  key: string;
  fileName: string;
  date: string; // WIB dari nama file
  sizeBytes: number;
  lastModified: string | null;
}

export async function GET(_req: NextRequest) {
  // ---- Auth: superadmin saja ----
  const auth = await getSessionUser();
  if (!auth || auth.session.isSecondary) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Login sebagai superadmin." },
      { status: 401 }
    );
  }
  if (auth.session.role !== "superadmin" || auth.user.role !== "superadmin") {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN", message: "Akses khusus superadmin." },
      { status: 403 }
    );
  }

  const cfg = r2Config();
  if (!cfg.configured) {
    return NextResponse.json({
      ok: true,
      configured: false,
      message:
        "Environment R2 belum diset di server (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET). Set di Vercel → Settings → Environment Variables.",
      backups: [] as BackupItem[],
      retentionKeep: RETENTION_KEEP_DEFAULT,
    });
  }

  try {
    const client = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });

    // ---- Daftar semua object di prefix ----
    const listed: { Key: string; Size: number; LastModified?: Date }[] = [];
    let token: string | undefined = undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucket,
          Prefix: `${cfg.prefix}/`,
          ContinuationToken: token,
        })
      );
      for (const o of res.Contents || []) {
        if (o.Key) listed.push({ Key: o.Key, Size: o.Size ?? 0, LastModified: o.LastModified });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    // ---- Backup harian ----
    const dailyRe = new RegExp(`^${cfg.prefix}/didiqc_(\\d{4}-\\d{2}-\\d{2})_(\\d{6})\\.dump$`);
    const backups: BackupItem[] = listed
      .filter((o) => dailyRe.test(o.Key))
      .map((o) => {
        const m = o.Key.match(dailyRe)!;
        return {
          key: o.Key,
          fileName: o.Key.split("/").pop() || o.Key,
          date: `${m[1]} ${m[2].replace(/(\d{2})(\d{2})(\d{2})$/, "$1:$2:$3")} WIB`,
          sizeBytes: o.Size,
          lastModified: o.LastModified ? o.LastModified.toISOString() : null,
        };
      })
      .sort((a, b) => b.fileName.localeCompare(a.fileName));

    // ---- Pre-restore safety backups ----
    const preRestore: BackupItem[] = listed
      .filter((o) => new RegExp(`^${cfg.prefix}/pre-restore/pre_restore_.*\\.dump$`).test(o.Key))
      .map((o) => ({
        key: o.Key,
        fileName: o.Key.split("/").pop() || o.Key,
        date: o.LastModified ? o.LastModified.toISOString() : "",
        sizeBytes: o.Size,
        lastModified: o.LastModified ? o.LastModified.toISOString() : null,
      }))
      .sort((a, b) => b.fileName.localeCompare(a.fileName));

    // ---- Status backup terakhir ----
    let status: unknown = null;
    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: cfg.bucket, Key: `${cfg.prefix}/status/backup-status.json` })
      );
      status = JSON.parse((await res.Body?.transformToString()) || "null");
    } catch {
      status = null;
    }

    // ---- Presigned URL unduh (15 menit) untuk file backup ----
    const withUrl: (BackupItem & { downloadUrl?: string })[] = [];
    for (const b of backups) {
      let downloadUrl: string | undefined;
      try {
        downloadUrl = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: cfg.bucket, Key: b.key }),
          { expiresIn: 900 }
        );
      } catch {
        downloadUrl = undefined;
      }
      withUrl.push({ ...b, downloadUrl });
    }

    return NextResponse.json({
      ok: true,
      configured: true,
      bucket: cfg.bucket,
      prefix: cfg.prefix,
      retentionKeep: Number(process.env.RETENTION_KEEP || RETENTION_KEEP_DEFAULT),
      status,
      backups: withUrl,
      preRestore,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: "R2_ERROR", message },
      { status: 502 }
    );
  }
}
