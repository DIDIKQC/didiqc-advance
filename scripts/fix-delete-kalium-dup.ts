// Backup + delete the 31 mis-imported NATRIUM rows sitting in KALIUM lot
// Safety: rows are (a) validated=false, (b) exact duplicates of NATRIUM lot rows
//         (same tanggal + identical level1/2/3), (c) no HistoriQC references.
import { Client } from "pg";
import { writeFileSync } from "fs";

const DB = "postgresql://postgres:087ab54d29910d40b3069ec7a437460f@rz7b4fhh.ap-southeast.database.insforge.app:5432/insforge?sslmode=require";

const K_LOT = "LOT_1788319356358_1976";   // KALIUM ION lot 5893
const NA_LOT = "LOT_1788319178838_7342";  // NATRIUM ION lot 5893

async function main() {
  const client = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // 1. Fetch the wrong rows (lotID=K lot, May 2026, level1 >= 20 — impossible for kalium)
  const wrong = await client.query(
    `SELECT * FROM "inputqc"
     WHERE "ownerUsername"='labor' AND "lotID"=$1
       AND tanggal BETWEEN '2026-05-01' AND '2026-05-31'
       AND CAST("level1" AS NUMERIC) >= 20`,
    [K_LOT]
  );
  console.log(`Wrong rows found: ${wrong.rows.length}`);
  if (wrong.rows.length !== 31) {
    console.log("ABORT: expected exactly 31 rows!");
    await client.end();
    process.exit(1);
  }

  // 2. Verify each is an exact duplicate of a NATRIUM row (same date, identical 3 levels)
  const naRows = await client.query(
    `SELECT tanggal, "level1","level2","level3" FROM "inputqc" WHERE "lotID"=$1`,
    [NA_LOT]
  );
  const naMap = new Map<string, any>();
  naRows.rows.forEach((r: any) => naMap.set(r.tanggal, r));
  let allDup = true;
  for (const w of wrong.rows) {
    const na = naMap.get(w.tanggal);
    const same = na && String(na.level1) === String(w.level1) &&
                 String(na.level2) === String(w.level2) && String(na.level3) === String(w.level3);
    if (!same) { allDup = false; console.log("NOT A DUP:", w.id, w.tanggal); }
    if (w.validated) { allDup = false; console.log("VALIDATED ROW — ABORT:", w.id); }
  }
  if (!allDup) {
    console.log("ABORT: not all rows verified as exact duplicates");
    await client.end();
    process.exit(1);
  }
  console.log("All 31 rows verified: exact duplicates of NATRIUM lot rows, all validated=false");

  // 3. Check no HistoriQC references
  const ids = wrong.rows.map((r: any) => r.id);
  const hist = await client.query(
    `SELECT COUNT(*) c FROM "historiqc" WHERE qcid = ANY($1)`, [ids]
  );
  console.log(`HistoriQC references: ${hist.rows[0].c}`);

  // 4. Backup to file
  const backupPath = "/home/z/my-project/backup-kalium-wrong-rows.json";
  writeFileSync(backupPath, JSON.stringify({ deletedAt: new Date().toISOString(), reason: "Mis-imported NATRIUM values duplicated into KALIUM ION lot 5893 (owner labor). Exact duplicates of NATRIUM lot rows.", rows: wrong.rows }, null, 2));
  console.log(`Backup saved: ${backupPath} (${wrong.rows.length} rows)`);

  // 5. Delete
  const del = await client.query(
    `DELETE FROM "inputqc" WHERE id = ANY($1)`, [ids]
  );
  console.log(`Deleted: ${del.rowCount} rows`);

  // 6. Post-check
  const remain = await client.query(
    `SELECT COUNT(*) c FROM "inputqc" WHERE "lotID"=$1 AND CAST("level1" AS NUMERIC) >= 20`, [K_LOT]
  );
  console.log(`Remaining wrong rows in K lot: ${remain.rows[0].c}`);
  const total = await client.query(
    `SELECT COUNT(*) c FROM "inputqc" WHERE "lotID"=$1`, [K_LOT]
  );
  console.log(`K lot total rows now: ${total.rows[0].c} (expected 218)`);

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
