// ============================================================
// /api/files/[...key] — tampilkan / download file dari Cloudflare R2
//
// Contoh URL tersimpan di database (metadata saja):
//   /api/files/file_image_didiqc/<owner>/equipment/<stamp>-<rand>-foto.jpg
//
// - Auth wajib (session cookie). User hanya dapat mengakses file miliknya;
//   superadmin (termasuk mode View-As) dapat mengakses semua.
// - Cache browser agresif (immutable) karena key unik per upload →
//   foto/dokumen tampil cepat pada pembukaan berikutnya.
// - ?download=1 untuk memaksa download (Content-Disposition: attachment).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  r2GetFile,
  parseFileKey,
  canAccessFile,
  contentDisposition,
} from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ key: string[] }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { key: keySegments } = await ctx.params;
    const parsed = parseFileKey(keySegments || []);
    if (!parsed.ok || !parsed.key) {
      return NextResponse.json(
        { error: parsed.msg || "Path tidak valid" },
        { status: 400 }
      );
    }

    if (!canAccessFile(session, parsed.owner || "")) {
      return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
    }

    const file = await r2GetFile(parsed.key);
    if (!file) {
      return NextResponse.json(
        { error: "File tidak ditemukan" },
        { status: 404 }
      );
    }

    const fileName = parsed.key.split("/").pop() || "file";
    const download = req.nextUrl.searchParams.get("download") === "1";
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    const type =
      file.contentType && file.contentType !== "application/octet-stream"
        ? file.contentType
        : EXT_MIME[ext] || "application/octet-stream";

    return new NextResponse(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Length": String(file.body.length),
        // Key unik per upload → konten immutable → cache browser maksimal
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": contentDisposition(fileName, download),
      },
    });
  } catch (e: any) {
    console.error("[files] error:", e?.message);
    return NextResponse.json(
      { error: e?.message || "Gagal memuat file" },
      { status: 500 }
    );
  }
}

// Ekstensi → MIME (fallback bila R2 tidak mengirim content-type)
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
};
