/**
 * ============================================================
 * Migrasi dari JSON → InsForge (PostgreSQL) — PALING MUDAH
 * ============================================================
 * Script ini membaca data dari database-export.json (sudah ada
 * di bundle download) dan memasukkannya ke InsForge PostgreSQL.
 *
 * CARA PAKAI:
 *   1. Pastikan .env sudah berisi DATABASE_URL InsForge
 *   2. Pastikan 'bunx prisma db push' sudah dijalankan (tabel sudah ada)
 *   3. Copy database-export.json ke root project
 *   4. Copy file ini ke root project
 *   5. Jalankan: bun run migrate-from-json.ts
 *
 * KEUNGGULAN:
 * - Tidak perlu setup dual database connection
 * - Tidak butuh SQLite file (custom.db)
 * - Bisa dijalankan di environment tanpa akses ke SQLite asli
 * ============================================================
 */

import { db } from "../src/lib/db";
// @ts-expect-error - JSON import tanpa type declaration
import data from "./database-export.json";

async function migrate() {
  console.log("🚀 Migrasi JSON → InsForge (PostgreSQL)...\n");

  // Test koneksi
  try {
    await db.$queryRaw`SELECT 1`;
    console.log("✅ Koneksi ke InsForge berhasil!\n");
  } catch (e: any) {
    console.error("❌ Gagal konek ke InsForge:", e.message);
    console.error("\n   Cek:");
    console.error("   - DATABASE_URL sudah benar?");
    console.error("   - ?sslmode=require sudah ditambahkan?");
    process.exit(1);
  }

  const tables = [
    "Users",
    "Parameters",
    "LotQC",
    "InputQC",
    "HistoriQC",
    "CalculatedStats",
    "BiasPME",
    "DaftarTEa",
    "SigmaCVOpt",
    "LaporanCatatan",
    "TabulasiCatatan",
    "KopSurat",
    "Settings",
    "LogActivity",
    "CatatanDokter",
    "UserPasswords",
    "ImgHemato",
    "ImgUrin",
    "ImgMalaria",
    "ImgBTA",
    "ImgLain",
    "ImgPatologi",
    "Sessions",
  ] as const;

  let totalMigrated = 0;
  let totalErrors = 0;

  for (const table of tables) {
    const rows = (data as any)[table];
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`⏭️  ${table.padEnd(20)} 0 rows (skip)`);
      continue;
    }

    try {
      // @ts-expect-error dynamic table access
      const result = await db[table].createMany({
        data: rows,
        skipDuplicates: true,
      });
      console.log(`✅ ${table.padEnd(20)} ${result.count}/${rows.length} rows migrated`);
      totalMigrated += result.count;
    } catch (e: any) {
      console.error(`❌ ${table.padEnd(20)} ERROR: ${e.message}`);
      totalErrors++;

      // Coba insert satu per satu jika batch gagal
      if (rows.length > 1) {
        console.log(`   Mencoba insert satu per satu...`);
        let success = 0;
        for (const row of rows) {
          try {
            // @ts-expect-error dynamic table access
            await db[table].create({ data: row });
            success++;
          } catch (err) {
            console.error(`   - baris gagal: ${err.message}`);
          }
        }
        console.log(`   ✅ ${success}/${rows.length} berhasil dengan insert satu per satu`);
        totalMigrated += success;
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 RINGKASAN:`);
  console.log(`   Total rows berhasil: ${totalMigrated}`);
  console.log(`   Total errors: ${totalErrors}`);
  console.log(`${"=".repeat(60)}`);

  await db.$disconnect();
  process.exit(totalErrors > 0 ? 1 : 0);
}

migrate().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
