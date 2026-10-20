/**
 * ============================================================
 * Migrasi Data: SQLite → InsForge PostgreSQL
 * ============================================================
 * Script ini membaca data dari SQLite (custom.db) dan
 * memasukkannya ke InsForge PostgreSQL.
 *
 * Menggunakan 2 Prisma client terpisah:
 * - sqliteDb: baca dari SQLite (file:/home/z/my-project/db/custom.db)
 * - pgDb: tulis ke PostgreSQL InsForge
 * ============================================================
 */

import { PrismaClient as PrismaSqlite } from "@prisma/client";
import { PrismaClient as PrismaPg } from "@prisma/client";

// SQLite client (baca data lama) - hardcode URL karena .env sudah PostgreSQL
const sqliteDb = new PrismaSqlite({
  datasources: {
    db: {
      url: "file:/home/z/my-project/db/custom.db",
    },
  },
});

// PostgreSQL client (tulis ke InsForge)
const pgDb = new PrismaPg({
  datasources: {
    db: {
      url: "postgresql://postgres:087ab54d29910d40b3069ec7a437460f@rz7b4fhh.ap-southeast.database.insforge.app:5432/insforge?sslmode=require",
    },
  },
});

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
  console.log("🚀 Migrasi SQLite → InsForge PostgreSQL\n");
  console.log("📍 Source: /home/z/my-project/db/custom.db (SQLite)");
  console.log("📍 Target: rz7b4fhh.ap-southeast.database.insforge.app (PostgreSQL)\n");

  // Test koneksi
  try {
    await pgDb.$queryRaw`SELECT 1`;
    console.log("✅ Koneksi PostgreSQL (InsForge) berhasil!\n");
  } catch (e: any) {
    console.error("❌ Gagal koneksi PostgreSQL:", e.message);
    process.exit(1);
  }

  let totalMigrated = 0;
  let totalErrors = 0;

  for (const table of tables) {
    try {
      // @ts-expect-error dynamic access
      const rows = await sqliteDb[table].findMany();
      if (rows.length === 0) {
        console.log(`⏭️  ${table.padEnd(20)} 0 rows (skip)`);
        continue;
      }

      // Insert ke PostgreSQL satu per satu (lebih aman untuk handle DateTime)
      let success = 0;
      let fail = 0;
      for (const row of rows) {
        try {
          // @ts-expect-error dynamic access
          await pgDb[table].create({ data: row });
          success++;
        } catch (err: any) {
          fail++;
          if (fail <= 2) {
            console.error(`   ❌ ${table} row error: ${err.message.substring(0, 120)}`);
          }
        }
      }
      console.log(
        `✅ ${table.padEnd(20)} ${success}/${rows.length} rows migrated` +
          (fail > 0 ? ` (${fail} failed)` : "")
      );
      totalMigrated += success;
      totalErrors += fail;
    } catch (e: any) {
      console.error(`❌ ${table.padEnd(20)} ERROR: ${e.message}`);
      totalErrors++;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 RINGKASAN MIGRASI:`);
  console.log(`   ✅ Total rows berhasil: ${totalMigrated}`);
  console.log(`   ❌ Total errors: ${totalErrors}`);
  console.log(`${"=".repeat(60)}`);

  await sqliteDb.$disconnect();
  await pgDb.$disconnect();
  process.exit(totalErrors > 0 ? 1 : 0);
}

migrate().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
