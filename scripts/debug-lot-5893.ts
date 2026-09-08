// Deep dive into negative-sigma lots for owner "labor"
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

  // Lot 5893 detail
  const lot = await client.query(
    `SELECT * FROM "lotqc" WHERE "ownerUsername"=$1 AND "noLot" ILIKE '%5893%'`,
    [username]
  );
  console.log("=== LOT 5893 rows ===");
  lot.rows.forEach((l: any) => {
    console.log(JSON.stringify({
      id: l.id, paramID: l.paramID, noLot: l.noLot, alat: l.namaAlat,
      tea: l.tea, meanL1: l.meanL1, sdL1: l.sdL1, meanL2: l.meanL2, sdL2: l.sdL2, meanL3: l.meanL3, sdL3: l.sdL3,
    }));
  });

  for (const l of lot.rows) {
    const param = await client.query(`SELECT parameter, bidang FROM "parameters" WHERE id=$1`, [l.paramID]);
    console.log(`\nParameter: ${param.rows[0]?.parameter} (${param.rows[0]?.bidang})`);

    const qcs = await client.query(
      `SELECT "level1","level2","level3", tanggal FROM "inputqc"
       WHERE "ownerUsername"=$1 AND "lotID"=$2 ORDER BY tanggal ASC`,
      [username, l.id]
    );
    console.log(`QC rows: ${qcs.rows.length}`);
    // distribution per level
    [1, 2, 3].forEach((lv) => {
      const col = lv === 1 ? "level1" : lv === 2 ? "level2" : "level3";
      const vals = qcs.rows.map((q: any) => ({ v: parseNumSafe(q[col]), t: q.tanggal }))
        .filter((x: any) => x.v !== null && x.v !== 0);
      if (!vals.length) return;
      const sorted = vals.map((x: any) => x.v).sort((a: any, b: any) => a - b);
      const low = sorted.filter((v: number) => v < 20);
      const high = sorted.filter((v: number) => v >= 20);
      console.log(`\n L${lv}: n=${sorted.length}`);
      console.log(`   values <20: n=${low.length} ${low.length ? "range " + Math.min(...low) + ".." + Math.max(...low) : ""}`);
      console.log(`   values >=20: n=${high.length} ${high.length ? "range " + Math.min(...high) + ".." + Math.max(...high) : ""}`);
      // Show transition points
      let prevHigh = false;
      for (const x of vals) {
        const isHigh = x.v >= 20;
        if (isHigh !== prevHigh) {
          console.log(`   ${isHigh ? "--> high values start" : "--> back to low"} at ${x.t}: ${x.v}`);
          prevHigh = isHigh;
        }
      }
    });
  }

  // Medonic lot detail
  const lot2 = await client.query(
    `SELECT id, "paramID","noLot","namaAlat", tea, "meanL1","sdL1","meanL2","sdL2","meanL3","sdL3"
     FROM "lotqc" WHERE "ownerUsername"=$1 AND "noLot" ILIKE '%22412%'`,
    [username]
  );
  console.log("\n\n=== MEDONIC lots ===");
  for (const l of lot2.rows) {
    const param = await client.query(`SELECT parameter, bidang FROM "parameters" WHERE id=$1`, [l.paramID]);
    const qcs = await client.query(
      `SELECT "level1","level2","level3", tanggal FROM "inputqc" WHERE "ownerUsername"=$1 AND "lotID"=$2 ORDER BY tanggal ASC`,
      [username, l.id]
    );
    console.log(`\nLot ${l.noLot} (${l.namaAlat}) param=${param.rows[0]?.parameter} tea=${l.tea} meanL1=${l.meanL1} meanL2=${l.meanL2} meanL3=${l.meanL3} sdL3=${l.sdL3}`);
    [1, 2, 3].forEach((lv) => {
      const col = lv === 1 ? "level1" : lv === 2 ? "level2" : "level3";
      const vals = qcs.rows.map((q: any) => parseNumSafe(q[col])).filter((v: any) => v !== null && v !== 0);
      if (!vals.length) return;
      console.log(`  L${lv}: n=${vals.length} mean=${(vals.reduce((a: number, c: number) => a + c, 0) / vals.length).toFixed(2)} range=${Math.min(...vals)}..${Math.max(...vals)} | lotMean=${l["meanL" + lv]} lotSD=${l["sdL" + lv]}`);
    });
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
