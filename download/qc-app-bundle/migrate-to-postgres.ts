/**
 * ============================================================
 * Migrasi SQLite → PostgreSQL
 * ============================================================
 * Script ini membaca data dari custom.db (SQLite) dan
 * memasukkannya ke PostgreSQL menggunakan Prisma.
 *
 * CARA PAKAI:
 * 1. Edit .env, set DATABASE_URL ke PostgreSQL:
 *    DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require"
 * 2. Jalankan: bunx prisma db push   (buat schema di PostgreSQL)
 * 3. Jalankan script ini: bun run migrate-to-postgres.ts
 *
 * Prasyarat:
 * - Prisma client sudah di-generate (bunx prisma generate)
 * - Schema PostgreSQL sudah dibuat (bunx prisma db push)
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
  console.log("🚀 Memulai migrasi SQLite → PostgreSQL...\n");
  console.log("⚠️  Pastikan:");
  console.log("   1. DATABASE_URL di .env sudah menunjuk ke PostgreSQL");
  console.log("   2. 'bunx prisma db push' sudah dijalankan");
  console.log("   3. 'bunx prisma generate' sudah dijalankan\n");

  let totalMigrated = 0;
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
      await db[table].createMany({ data: rows, skipDuplicates: true });
      console.log(`✅ ${table.padEnd(20)} ${rows.length} rows migrated`);
      totalMigrated += rows.length;
    } catch (e: any) {
      console.error(`❌ ${table.padEnd(20)} ERROR: ${e.message}`);
      totalErrors++;
    }
  }

  console.log(`\n📊 RINGKASAN:`);
  console.log(`   Total rows migrated: ${totalMigrated}`);
  console.log(`   Total errors: ${totalErrors}`);

  if (totalErrors > 0) {
    console.log("\n⚠️  Beberapa tabel gagal. Cek error di atas.");
    console.log("   Kemungkinan penyebab:");
    console.log("   - Data duplikat (primary key conflict)");
    console.log("   - DateTime format tidak valid untuk PostgreSQL");
    console.log("   - String terlalu panjang (cek varchar length di schema)");
  } else {
    console.log("\n🎉 Migrasi selesai tanpa error!");
  }

  await db.$disconnect();
  process.exit(totalErrors > 0 ? 1 : 0);
}

migrate().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
