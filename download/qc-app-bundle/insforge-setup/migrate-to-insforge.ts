/**
 * ============================================================
 * Migrasi SQLite → InsForge (PostgreSQL)
 * ============================================================
 * Script ini membaca data dari custom.db (SQLite lokal) dan
 * memasukkannya ke database InsForge (PostgreSQL) via Prisma.
 *
 * PRASYARAT:
 * 1. Ganti prisma/schema.prisma dengan file schema.postgresql.prisma
 * 2. Set DATABASE_URL di .env dengan connection string InsForge
 *    Contoh: DATABASE_URL="postgresql://user:pass@db.xxx.insforge.dev:5432/postgres?sslmode=require"
 * 3. Jalankan: bunx prisma generate
 * 4. Jalankan: bunx prisma db push   (buat 23 tabel di InsForge)
 * 5. Baru jalankan script ini: bun run migrate-to-insforge.ts
 *
 * CARA PAKAI:
 *   bun run migrate-to-insforge.ts
 *
 * CATATAN:
 * - Script ini aman dijalankan ulang (skipDuplicates: true)
 * - Jika ada error type mismatch, edit schema.prisma sesuai pesan error
 * ============================================================
 */

import { db } from "../src/lib/db";

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

async function migrate() {
  console.log("🚀 Memulai migrasi SQLite → InsForge (PostgreSQL)...\n");
  console.log("⚠️  PASTIKAN SEBELUM MENJALANKAN SCRIPT INI:");
  console.log("   1. prisma/schema.prisma sudah diganti dengan schema.postgresql.prisma");
  console.log("   2. .env sudah berisi DATABASE_URL InsForge");
  console.log("   3. 'bunx prisma generate' sudah dijalankan");
  console.log("   4. 'bunx prisma db push' sudah dijalankan (tabel sudah dibuat)\n");

  // Test koneksi dulu
  try {
    await db.$queryRaw`SELECT 1`;
    console.log("✅ Koneksi ke InsForge berhasil!\n");
  } catch (e: any) {
    console.error("❌ Gagal konek ke InsForge:", e.message);
    console.error("\n   Cek:");
    console.error("   - DATABASE_URL sudah benar?");
    console.error("   - ?sslmode=require sudah ditambahkan?");
    console.error("   - Karakter khusus di password sudah di-URL encode?");
    process.exit(1);
  }

  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const table of tables) {
    try {
      // @ts-expect-error dynamic table access
      const rows = await db[table].findMany();
      if (rows.length === 0) {
        console.log(`⏭️  ${table.padEnd(20)} 0 rows (skip)`);
        continue;
      }

      // PostgreSQL mendukung createMany
      // @ts-expect-error dynamic table access
      const result = await db[table].createMany({
        data: rows,
        skipDuplicates: true,
      });
      const inserted = result.count;
      const skipped = rows.length - inserted;
      console.log(
        `✅ ${table.padEnd(20)} ${inserted}/${rows.length} rows migrated` +
          (skipped > 0 ? ` (${skipped} duplicates skipped)` : "")
      );
      totalMigrated += inserted;
      totalSkipped += skipped;
    } catch (e: any) {
      console.error(`❌ ${table.padEnd(20)} ERROR: ${e.message}`);
      totalErrors++;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 RINGKASAN MIGRASI:`);
  console.log(`   ✅ Total rows berhasil: ${totalMigrated}`);
  console.log(`   ⏭️  Total duplicates skip: ${totalSkipped}`);
  console.log(`   ❌ Total errors: ${totalErrors}`);
  console.log(`${"=".repeat(60)}`);

  if (totalErrors > 0) {
    console.log("\n⚠️  Beberapa tabel gagal. Cek error di atas.");
    console.log("   Penyebab umum:");
    console.log("   - Data terlalu panjang untuk varchar (tambahkan @db.Text di schema)");
    console.log("   - DateTime format tidak valid");
    console.log("   - Foreign key constraint (urutan insert salah)");
    console.log("\n   Tips: jalankan ulang script ini setelah perbaikan");
  } else if (totalMigrated > 0) {
    console.log("\n🎉 Migrasi selesai! Verifikasi via Prisma Studio:");
    console.log("   bunx prisma studio");
    console.log("   (akan buka http://localhost:5555)");
  } else {
    console.log("\n⚠️  Tidak ada data yang dimigrasi. Mungkin database sudah kosong?");
  }

  await db.$disconnect();
  process.exit(totalErrors > 0 ? 1 : 0);
}

migrate().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
