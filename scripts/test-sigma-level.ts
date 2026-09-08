// Unit test computeSigmaForLevel — verifikasi fix v9.28 (CV aktual + fallback)
import { computeSigmaForLevel } from "../src/lib/backend/westgard";

let pass = 0, fail = 0;
function eq(name: string, got: any, want: any) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`PASS ${name}  -> ${JSON.stringify(got)}`); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
}

// Lot: meanL1=100, sdL1=5 (CV assigned 5%), tea=10
const lot = { meanL1: 100, sdL1: 5, meanL2: 200, sdL2: 8, tea: 10 };

// Case 1: n>=2, data stabil → sigma pakai CV aktual
// vals: 99,101,100,100 → calcMean=100, calcSD(pop)=0.7071, CV=0.7071%, bias=0 → sigma=10/0.7071=14.14
eq("n>=2 pakai CV aktual", computeSigmaForLevel(lot, "L1", [
  { level1: 99 }, { level1: 101 }, { level1: 100 }, { level1: 100 },
]), 14.14);

// Case 2: n=1 → fallback CV assigned (5%) ; bias=0 → sigma=10/5=2.0
eq("n=1 fallback CV lot", computeSigmaForLevel(lot, "L1", [{ level1: 100 }]), 2);

// Case 3: tanpa sdL lot & n=1 → null
eq("tanpa SD & n=1 → null", computeSigmaForLevel({ meanL1: 100, tea: 10 }, "L1", [{ level1: 100 }]), null);

// Case 4: tanpa tea → null
eq("tanpa TEa → null", computeSigmaForLevel({ meanL1: 100, sdL1: 5 }, "L1", [{ level1: 100 }]), null);

// Case 5: tanpa data QC → null
eq("tanpa QC → null", computeSigmaForLevel(lot, "L1", []), null);

// Case 6: level2 terpisah (meanL2=200 sdL2=8): vals 200,202 → calcMean=201, calcSD=1, CV=0.49751, bias=0.5 → sigma=9.5/0.49751=19.09 (float)
eq("level 2 CV aktual", computeSigmaForLevel(lot, "L2", [{ level2: 200 }, { level2: 202 }]), 19.09);

// Case 7: nilai 0/null di-skip (konsisten perilaku lama); tersisa 99,101 → SD=1, CV=1%, bias=0 → sigma=10
eq("skip 0/null", computeSigmaForLevel(lot, "L1", [
  { level1: null as any }, { level1: 0 }, { level1: 99 }, { level1: 101 },
]), 10);

// Case 8: konsistensi dgn formula getSmallestSigmaBySrc Terhitung —
// lot ALBUMIN-like: mean=3.46 sd=0.21 tea=8; QC 250 nilai ~ mean 3.4374 CV 1.87 (dari produksi)
// bias=0.65 → sigma=(8-0.65)/1.87=3.93
const vals: number[] = [];
// buat 250 nilai dgn mean 3.4374 & SD populasi ~0.0644 (CV 1.87%)
for (let i = 0; i < 125; i++) { vals.push(+(3.4374 - 0.0644).toFixed(4)); vals.push(+(3.4374 + 0.0644).toFixed(4)); }
eq("replika ALBUMIN produksi (sigma≈3.92, dulu 1.21)", computeSigmaForLevel(
  { meanL1: 3.46, sdL1: 0.21, tea: 8 }, "L1",
  vals.map(v => ({ level1: v }))
), 3.92);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
