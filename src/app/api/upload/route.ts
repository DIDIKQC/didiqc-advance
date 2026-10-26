// ============================================================
// /api/upload — upload file/gambar ke Cloudflare R2
//
// Folder tujuan: file_image_didiqc/<ownerUsername>/<subdir>/
// Database TIDAK menyimpan isi file — hanya URL/lokasi object
// (return { url: "/api/files/..." }) agar penyimpanan database
// tetap efektif dan efisien.
//
// Auth: session cookie didiqc_session (login wajib).
// Batas ukuran: 5 MB (cukup untuk foto hasil kompresi & dokumen lab).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { r2UploadFile, r2Configured, getActiveOwner } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

// Subfolder yang diizinkan (per submenu aplikasi)
const ALLOWED_SUBDIRS = new Set([
  "hemato",
  "urin",
  "malaria",
  "bta",
  "patologi",
  "lain",
  "equipment",
  "maintenance",
  "kalibrasi",
  "documents",
  "contracts",
  "lainnya",
]);

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!r2Configured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Penyimpanan file (Cloudflare R2) belum dikonfigurasi di server. Hubungi administrator untuk mengisi environment variables R2.",
        },
        { status: 503 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    const subdir = String(form.get("subdir") || "lainnya");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { ok: false, error: "File tidak ditemukan" },
        { status: 400 }
      );
    }
    if (!ALLOWED_SUBDIRS.has(subdir)) {
      return NextResponse.json(
        { ok: false, error: "Subfolder tidak diizinkan" },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { ok: false, error: "Ukuran file maksimal 5MB" },
        { status: 413 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const owner = getActiveOwner(session);

    const result = await r2UploadFile({
      ownerUsername: owner,
      subdir,
      fileName: file.name || "file",
      contentType: file.type || "application/octet-stream",
      body: buf,
    });

    return NextResponse.json({
      ok: true,
      url: result.url,
      key: result.key,
      fileName: file.name || "",
      contentType: result.contentType,
      size: result.size,
    });
  } catch (e: any) {
    console.error("[upload] error:", e?.message);
    return NextResponse.json(
      { ok: false, error: e?.message || "Upload gagal" },
      { status: 500 }
    );
  }
}
