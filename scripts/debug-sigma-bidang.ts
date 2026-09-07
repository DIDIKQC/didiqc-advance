// Debug: reproduce Dashboard "Sigma perLevel per Bidang" for a given owner
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

  // 1. Find the account
  const users = await client.query(
    `SELECT username, "fullName", role FROM "users" WHERE "fullName" ILIKE '%Pusri%' OR username ILIKE '%pusri%' OR "fullName" ILIKE '%aboratorium%'`
  );
  console.log("=== USERS matching Pusri/Laboratorium ===");
  console.table(users.rows);

  const username = process.argv[2] || users.rows[0]?.username;
  console.log("\nOwner username:", username);

  // 2. Get parameters -> bidang map
  const params = await client.query(
    `SELECT id, parameter, bidang FROM "parameters" WHERE "ownerUsername" = $1`,
    [username]
  );
  const paramBidang: Record<string, string> = {};
  params.rows.forEach((p: any) => { paramBidang[p.id] = p.bidang || "Lainnya"; });
  console.log(`\n=== ${params.rows.length} parameters ===`);

  // 3. Get lots
  const lots = await client.query(
    `SELECT id, "paramID", "noLot", "namaAlat", tea, "meanL1","sdL1","meanL2","sdL2","meanL3","sdL3"
     FROM "lotqc" WHERE "ownerUsername" = $1`,
    [username]
  );
  console.log(`\n=== ${lots.rows.length} lots ===`);

  // 4. Get ALL QC rows for this owner (like fetchInputQCRows with empty filter)
  const qcCount = await client.query(
    `SELECT COUNT(*) as c FROM "inputqc" WHERE "ownerUsername" = $1`,
    [username]
  );
  console.log(`\nTotal QC rows: ${qcCount.rows[0].c}`);

  // Sample a few QC rows to inspect level values format
  const qcSample = await client.query(
    `SELECT "lotID", "level1","level2","level3", tanggal, validated FROM "inputqc"
     WHERE "ownerUsername" = $1 ORDER BY tanggal DESC LIMIT 8`,
    [username]
  );
  console.log("\n=== Sample QC rows ===");
  console.table(qcSample.rows);

  // 5. Reproduce computeSigmaByBidangInternal per bidang with detail per lot
  const bidangAgg: Record<string, { sig: number[][]; details: any[] }> = {};
  params.rows.forEach((p: any) => {
    const b = p.bidang || "Lainnya";
    if (!bidangAgg[b]) bidangAgg[b] = { sig: [[], [], []], details: [] };
  });

  for (const lot of lots.rows) {
    const bidang = paramBidang[lot.paramID] || "Lainnya";
    if (!bidangAgg[bidang]) bidangAgg[bidang] = { sig: [[], [], []], details: [] };
    const qcs = await client.query(
      `SELECT "level1","level2","level3" FROM "inputqc" WHERE "ownerUsername"=$1 AND "lotID"=$2`,
      [username, lot.id]
    );
    for (let lv = 1; lv <= 3; lv++) {
      const m = parseNumSafe(lot[`meanL${lv}`]);
      const s = parseNumSafe(lot[`sdL${lv}`]);
      const tea = parseNumSafe(lot.tea);
      const vals = qcs.rows
        .map((q: any) => parseNumSafe(lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3))
        .filter((v: any) => v !== null && v !== 0) as number[];
      if (!m || !s || !tea || !vals.length) continue;
      const calcMean = vals.reduce((a, c) => a + c, 0) / vals.length;
      const bias = Math.abs(((calcMean - m) / m) * 100);
      const cv = (s / m) * 100;
      const sigma = cv ? (tea - bias) / cv : null;
      if (sigma !== null && !isNaN(sigma)) bidangAgg[bidang].sig[lv - 1].push(sigma);
      bidangAgg[bidang].details.push({
        lot: lot.noLot, alat: lot.namaAlat, lv,
        lotMean: m, lotSD: s, tea,
        n: vals.length,
        calcMean: +calcMean.toFixed(4),
        biasPct: +bias.toFixed(2),
        cvPct: +cv.toFixed(2),
        sigma: sigma === null ? null : +sigma.toFixed(2),
        minVal: Math.min(...vals), maxVal: Math.max(...vals),
      });
    }
  }

  for (const b of Object.keys(bidangAgg).sort()) {
    const agg = bidangAgg[b];
    console.log(`\n========== BIDANG: ${b} ==========`);
    const avg = agg.sig.map((arr, i) =>
      arr.length ? +(arr.reduce((a, c) => a + c, 0) / arr.length).toFixed(2) : null
    );
    console.log("sigL1:", avg[0], " sigL2:", avg[1], " sigL3:", avg[2]);
    // Print worst offenders (negative sigma)
    const bad = agg.details.filter((d) => d.sigma !== null && d.sigma < 0);
    console.log(`lots with NEGATIVE sigma: ${bad.length} / ${agg.details.length}`);
    bad.slice(0, 10).forEach((d) => console.log("  NEG:", JSON.stringify(d)));
    // Print a couple of positive examples
    const good = agg.details.filter((d) => d.sigma !== null && d.sigma >= 0);
    good.slice(0, 3).forEach((d) => console.log("  OK :", JSON.stringify(d)));
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
