// Debug v2: bandingkan sigma CV-assigned (sdL lot) vs sigma CV-aktual (calcSD/calcMean data QC)
// untuk memastikan metode mana yang benar untuk chart "Sigma perLevel per Bidang"
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
  const username = process.argv[2] || "labor";

  const params = await client.query(
    `SELECT id, parameter, bidang FROM "parameters" WHERE "ownerUsername" = $1`, [username]);
  const paramBidang: Record<string, string> = {};
  const paramName: Record<string, string> = {};
  params.rows.forEach((p: any) => { paramBidang[p.id] = p.bidang || "Lainnya"; paramName[p.id] = p.parameter; });

  const lots = await client.query(
    `SELECT id, "paramID", "noLot", "namaAlat", tea, "meanL1","sdL1","meanL2","sdL2","meanL3","sdL3"
     FROM "lotqc" WHERE "ownerUsername" = $1`, [username]);

  // agg per bidang: metode A (CV assigned) & B (CV aktual)
  const agg: Record<string, { A: number[][]; B: number[][]; rows: any[] }> = {};
  params.rows.forEach((p: any) => {
    const b = p.bidang || "Lainnya";
    if (!agg[b]) agg[b] = { A: [[], [], []], B: [[], [], []], rows: [] };
  });

  for (const lot of lots.rows) {
    const bidang = paramBidang[lot.paramID] || "Lainnya";
    if (!agg[bidang]) agg[bidang] = { A: [[], [], []], B: [[], [], []], rows: [] };
    const qcs = await client.query(
      `SELECT "level1","level2","level3" FROM "inputqc" WHERE "ownerUsername"=$1 AND "lotID"=$2`,
      [username, lot.id]);
    for (let lv = 1; lv <= 3; lv++) {
      const m = parseNumSafe(lot[`meanL${lv}`]);
      const s = parseNumSafe(lot[`sdL${lv}`]);
      const tea = parseNumSafe(lot.tea);
      const vals = qcs.rows
        .map((q: any) => parseNumSafe(lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3))
        .filter((v: any) => v !== null && v !== 0) as number[];
      if (!m || !s || !tea || !vals.length) continue;
      const calcMean = vals.reduce((a, c) => a + c, 0) / vals.length;
      // SD aktual (populasi, sama dgn computeMonthTrendInternal)
      const calcSD = vals.length > 1
        ? Math.sqrt(vals.reduce((s2, v) => s2 + Math.pow(v - calcMean, 2), 0) / vals.length)
        : 0;
      const bias = Math.abs(((calcMean - m) / m) * 100);
      const cvA = (s / m) * 100;                  // metode A: CV dari SD lot
      const cvB = calcMean ? (calcSD / calcMean) * 100 : 0; // metode B: CV aktual
      const sigA = cvA ? (tea - bias) / cvA : null;
      const sigB = cvB ? (tea - bias) / cvB : null;
      if (sigA !== null && !isNaN(sigA)) agg[bidang].A[lv - 1].push(sigA);
      if (sigB !== null && !isNaN(sigB)) agg[bidang].B[lv - 1].push(sigB);
      agg[bidang].rows.push({
        param: paramName[lot.paramID], lot: lot.noLot, alat: lot.namaAlat, lv,
        tea, biasPct: +bias.toFixed(2),
        cvAssigned: +cvA.toFixed(2), cvActual: +cvB.toFixed(2),
        sigAssignedCV: sigA === null ? null : +sigA.toFixed(2),
        sigActualCV: sigB === null ? null : +sigB.toFixed(2),
        n: vals.length,
      });
    }
  }

  const fmt = (arr: number[]) => arr.length ? +(arr.reduce((a, c) => a + c, 0) / arr.length).toFixed(2) : null;
  for (const b of Object.keys(agg).sort()) {
    const g = agg[b];
    console.log(`\n========== BIDANG: ${b} ==========`);
    console.log("CV-assigned (sdL lot)  : L1:", fmt(g.A[0]), " L2:", fmt(g.A[1]), " L3:", fmt(g.A[2]), `  (n=${g.A.map(x=>x.length).join("/")})`);
    console.log("CV-aktual (calcSD data): L1:", fmt(g.B[0]), " L2:", fmt(g.B[1]), " L3:", fmt(g.B[2]), `  (n=${g.B.map(x=>x.length).join("/")})`);
  }

  // Detail KimiaKlinik per lot/level (kedua metode berdampingan)
  const kk = agg["KimiaKlinik"];
  if (kk) {
    console.log(`\n--- Detail KimiaKlinik (${kk.rows.length} baris lot/level) ---`);
    console.table(kk.rows.map(r => ({
      param: r.param, lv: r.lv, tea: r.tea, bias: r.biasPct,
      cvA: r.cvAssigned, cvB: r.cvActual,
      sigA: r.sigAssignedCV, sigB: r.sigActualCV, n: r.n,
    })));
  }
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
