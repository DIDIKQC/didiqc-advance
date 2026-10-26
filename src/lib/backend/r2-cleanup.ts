// ============================================================
// r2-cleanup.ts — pembersih file fisik di Cloudflare R2 folder
// "file_image_didiqc" saat gambar/file DIHAPUS atau DIGANTI.
//
// Prinsip:
// - Database hanya menyimpan URL metadata (/api/files/file_image_didiqc/...).
// - Ketika record disimpan dengan gambar yang dihapus/diganti, file lama
//   di R2 ikut dihapus supaya bucket tidak menumpuk file yatim (orphan).
// - Hanya URL milik R2 (prefix file_image_didiqc) yang dihapus —
//   data URL, /uploads/, dan URL eksternal diabaikan.
// - TIDAK PERNAH melempar error: kegagalan hapus file tidak boleh
//   menggagalkan operasi utama (save/delete record). Hanya di-log.
// ============================================================

import { extractR2KeyFromUrl, r2DeleteFile } from "@/lib/r2";

async function deleteKeys(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const results = await Promise.allSettled(keys.map((k) => r2DeleteFile(k)));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error("[r2-cleanup] gagal hapus:", keys[i], r.reason?.message);
    }
  });
}

/**
 * Hapus file R2 lama yang TIDAK lagi direferensikan setelah update.
 * Dipakai pada alur "ganti gambar" / "hapus gambar lalu simpan".
 *
 * Contoh: oldUrls=["...a.jpg"], newUrls=["...b.jpg"] → a.jpg dihapus.
 *         oldUrls=["...a.jpg"], newUrls=[]          → a.jpg dihapus.
 *         oldUrls=["...a.jpg"], newUrls=["...a.jpg"] → tidak ada yang dihapus.
 */
export async function cleanupReplacedR2Files(
  oldUrls: Array<string | null | undefined>,
  newUrls: Array<string | null | undefined>
): Promise<void> {
  try {
    const newKeys = new Set<string>();
    for (const u of newUrls) {
      const k = extractR2KeyFromUrl(String(u || ""));
      if (k) newKeys.add(k);
    }
    const toDelete: string[] = [];
    for (const u of oldUrls) {
      const key = extractR2KeyFromUrl(String(u || ""));
      if (!key) continue;
      if (newKeys.has(key)) continue; // masih direferensikan
      toDelete.push(key);
    }
    if (toDelete.length) {
      console.log(
        "[r2-cleanup] hapus file lama (ganti/hapus gambar):",
        toDelete.join(", ")
      );
      await deleteKeys(toDelete);
    }
  } catch (e: any) {
    console.error("[r2-cleanup] cleanupReplacedR2Files error:", e?.message);
  }
}

/**
 * Hapus semua file R2 yang direferensikan daftar URL.
 * Dipakai pada alur "hapus record" (record + file fisiknya ikut hilang).
 */
export async function deleteR2FilesByUrls(
  urls: Array<string | null | undefined>
): Promise<void> {
  try {
    const keys: string[] = [];
    for (const u of urls) {
      const k = extractR2KeyFromUrl(String(u || ""));
      if (k) keys.push(k);
    }
    if (keys.length) {
      console.log("[r2-cleanup] hapus file (hapus record):", keys.join(", "));
      await deleteKeys(keys);
    }
  } catch (e: any) {
    console.error("[r2-cleanup] deleteR2FilesByUrls error:", e?.message);
  }
}
