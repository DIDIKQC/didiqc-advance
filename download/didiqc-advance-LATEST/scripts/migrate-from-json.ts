/**
 * ============================================================
 * Migrasi Data: JSON → InsForge PostgreSQL
 * ============================================================
 * Script ini membaca data dari database-export.json dan
 * memasukkannya ke InsForge PostgreSQL.
 *
 * Pendekatan ini lebih aman karena:
 * - Tidak butuh dual Prisma client
 * - Tidak ada konflik schema (PostgreSQL vs SQLite)
 * - Data sudah dalam format JSON yang mudah diproses
 * ============================================================
 */

import { PrismaClient } from "@prisma/client";
import data from "../download/qc-app-bundle/database-export.json";

// PostgreSQL client (tulis ke InsForge)
const pgDb = new PrismaClient({
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
  console.log("🚀 Migrasi JSON → InsForge PostgreSQL\n");
  console.log("📍 Source: download/qc-app-bundle/database-export.json");
  console.log("📍 Target: rz7b4fhh.ap-southeast.database.insforge.app\n");

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
    const rows = (data as any)[table];
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`⏭️  ${table.padEnd(20)} 0 rows (skip)`);
      continue;
    }

    console.log(`🔄 ${table.padEnd(20)} processing ${rows.length} rows...`);

    // Insert ke PostgreSQL satu per satu (lebih aman untuk handle DateTime & errors)
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
          console.error(`   ❌ ${table} row error: ${err.message.substring(0, 150)}`);
        }
      }
    }
    console.log(
      `✅ ${table.padEnd(20)} ${success}/${rows.length} rows migrated` +
        (fail > 0 ? ` (${fail} failed)` : "")
    );
    totalMigrated += success;
    totalErrors += fail;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 RINGKASAN MIGRASI:`);
  console.log(`   ✅ Total rows berhasil: ${totalMigrated}`);
  console.log(`   ❌ Total errors: ${totalErrors}`);
  console.log(`${"=".repeat(60)}`);

  await pgDb.$disconnect();
  process.exit(totalErrors > 0 ? 1 : 0);
}

migrate().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
