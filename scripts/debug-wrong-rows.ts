// Check the 31 wrong rows in KALIUM lot + find the M32 lot with meanL3=62.1
import { Client } from "pg";

const DB = "postgresql://postgres:087ab54d29910d40b3069ec7a437460f@rz7b4fhh.ap-southeast.database.insforge.app:5432/insforge?sslmode=require";

function parseNumSafe(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  const s = String(v).replace(",", ".").trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

async function main() {
  const client = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const username = "labor";

  // 1. The 31 wrong rows in KALIUM lot
  const qcs = await client.query(
    `SELECT id, "level1","level2","level3", tanggal, "inputBy", "inputDate", validated
     FROM "inputqc" WHERE "ownerUsername"=$1 AND "lotID"='LOT_1788319356358_1976'
     ORDER BY tanggal ASC`,
    [username]
  );
  const wrong = qcs.rows.filter((q: any) => {
    const v = parseNumSafe(q.level1);
    return v !== null && v >= 20;
  });
  console.log(`KALIUM lot wrong rows: ${wrong.length}`);
  wrong.forEach((q: any) =>
    console.log(`  ${q.tanggal} L1=${q.level1} L2=${q.level2} L3=${q.level3} by=${q.inputBy} validated=${q.validated} id=${q.id}`)
  );

  // inputBy distribution over all rows of this lot
  const byCount: Record<string, number> = {};
  qcs.rows.forEach((q: any) => { byCount[q.inputBy || "-"] = (byCount[q.inputBy || "-"] || 0) + 1; });
  console.log("\ninputBy distribution:", byCount);

  // 2. Find lots with meanL3 = 62.1-ish (the negative Hematologi one: Medonic M32 (Mseries))
  const lots = await client.query(
    `SELECT id,"paramID","noLot","namaAlat", tea, "meanL1","sdL1","meanL2","sdL2","meanL3","sdL3"
     FROM "lotqc" WHERE "ownerUsername"=$1 AND "namaAlat" ILIKE '%M32%'`,
    [username]
  );
  console.log(`\n=== ${lots.rows.length} M32 lots ===`);
  for (const l of lots.rows) {
    const param = await client.query(`SELECT parameter, bidang FROM "parameters" WHERE id=$1`, [l.paramID]);
    const q2 = await client.query(
      `SELECT "level1","level2","level3" FROM "inputqc" WHERE "ownerUsername"=$1 AND "lotID"=$2`,
      [username, l.id]
    );
    [1, 2, 3].forEach((lv) => {
      const col = lv === 1 ? "level1" : lv === 2 ? "level2" : "level3";
      const vals = q2.rows.map((q: any) => parseNumSafe(q[col])).filter((v: any) => v !== null && v !== 0);
      if (!vals.length) return;
      const cm = vals.reduce((a: number, c: number) => a + c, 0) / vals.length;
      if (l["meanL" + lv]) {
        const m = parseNumSafe(l["meanL" + lv])!;
        const bias = Math.abs((cm - m) / m) * 100;
        if (bias > 15) {
          console.log(`OUTLIER-LOT: ${param.rows[0]?.parameter} | lot ${l.noLot} | L${lv} lotMean=${m} calcMean=${cm.toFixed(2)} bias=${bias.toFixed(1)}% n=${vals.length} range=${Math.min(...vals)}..${Math.max(...vals)}`);
        }
      }
    });
  }

  // 3. Global sweep: ALL lots of labor — find any level where bias > 15% (potential mis-entered data)
  console.log("\n=== SWEEP all lots owner=labor (bias > 15%) ===");
  const allLots = await client.query(
    `SELECT id,"paramID","noLot","namaAlat", tea, "meanL1","sdL1","meanL2","sdL2","meanL3","sdL3" FROM "lotqc" WHERE "ownerUsername"=$1`,
    [username]
  );
  for (const l of allLots.rows) {
    const param = await client.query(`SELECT parameter FROM "parameters" WHERE id=$1`, [l.paramID]);
    const q2 = await client.query(
      `SELECT "level1","level2","level3" FROM "inputqc" WHERE "ownerUsername"=$1 AND "lotID"=$2`,
      [username, l.id]
    );
    [1, 2, 3].forEach((lv) => {
      const col = lv === 1 ? "level1" : lv === 2 ? "level2" : "level3";
      const vals = q2.rows.map((q: any) => parseNumSafe(q[col])).filter((v: any) => v !== null && v !== 0);
      const m = parseNumSafe(l["meanL" + lv]);
      const s = parseNumSafe(l["sdL" + lv]);
      const tea = parseNumSafe(l.tea);
      if (!vals.length || !m || !s || !tea) return;
      const cm = vals.reduce((a: number, c: number) => a + c, 0) / vals.length;
      const bias = Math.abs((cm - m) / m) * 100;
      const cv = (s / m) * 100;
      const sigma = cv ? (tea - bias) / cv : null;
      if (bias > 15) {
        console.log(`BIAS>15%: ${param.rows[0]?.parameter} | ${l.namaAlat} | lot=${l.noLot} L${lv} | lotMean=${m} calcMean=${cm.toFixed(2)} bias=${bias.toFixed(1)}% sigma=${sigma?.toFixed(2)} n=${vals.length}`);
      }
    });
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
