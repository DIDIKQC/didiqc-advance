// Verify: are the 31 wrong KALIUM rows duplicates of NATRIUM lot rows (same dates+values)?
import { Client } from "pg";

const DB = "postgresql://postgres:087ab54d29910d40b3069ec7a437460f@rz7b4fhh.ap-southeast.database.insforge.app:5432/insforge?sslmode=require";

async function main() {
  const client = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Na lot = PAR_1787099349124_8658 -> which lotID? NATRIUM ION param
  const naLot = await client.query(
    `SELECT id FROM "lotqc" WHERE "ownerUsername"='labor' AND "paramID"='PAR_1787099349124_8658'`
  );
  const naLotID = naLot.rows[0].id;
  console.log("NATRIUM lotID:", naLotID);

  const naRows = await client.query(
    `SELECT tanggal, "level1","level2","level3" FROM "inputqc"
     WHERE "ownerUsername"='labor' AND "lotID"=$1 AND tanggal BETWEEN '2026-05-01' AND '2026-05-31'
     ORDER BY tanggal`, [naLotID]
  );
  const kRows = await client.query(
    `SELECT tanggal, "level1","level2","level3" FROM "inputqc"
     WHERE "ownerUsername"='labor' AND "lotID"='LOT_1788319356358_1976' AND tanggal BETWEEN '2026-05-01' AND '2026-05-31'
     ORDER BY tanggal`
  );
  console.log(`Na rows in May: ${naRows.rows.length}, K rows in May: ${kRows.rows.length}`);

  const naMap = new Map<string, any>();
  naRows.rows.forEach((r: any) => naMap.set(r.tanggal, r));

  let exact = 0, close = 0, missing = 0;
  const mismatches: any[] = [];
  for (const k of kRows.rows) {
    const na = naMap.get(k.tanggal);
    if (!na) { missing++; mismatches.push({ t: k.tanggal, reason: "no Na row", k }); continue; }
    const d = (a: string, b: string) => Math.abs(parseFloat(a) - parseFloat(b));
    const diffs = [d(k.level1, na.level1), d(k.level2, na.level2), d(k.level3, na.level3)];
    const maxD = Math.max(...diffs);
    if (maxD === 0) exact++;
    else if (maxD <= 2.5) close++;
    else mismatches.push({ t: k.tanggal, maxD, k, na });
  }
  console.log(`exact duplicates: ${exact}, within ±2.5: ${close}, missing/mismatch: ${missing + mismatches.length}`);
  mismatches.slice(0, 10).forEach((m) => console.log("  MISMATCH:", JSON.stringify(m)));

  // Show sample side-by-side
  console.log("\nSample comparison (K-lot wrong row vs Na-lot row same date):");
  for (const t of ["2026-05-01", "2026-05-15", "2026-05-31"]) {
    const k = kRows.rows.find((r: any) => r.tanggal === t);
    const na = naMap.get(t);
    console.log(`  ${t}: K-lot L1=${k?.level1} L2=${k?.level2} L3=${k?.level3}  ||  Na-lot L1=${na?.level1} L2=${na?.level2} L3=${na?.level3}`);
  }

  // Also check: does Na lot itself have exactly 31 rows in May? And K lot correct rows exist for May too?
  const kMayAll = await client.query(
    `SELECT COUNT(*) c FROM "inputqc" WHERE "ownerUsername"='labor' AND "lotID"='LOT_1788319356358_1976' AND tanggal BETWEEN '2026-05-01' AND '2026-05-31'`
  );
  console.log(`\nK lot total rows in May window: ${kMayAll.rows[0].c}`);
  // duplicates on same date in K lot?
  const dupCheck = await client.query(
    `SELECT tanggal, COUNT(*) c FROM "inputqc" WHERE "ownerUsername"='labor' AND "lotID"='LOT_1788319356358_1976' GROUP BY tanggal HAVING COUNT(*) > 1 ORDER BY tanggal`
  );
  console.log(`K lot dates with >1 row: ${dupCheck.rows.length}`);
  dupCheck.rows.slice(0, 5).forEach((r: any) => console.log(`  ${r.tanggal}: ${r.c} rows`));

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
