// ============================================================
// r2.ts — Cloudflare R2 (S3-compatible) file storage helper
//
// Dipakai oleh /api/upload (simpan file) dan /api/files/[...key] (tampil/download).
// Prinsip: DATABASE hanya menyimpan metadata/lokasi (URL object) — isi file
// disimpan di bucket R2 pada folder "file_image_didiqc".
//
// Environment variables (sama dengan sistem Backup — lihat docs/BACKUP-RESTORE.md):
//   R2_ENDPOINT         https://<ACCOUNT_ID>.r2.cloudflarestorage.com
//   R2_ACCESS_KEY_ID    R2 access key
//   R2_SECRET_ACCESS_KEY R2 secret key
//   R2_BUCKET           nama bucket (default: didikqc)
//   R2_FILE_PREFIX      folder penyimpanan file/gambar (default: file_image_didiqc)
// ============================================================

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const FILE_PREFIX = process.env.R2_FILE_PREFIX || "file_image_didiqc";

let _client: S3Client | null = null;

function getS3(): S3Client | null {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  if (_client) return _client;
  let endpoint = process.env.R2_ENDPOINT || "";
  if (!endpoint && process.env.R2_ACCOUNT_ID) {
    endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }
  if (!endpoint) return null;
  _client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

export function r2Configured(): boolean {
  return getS3() !== null && !!process.env.R2_BUCKET;
}

export function r2FilePrefix(): string {
  return FILE_PREFIX;
}

/** Sanitasi nama file: buang karakter berbahaya, pertahankan ekstensi. */
export function sanitizeFileName(name: string): string {
  const base = String(name || "file")
    // Normalisasi spasi & karakter non-aman
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+/, "")
    .slice(-80); // batasi panjang (sisakan ekstensi)
  return base || `file_${Date.now()}`;
}

export type UploadResult = {
  key: string;
  url: string; // URL relatif untuk akses via /api/files/<key>
  size: number;
  contentType: string;
};

/**
 * Upload file ke R2 pada folder file_image_didiqc/<owner>/<subdir>/
 * key unik per upload (timestamp + random) sehingga aman dari tabrakan
 * dan aman untuk di-cache browser secara permanen (immutable).
 */
export async function r2UploadFile(opts: {
  ownerUsername: string;
  subdir: string;
  fileName: string;
  contentType: string;
  body: Buffer;
}): Promise<UploadResult> {
  const s3 = getS3();
  const bucket = process.env.R2_BUCKET;
  if (!s3 || !bucket) {
    throw new Error(
      "Penyimpanan file (Cloudflare R2) belum dikonfigurasi. Set environment variables R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET."
    );
  }
  const owner = String(opts.ownerUsername || "unknown")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 60);
  const sub = String(opts.subdir || "lainnya")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 40);
  const safeName = sanitizeFileName(opts.fileName);
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "-" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds());
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${FILE_PREFIX}/${owner}/${sub}/${stamp}-${rand}-${safeName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: opts.body,
      ContentType: opts.contentType || "application/octet-stream",
    })
  );

  return {
    key,
    // Metadata/lokasi yang disimpan di database cukup URL relatif ini saja
    url: `/api/files/${key}`,
    size: opts.body.length,
    contentType: opts.contentType || "application/octet-stream",
  };
}

/** Ambil isi file dari R2. Return null bila tidak ditemukan. */
export async function r2GetFile(
  key: string
): Promise<{ body: Buffer; contentType: string } | null> {
  const s3 = getS3();
  const bucket = process.env.R2_BUCKET;
  if (!s3 || !bucket) return null;
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) return null;
    return {
      body: Buffer.from(bytes),
      contentType: res.ContentType || "application/octet-stream",
    };
  } catch (e: any) {
    if (String(e?.name) === "NoSuchKey" || String(e?.$metadata?.httpStatusCode) === "404") {
      return null;
    }
    throw e;
  }
}

/** Validasi key agar hanya mengakses folder file_image_didiqc/<owner>/... */
export function parseFileKey(
  segments: string[]
): { ok: boolean; key?: string; owner?: string; msg?: string } {
  if (!segments || segments.length < 3) {
    return { ok: false, msg: "Path file tidak valid" };
  }
  if (segments[0] !== FILE_PREFIX) {
    return { ok: false, msg: "Folder file tidak diizinkan" };
  }
  const owner = decodeURIComponent(segments[1]);
  const key = segments.map((s) => decodeURIComponent(s)).join("/");
  return { ok: true, key, owner };
}

/** Username aktif pemilik data (mendukung superadmin View-As). */
export function getActiveOwner(session: {
  username: string;
  activeUsername?: string;
} | null): string {
  if (!session) return "unknown";
  return session.activeUsername || session.username;
}

/** Cek apakah user session boleh mengakses file milik `owner`. */
export function canAccessFile(
  session: { username: string; role: string; activeUsername?: string; activeRole?: string } | null,
  owner: string
): boolean {
  if (!session) return false;
  const active = session.activeUsername || session.username;
  // Superadmin boleh akses semua; user biasanya hanya file miliknya sendiri
  if ((session.activeRole || session.role) === "superadmin") return true;
  return active === owner;
}

/** Content-Disposition berdasarkan tipe file & mode (inline vs download). */
export function contentDisposition(fileName: string, download: boolean): string {
  const safe = fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, "'");
  return download
    ? `attachment; filename="${safe}"`
    : `inline; filename="${safe}"`;
}
