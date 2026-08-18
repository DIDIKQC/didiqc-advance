// ============================================================
// westgard.ts — Westgard multi-rule engine + sigma helpers
//
// Port 1:1 dari code.gs:
//   - checkWestgardRules          (pure)
//   - checkWestgardAcrossLevels   (pure)
//   - getActiveRulesBySigma       (pure)
//   - filterViolationsBySigma     (pure)
//   - categorizeWestgardError     (pure)
//   - computeSigmaForLevel        (pure)
//   - getWestgardViolations30Days (DB)
//   - checkAndNotifyWestgard      (DB, e-mail disabled in Next.js port)
//
// Pure functions accept/return plain JSON-serializable values; DB-backed
// functions use the same `(args, session)` signature as the rest of the
// backend modules.
// ============================================================

import { db } from "@/lib/db";
import type { SessionData } from "@/lib/session";
import {
  parseNumSafe,
  parseDateStr,
  dateToISO,
  logA,
  ownerMatch,
} from "@/lib/utils-server";

// ============================================================
// Helpers — derive owner/role (mirror master-data.ts pattern)
// ============================================================

function deriveOwner(
  args: any[],
  session: SessionData | null,
  idx: number
): string {
  const fromArgs = args[idx];
  if (typeof fromArgs === "string" && fromArgs.length > 0) return fromArgs;
  if (session) {
    if (session.activeUsername) return session.activeUsername;
    if (session.username) return session.username;
  }
  return "";
}

function deriveRole(
  args: any[],
  session: SessionData | null,
  idx: number
): string {
  const fromArgs = args[idx];
  if (typeof fromArgs === "string" && fromArgs.length > 0) return fromArgs;
  if (session) {
    if (session.activeRole) return session.activeRole;
    if (session.role) return session.role;
  }
  return "user";
}

// ============================================================
// 1. checkWestgardRules — core multi-rule engine (pure)
//
// Mirror code.gs checkWestgardRules(values, mean, sd) verbatim.
// Implements: 1-2s (warning), 1-3s, 2-2s, R-4s, 4-1s, 6x, 7x, 8x, 10x, 7T.
// `level` is set to null — callers know which level they're checking.
// ============================================================
export function checkWestgardRules(
  values: number[] | null | undefined,
  mean: number | null | undefined,
  sd: number | null | undefined
): any[] {
  const violations: any[] = [];
  if (!values || values.length === 0 || !mean || !sd) return violations;

  const v = values;
  const n = v.length;

  // inner z() helper — matches original
  const z = (val: number) => (val - mean!) / sd!;

  const last = v[n - 1];
  const lastZ = z(last);
  const lastAbsZ = Math.abs(lastZ);

  // 1-2s (Warning) — only the 2–3 SD band
  if (lastAbsZ >= 2 && lastAbsZ < 3) {
    violations.push({
      rule: "1-2s",
      idx: n - 1,
      level: null,
      value: last,
      z: lastZ,
      type: "warning",
      desc: "Peringatan: 1 nilai melampaui ±2SD",
    });
  }

  // 1-3s (Rejection)
  if (lastAbsZ >= 3) {
    violations.push({
      rule: "1-3s",
      idx: n - 1,
      level: null,
      value: last,
      z: lastZ,
      type: "rejection",
      desc: "1 nilai melampaui ±3SD",
    });
  }

  // 2-2s (Within-Run): 2 consecutive ≥+2SD or ≤-2SD
  if (n >= 2) {
    const z1 = z(v[n - 2]);
    const z2 = z(v[n - 1]);
    if ((z1 >= 2 && z2 >= 2) || (z1 <= -2 && z2 <= -2)) {
      violations.push({
        rule: "2-2s",
        idx: n - 1,
        level: null,
        value: last,
        z: lastZ,
        type: "rejection",
        desc: "2 nilai berturut > ±2SD sisi sama (Within)",
      });
    }
  }

  // R-4s (Within-Run)
  if (n >= 2) {
    const z1 = z(v[n - 2]);
    const z2 = z(v[n - 1]);
    if (
      (z1 >= 2 && z2 <= -2) ||
      (z1 <= -2 && z2 >= 2) ||
      Math.abs(z1 - z2) >= 4
    ) {
      violations.push({
        rule: "R-4s",
        idx: n - 1,
        level: null,
        value: last,
        z: lastZ,
        type: "rejection",
        desc: "Rentang 2 nilai berturut > 4SD (Within)",
      });
    }
  }

  // 4-1s (Within-Run)
  if (n >= 4) {
    const last4 = v.slice(n - 4).map(z);
    if (
      last4.every((zv: number) => zv >= 1) ||
      last4.every((zv: number) => zv <= -1)
    ) {
      violations.push({
        rule: "4-1s",
        idx: n - 1,
        level: null,
        value: last,
        z: lastZ,
        type: "rejection",
        desc: "4 nilai berturut > ±1SD sisi sama (Within)",
      });
    }
  }

  // 6x, 7x, 8x, 10x — consecutive points on same side of mean
  if (n >= 6) {
    const last6 = v.slice(n - 6);
    if (
      last6.every((x: number) => x > mean!) ||
      last6.every((x: number) => x < mean!)
    ) {
      violations.push({
        rule: "6x",
        idx: n - 1,
        level: null,
        value: last,
        z: lastZ,
        type: "rejection",
        desc: "6 nilai berturut di satu sisi mean (Within)",
      });
    }
  }
  if (n >= 7) {
    const last7 = v.slice(n - 7);
    if (
      last7.every((x: number) => x > mean!) ||
      last7.every((x: number) => x < mean!)
    ) {
      violations.push({
        rule: "7x",
        idx: n - 1,
        level: null,
        value: last,
        z: lastZ,
        type: "rejection",
        desc: "7 nilai berturut di satu sisi mean (Within)",
      });
    }
  }
  if (n >= 8) {
    const last8 = v.slice(n - 8);
    if (
      last8.every((x: number) => x > mean!) ||
      last8.every((x: number) => x < mean!)
    ) {
      violations.push({
        rule: "8x",
        idx: n - 1,
        level: null,
        value: last,
        z: lastZ,
        type: "rejection",
        desc: "8 nilai berturut di satu sisi mean (Within)",
      });
    }
  }
  if (n >= 10) {
    const last10 = v.slice(n - 10);
    if (
      last10.every((x: number) => x > mean!) ||
      last10.every((x: number) => x < mean!)
    ) {
      violations.push({
        rule: "10x",
        idx: n - 1,
        level: null,
        value: last,
        z: lastZ,
        type: "rejection",
        desc: "10 nilai berturut di satu sisi mean (Within)",
      });
    }
  }

  // 7T — trend (monotonically increasing or decreasing)
  if (n >= 7) {
    const last7 = v.slice(n - 7);
    let allInc = true;
    let allDec = true;
    for (let i = 1; i < 7; i++) {
      if (last7[i] <= last7[i - 1]) allInc = false;
      if (last7[i] >= last7[i - 1]) allDec = false;
    }
    if (allInc || allDec) {
      violations.push({
        rule: "7T",
        idx: n - 1,
        level: null,
        value: last,
        z: lastZ,
        type: "rejection",
        desc: "7 nilai trend " + (allInc ? "naik" : "turun") + " (Within)",
      });
    }
  }

  return violations;
}

// ============================================================
// 2. checkWestgardAcrossLevels — across-level rules (pure)
//
// Mirror code.gs checkWestgardAcrossLevels(ljDataUnified, meansByLevel, sdsByLevel).
// ljDataUnified: { L1: [{date, value}], L2: [...], L3: [...] }
// Groups by date, then for each pair of levels on the same day checks:
//   - 2-2s(across): both z ≥+2 or both z ≤-2
//   - R-4s(across): |z1 - z2| ≥ 4
// ============================================================
export function checkWestgardAcrossLevels(
  ljDataUnified: Record<string, Array<{ date: string; value: number }>> | null,
  meansByLevel: Record<string, number | null | undefined>,
  sdsByLevel: Record<string, number | null | undefined>
): any[] {
  const violations: any[] = [];
  if (!ljDataUnified) return violations;

  const dataByDate: Record<string, Array<{ lv: string; value: number; idx: number }>> = {};

  (["L1", "L2", "L3"] as const).forEach((lv) => {
    (ljDataUnified[lv] || []).forEach((p, idx) => {
      if (!dataByDate[p.date]) dataByDate[p.date] = [];
      dataByDate[p.date].push({ lv, value: p.value, idx });
    });
  });

  Object.keys(dataByDate).forEach((dateStr) => {
    const dayData = dataByDate[dateStr];
    if (dayData.length < 2) return;
    for (let i = 0; i < dayData.length - 1; i++) {
      for (let j = i + 1; j < dayData.length; j++) {
        const d1 = dayData[i];
        const d2 = dayData[j];
        if (
          !meansByLevel[d1.lv] ||
          !sdsByLevel[d1.lv] ||
          !meansByLevel[d2.lv] ||
          !sdsByLevel[d2.lv]
        )
          continue;
        const z1 = (d1.value - meansByLevel[d1.lv]!) / sdsByLevel[d1.lv]!;
        const z2 = (d2.value - meansByLevel[d2.lv]!) / sdsByLevel[d2.lv]!;
        // 2-2s Across
        if ((z1 >= 2 && z2 >= 2) || (z1 <= -2 && z2 <= -2)) {
          violations.push({
            rule: "2-2s(across)",
            date: dateStr,
            levels: [d1.lv, d2.lv],
            indices: [d1.idx, d2.idx],
            type: "rejection",
            desc:
              "2 level (" + d1.lv + " & " + d2.lv + ") > ±2SD sisi sama (Across)",
          });
        }
        // R-4s Across
        if (Math.abs(z1 - z2) >= 4) {
          violations.push({
            rule: "R-4s(across)",
            date: dateStr,
            levels: [d1.lv, d2.lv],
            indices: [d1.idx, d2.idx],
            type: "rejection",
            desc:
              "Selisih Z ≥4 antar level (" +
              d1.lv +
              " & " +
              d2.lv +
              ") (Across)",
          });
        }
      }
    }
  });

  return violations;
}

// ============================================================
// 3. getActiveRulesBySigma — active rule set based on sigma (pure)
//
// Mirror code.gs getActiveRulesBySigma(sigma).
// Returns { rules, mode, warning }.
//   σ ≥6  → ['1-3s']                                            (World Class)
//   σ 4–6 → +['2-2s','R-4s']                                    (High Quality)
//   σ 3–4 → +['4-1s']                                           (Low Quality)
//   σ <3  → full multirule                                      (Unreliable)
//   N/A   → full multirule
// ============================================================
export function getActiveRulesBySigma(
  sigma: number | null | undefined
): { rules: string[]; mode: string; warning: string } {
  if (sigma === null || sigma === undefined || isNaN(sigma as number)) {
    return {
      rules: ["1-3s", "2-2s", "R-4s", "4-1s", "6x", "10x"],
      mode: "Sigma N/A (semua aturan aktif)",
      warning: "",
    };
  }
  const s = parseFloat(String(sigma));
  if (s >= 6)
    return {
      rules: ["1-3s"],
      mode: "Sigma ≥6 (World Class) — hanya 1-3s",
      warning: "",
    };
  if (s >= 4)
    return {
      rules: ["1-3s", "2-2s", "R-4s"],
      mode: "Sigma 4-6 (High Quality) — 1-3s, 2-2s, R-4s",
      warning: "",
    };
  if (s >= 3)
    return {
      rules: ["1-3s", "2-2s", "R-4s", "4-1s"],
      mode: "Sigma 3-4 (Low Quality) — 1-3s, 2-2s, R-4s, 4-1s",
      warning: "",
    };
  return {
    rules: ["1-3s", "2-2s", "R-4s", "4-1s", "6x", "10x"],
    mode: "Sigma <3 (Unreliable) — Multirule",
    warning: "Perbaikan Presisi/Metode Diperlukan!",
  };
}

// ============================================================
// 4. filterViolationsBySigma — tag each violation w/ sigmaActive/ignored (pure)
//
// Mirror code.gs filterViolationsBySigma(violations, sigma).
// `ignored = !sigmaActive && type === 'rejection'`.
// ============================================================
export function filterViolationsBySigma(violations: any[], sigma: number | null): any[] {
  const info = getActiveRulesBySigma(sigma);
  const activeRules = info.rules;
  return (violations || []).map((v) => {
    const ruleBase = String(v.rule).replace("(across)", "");
    const isActive = activeRules.indexOf(ruleBase) > -1;
    return {
      ...v,
      sigmaActive: isActive,
      ignored: !isActive && v.type === "rejection",
    };
  });
}

// ============================================================
// 5. categorizeWestgardError — categorize rule (pure)
//
// Mirror code.gs categorizeWestgardError(rule).
// Returns { category, desc }.
//   1-2s              → Warning
//   1-3s, R-4s        → Random Error
//   2-2s, 4-1s, 6x, 8x, 10x, 7T  → Systematic Error
//   *                 → Lainnya
// ============================================================
export function categorizeWestgardError(rule: string): {
  category: string;
  desc: string;
} {
  const r = String(rule).replace("(across)", "");
  if (r === "1-2s")
    return {
      category: "Warning",
      desc: "Peringatan — tidak menolak run, perlu pengamatan tambahan",
    };
  if (r === "1-3s")
    return {
      category: "Random Error",
      desc: "Random Error — pengukuran terisolasi melampaui batas",
    };
  if (r === "R-4s")
    return {
      category: "Random Error",
      desc: "Random Error — variabilitas dalam-run",
    };
  if (r === "2-2s")
    return {
      category: "Systematic Error",
      desc: "Systematic Shift — pergeseran sistematik",
    };
  if (r === "4-1s")
    return {
      category: "Systematic Error",
      desc: "Systematic Shift — pergeseran kecil konsisten",
    };
  if (r === "6x" || r === "8x" || r === "10x")
    return {
      category: "Systematic Error",
      desc: "Systematic Shift — pergeseran mean",
    };
  if (r === "7T")
    return {
      category: "Systematic Error",
      desc: "Systematic Trend — drift gradual",
    };
  return { category: "Lainnya", desc: "Pelanggaran lain" };
}

// ============================================================
// 6. computeSigmaForLevel — sigma for one level (pure)
//
// Mirror code.gs computeSigmaForLevel(lot, level, qcData).
// lot: { meanL1, sdL1, meanL2, sdL2, meanL3, sdL3, tea }
// qcData: array of { level1, level2, level3 }
// sigma = (TEa - |bias|) / CV
//   CV   = lotSD / lotMean * 100
//   bias = |calcMean - lotMean| / lotMean * 100   (calcMean = mean of non-zero vals)
// Returns null if lot mean/sd/tea missing or no data or CV==0.
// ============================================================
export function computeSigmaForLevel(
  lot: any,
  level: string | number,
  qcData: any[]
): number | null {
  if (!lot || !qcData) return null;
  const lv = parseInt(String(level).replace("L", ""));
  const m = parseNumSafe(lot["meanL" + lv]);
  const s = parseNumSafe(lot["sdL" + lv]);
  const tea = parseNumSafe(lot.tea);
  if (!m || !s || !tea) return null;
  const vals = qcData
    .map((q) =>
      parseNumSafe(lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3)
    )
    .filter((v) => v !== null && v !== 0) as number[];
  if (!vals.length) return null;
  let sum = 0;
  for (const v of vals) sum += v;
  const calcMean = sum / vals.length;
  const bias = Math.abs(((calcMean - m) / m) * 100);
  const cv = (s / m) * 100;
  if (!cv) return null;
  return parseFloat(((tea - bias) / cv).toFixed(2));
}

// ============================================================
// 7. getWestgardViolations30Days — DB-backed
//
// args[0]=ownerUsername, args[1]=role
// Returns all unignored rejection violations across all lots for last 30 days.
// Mirrors code.gs getWestgardViolations30Days exactly.
// ============================================================
export async function getWestgardViolations30Days(
  args: any[],
  session: SessionData | null
): Promise<any[]> {
  try {
    const ownerUsername = deriveOwner(args, session, 0);
    const role = deriveRole(args, session, 1);

    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86400000);
    const startDateISO = dateToISO(d30);
    const endDateISO = dateToISO(now);

    // Query InputQC rows for owner within last 30 days. Always scope by
    // ownerUsername (tenant isolation) — superadmin no longer bypasses;
    // sees only their own QC rows (View-As still works because
    // deriveOwner returns session.activeUsername when View-As is active).
    const where: any = { ownerUsername };
    if (startDateISO && endDateISO) {
      where.tanggal = { gte: startDateISO, lte: endDateISO };
    }

    const qcRows = await db.inputQC.findMany({ where });
    const lotIDs = Array.from(new Set(qcRows.map((r: any) => r.lotID).filter(Boolean)));
    const lots = lotIDs.length
      ? await db.lotQC.findMany({ where: { id: { in: lotIDs } } })
      : [];
    const lotMap: Record<string, any> = {};
    for (const l of lots) lotMap[l.id] = l;

    // Group QC rows by lotID
    const grouped: Record<string, { qcs: any[]; lot: any; param: string }> = {};
    for (const q of qcRows) {
      if (!grouped[q.lotID]) {
        grouped[q.lotID] = {
          qcs: [],
          lot: lotMap[q.lotID],
          param: q.parameter,
        };
      }
      grouped[q.lotID].qcs.push(q);
    }

    const allViolations: any[] = [];
    for (const lotID of Object.keys(grouped)) {
      const g = grouped[lotID];
      const lot = g.lot;
      if (!lot) continue;
      const lotObj = {
        meanL1: lot.meanL1,
        sdL1: lot.sdL1,
        meanL2: lot.meanL2,
        sdL2: lot.sdL2,
        meanL3: lot.meanL3,
        sdL3: lot.sdL3,
        tea: lot.tea,
      };
      // Sort QC by tanggal ascending
      const qcs = g.qcs.slice().sort((a: any, b: any) => {
        const da = parseDateStr(a.tanggal);
        const db2 = parseDateStr(b.tanggal);
        return (da ? da.getTime() : 0) - (db2 ? db2.getTime() : 0);
      });

      for (const lv of [1, 2, 3]) {
        const m = parseNumSafe(lotObj["meanL" + lv]);
        const s = parseNumSafe(lotObj["sdL" + lv]);
        if (!m || !s) continue;
        const vals = qcs
          .map((q: any) =>
            parseNumSafe(lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3)
          )
          .filter((v) => v !== null && v !== 0) as number[];
        if (!vals.length) continue;
        const sigma = computeSigmaForLevel(lotObj, "L" + lv, qcs);
        let viol = checkWestgardRules(vals, m, s);
        viol = filterViolationsBySigma(viol, sigma);
        for (const v of viol) {
          if (!v.ignored) {
            const cat = categorizeWestgardError(v.rule);
            allViolations.push({
              parameter: g.param,
              lotID: lotID,
              namaAlat: lot.namaAlat,
              level: "L" + lv,
              rule: v.rule,
              desc: v.desc,
              tanggal: qcs.length ? qcs[qcs.length - 1].tanggal : "",
              sigma: sigma,
              category: cat.category,
              categoryDesc: cat.desc,
            });
          }
        }
      }
    }
    return allViolations;
  } catch (e) {
    return [];
  }
}

// ============================================================
// 8. checkAndNotifyWestgard — DB-backed, e-mail disabled
//
// args[0]=paramID, args[1]=lotID, args[2]=ownerUsername, args[3]=newQCID
// Called after each new QC insert; checks last 14 days of QC for the lot;
// if any rejection rule fires, log it (skip MailApp.sendEmail — no email
// in Next.js port). Returns { ok, violations } for caller introspection.
// ============================================================
export async function checkAndNotifyWestgard(
  args: any[],
  session: SessionData | null
): Promise<{ ok: boolean; violations?: string[]; msg?: string }> {
  try {
    const paramID = args[0];
    const lotID = args[1];
    const ownerUsername = deriveOwner(args, session, 2);
    const newQCID = args[3]; // accepted for API symmetry, not used by the check itself

    const lot = await db.lotQC.findUnique({ where: { id: String(lotID) } });
    if (!lot) return { ok: false, msg: "Lot tidak ditemukan" };

    const now = new Date();
    const d14 = new Date(now.getTime() - 14 * 86400000);
    const startDateISO = dateToISO(d14);
    const endDateISO = dateToISO(now);

    const where: any = {
      lotID: String(lotID),
      ownerUsername,
    };
    if (startDateISO && endDateISO) {
      where.tanggal = { gte: startDateISO, lte: endDateISO };
    }

    const qcRows = await db.inputQC.findMany({ where });
    // Sort QC by tanggal ascending
    const qcData = qcRows.slice().sort((a: any, b: any) => {
      const da = parseDateStr(a.tanggal);
      const db2 = parseDateStr(b.tanggal);
      return (da ? da.getTime() : 0) - (db2 ? db2.getTime() : 0);
    });

    const violations: string[] = [];
    for (const lv of [1, 2, 3]) {
      const mv = parseNumSafe(lot["meanL" + lv]);
      const sv = parseNumSafe(lot["sdL" + lv]);
      if (!mv || !sv) continue;
      const vals = qcData
        .map((q: any) =>
          parseNumSafe(lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3)
        )
        .filter((v) => v !== null && v !== 0) as number[];
      if (!vals.length) continue;
      const sigma = computeSigmaForLevel(lot, "L" + lv, qcData);
      let viol = checkWestgardRules(vals, mv, sv);
      viol = filterViolationsBySigma(viol, sigma);
      viol
        .filter((v: any) => !v.ignored && v.type === "rejection")
        .forEach((v: any) => {
          violations.push(
            "L" + lv + ": " + v.rule + " — " + v.desc + " (σ=" + sigma + ")"
          );
        });
    }

    if (violations.length) {
      // Skip MailApp.sendEmail (no email in Next.js port).
      // Log the violation summary to LogActivity so operators can audit it.
      try {
        const param = await db.parameters.findUnique({
          where: { id: String(paramID) },
        });
        const paramName = param ? param.parameter : String(paramID);
        await logA(
          ownerUsername,
          "WESTGARD_VIOLATION",
          violations.join(" | ") + " [param=" + paramName + "]",
          ownerUsername
        );
      } catch {
        // swallow — best-effort log
      }
    }

    return { ok: true, violations };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}
