// ============================================================
// calculations.ts — CalculatedStats, BiasPME, SigmaCVOpt + helpers
//
// Port 1:1 dari code.gs:
//   - calcStatsFromInputQC, getCalcStats, getCalcStatById,
//     saveCalcStats, saveCalcStatsAllLevels, deleteCalcStats
//   - calcCVFromInputQC, getBiasPME, getBiasPMEById, saveBiasPME,
//     deleteBiasPME, getBiasPMEByFilter
//   - getSigmaCVOpt, getSigmaCVOptById, saveSigmaCVOpt, deleteSigmaCVOpt
//   - computeQCStats (pure helper, exported for reuse by graph module)
//
// Population SD (÷ N). Float? fields stored as null when parseNumSafe
// returns null (Prisma cannot store ''). Level stored as Int (1/2/3)
// per Prisma schema; API responses normalize back to 'L1'/'L2'/'L3'
// strings to match the original GAS API contract.
// ============================================================

import { db } from "@/lib/db";
import type { SessionData } from "@/lib/session";
import {
  genID,
  logA,
  parseNumSafe,
  parseDateStr,
  dateToISO,
  withLock,
} from "@/lib/utils-server";

// ============================================================
// Helpers — derive owner/role/logUser dari args+session
// ============================================================

function deriveOwner(args: any[], session: SessionData | null, idx: number): string {
  const fromArgs = args[idx];
  if (typeof fromArgs === "string" && fromArgs.length > 0) return fromArgs;
  if (session) {
    if (session.activeUsername) return session.activeUsername;
    if (session.username) return session.username;
  }
  return "";
}

function deriveRole(args: any[], session: SessionData | null, idx: number): string {
  const fromArgs = args[idx];
  if (typeof fromArgs === "string" && fromArgs.length > 0) return fromArgs;
  if (session) {
    if (session.activeRole) return session.activeRole;
    if (session.role) return session.role;
  }
  return "user";
}

function deriveLogUser(args: any[], session: SessionData | null, idx: number): string {
  const fromArgs = args[idx];
  if (typeof fromArgs === "string" && fromArgs.length > 0) return fromArgs;
  if (session) {
    if (session.loginUsername) return session.loginUsername;
    if (session.username) return session.username;
  }
  return "";
}

// Normalize level input ('L1' | '1' | 1) → Int 1/2/3
function normalizeLevelToInt(level: any): number {
  if (typeof level === "number") return level;
  const s = String(level ?? "").replace("L", "").trim();
  const n = parseInt(s);
  return isNaN(n) ? 0 : n;
}

// Int 1/2/3 → 'L1'/'L2'/'L3' for API responses
function levelToStr(lv: number | string): string {
  if (typeof lv === "string" && lv.startsWith("L")) return lv;
  const n = typeof lv === "number" ? lv : parseInt(String(lv).replace("L", ""));
  return "L" + (isNaN(n) ? 0 : n);
}

// LotQC column index helper (matches code.gs lot[8 + (lv-1)*3] = meanL1 etc.)
function lotMeanOf(lot: any, lv: number): number | null {
  return lot ? parseNumSafe(lot["meanL" + lv]) : null;
}
function lotSDOf(lot: any, lv: number): number | null {
  return lot ? parseNumSafe(lot["sdL" + lv]) : null;
}

// ============================================================
// calcStatsFromInputQC — core stat engine (single level)
//
// args[0]=lotID, args[1]=level, args[2]=startDate, args[3]=endDate,
// args[4]=ownerUsername
//
// Population SD (÷ N). Filters InputQC by lotID + owner + date range.
// Returns {mean, sd, cv, n}. Empty inputs → {mean:'', sd:'', cv:'', n:0}.
// ============================================================
export async function calcStatsFromInputQC(
  args: any[],
  session: SessionData | null
) {
  const lotID = args[0];
  const level = args[1];
  const startDate = args[2];
  const endDate = args[3];
  const ownerUsername = deriveOwner(args, session, 4);

  // Explicit return type — empty case uses "" to mirror code.gs exactly.
  type Ret = { mean: number | ""; sd: number | ""; cv: number | ""; n: number };
  const empty: Ret = { mean: "", sd: "", cv: "", n: 0 };
  if (!lotID || !level) return empty;

  const lvNum = normalizeLevelToInt(level);
  const colName = lvNum === 1 ? "level1" : lvNum === 2 ? "level2" : "level3";

  const where: any = { lotID: String(lotID), ownerUsername };
  const sd = parseDateStr(startDate ? String(startDate) : null);
  const ed = parseDateStr(endDate ? String(endDate) : null);
  if (sd || ed) {
    const dateFilter: any = {};
    if (sd) dateFilter.gte = dateToISO(sd);
    if (ed) dateFilter.lte = dateToISO(ed);
    where.tanggal = dateFilter;
  }

  const rows = await db.inputQC.findMany({ where });
  const vals: number[] = [];
  for (const r of rows) {
    const v = parseNumSafe(r[colName]);
    if (v !== null && v !== 0) vals.push(v);
  }
  if (!vals.length) return empty;

  let sum = 0;
  for (const v of vals) sum += v;
  const mean = sum / vals.length;
  let sqSum = 0;
  for (const v of vals) sqSum += Math.pow(v - mean, 2);
  const sdv = Math.sqrt(sqSum / vals.length); // population SD (÷ N)
  const cv = mean ? (sdv / mean) * 100 : 0;
  const result: Ret = {
    mean: parseFloat(mean.toFixed(4)),
    sd: parseFloat(sdv.toFixed(4)),
    cv: parseFloat(cv.toFixed(2)),
    n: vals.length,
  };
  return result;
}

// ============================================================
// getCalcStats — list CalcStats with enriched computed fields
//
// args[0]=ownerUsername, args[1]=role, args[2]=filter
// ============================================================
export async function getCalcStats(args: any[], session: SessionData | null) {
  try {
    const ownerUsername = deriveOwner(args, session, 0);
    const role = deriveRole(args, session, 1);
    const filter = args[2] || {};

    const paramRows = await db.parameters.findMany({ where: { ownerUsername: ownerUsername } });
    const paramMap: Record<string, string> = {};
    for (const p of paramRows) paramMap[p.id] = p.parameter;

    const lotRows = await db.lotQC.findMany({ where: { ownerUsername: ownerUsername } });
    const lotMap: Record<string, any> = {};
    for (const l of lotRows) lotMap[l.id] = l;

    const where: any = {};
    where.ownerUsername = ownerUsername;
    if (filter.paramID) where.paramID = String(filter.paramID);

    const rows = await db.calculatedStats.findMany({ where });
    return rows.map((r: any) => {
      const lot = lotMap[r.lotID];
      const lvStr = levelToStr(r.level);
      const lvNum = normalizeLevelToInt(r.level);
      const item: any = {
        statID: r.id,
        paramID: r.paramID,
        lotID: r.lotID,
        level: lvStr,
        parameter: paramMap[r.paramID] || "",
        noLot: lot ? lot.noLot : "",
        namaAlat: lot ? lot.namaAlat : "",
        calcMean: r.calcMean,
        calcSD: r.calcSD,
        calcCV: r.calcCV,
        n: r.n,
        startDate: r.startDate,
        endDate: r.endDate,
        owner: r.ownerUsername,
        tea: lot ? parseNumSafe(lot.tea) : null,
        lotMean: lot ? lotMeanOf(lot, lvNum) : null,
        lotSD: lot ? lotSDOf(lot, lvNum) : null,
      };
      if (item.lotMean && item.calcMean) {
        item.bias = parseFloat(
          (((item.calcMean - item.lotMean) / item.lotMean) * 100).toFixed(2)
        );
      }
      if (item.calcCV && item.bias !== undefined) {
        item.te = parseFloat(
          (Math.abs(item.bias) + 1.65 * item.calcCV).toFixed(2)
        );
      }
      if (item.tea && item.bias !== undefined && item.calcCV) {
        item.sigma = parseFloat(
          ((item.tea - Math.abs(item.bias)) / item.calcCV).toFixed(2)
        );
      }
      return item;
    });
  } catch (e) {
    return [];
  }
}

// ============================================================
// getCalcStatById — single lookup
// args[0]=statID, args[1]=ownerUsername, args[2]=role
// ============================================================
export async function getCalcStatById(args: any[], session: SessionData | null) {
  try {
    const statID = args[0];
    const ownerUsername = deriveOwner(args, session, 1);
    const role = deriveRole(args, session, 2);
    if (!statID) return null;
    const r = await db.calculatedStats.findFirst({ where: { id: String(statID), ownerUsername } });
    if (!r) return null;
    return {
      statID: r.id,
      paramID: r.paramID,
      lotID: r.lotID,
      level: levelToStr(r.level),
      calcMean: r.calcMean,
      calcSD: r.calcSD,
      calcCV: r.calcCV,
      n: r.n,
      startDate: r.startDate,
      endDate: r.endDate,
      owner: r.ownerUsername,
    };
  } catch (e) {
    return null;
  }
}

// ============================================================
// saveCalcStats — single-level save
// args[0]=payload, args[1]=ownerUsername, args[2]=logUser
// Auto-computes mean/sd/cv/n if startDate+endDate+lotID+level provided.
// ============================================================
export async function saveCalcStats(args: any[], session: SessionData | null) {
  return withLock("calcstats_save", async () => {
    const payload = args[0] || {};
    const ownerUsername = deriveOwner(args, session, 1);
    const logUser = deriveLogUser(args, session, 2);

    let mean: number | "" = "";
    let sd: number | "" = "";
    let cv: number | "" = "";
    let n = 0;

    if (payload.startDate && payload.endDate && payload.lotID && payload.level) {
      const stats = await calcStatsFromInputQC(
        [
          payload.lotID,
          payload.level,
          payload.startDate,
          payload.endDate,
          ownerUsername,
        ],
        session
      );
      mean = stats.mean;
      sd = stats.sd;
      cv = stats.cv;
      n = stats.n;
    }

    const startDateISO = payload.startDate ? dateToISO(parseDateStr(String(payload.startDate))) : null;
    const endDateISO = payload.endDate ? dateToISO(parseDateStr(String(payload.endDate))) : null;
    const lvNum = normalizeLevelToInt(payload.level);

    // Prisma Float? cannot store "" — convert empty to null at storage boundary.
    const dataFields: any = {
      paramID: String(payload.paramID ?? ""),
      lotID: String(payload.lotID ?? ""),
      level: lvNum,
      calcMean: typeof mean === "number" ? mean : null,
      calcSD: typeof sd === "number" ? sd : null,
      calcCV: typeof cv === "number" ? cv : null,
      n,
      startDate: startDateISO,
      endDate: endDateISO,
      ownerUsername,
    };

    const statID = payload.statID || payload.id;
    if (statID) {
      const existing = await db.calculatedStats.findFirst({
        where: { id: String(statID), ownerUsername },
      });
      if (!existing) {
        return { ok: false, msg: "Stats tidak ditemukan" };
      }
      await db.calculatedStats.update({
        where: { id: String(statID) },
        data: dataFields,
      });
      return { ok: true, mean, sd, cv, n };
    }

    const newID = genID("STAT");
    await db.calculatedStats.create({
      data: { id: newID, ...dataFields },
    });
    return { ok: true, mean, sd, cv, n };
  });
}

// ============================================================
// saveCalcStatsAllLevels — L1+L2+L3 in one call
// args[0]=payload {paramID, lotID, startDate, endDate}, args[1]=ownerUsername,
// args[2]=logUser.
// For each level: calc stats, then upsert by (paramID, lotID, level, ownerUsername).
// ============================================================
export async function saveCalcStatsAllLevels(args: any[], session: SessionData | null) {
  return withLock("calcstats_saveall", async () => {
    try {
      const payload = args[0] || {};
      const ownerUsername = deriveOwner(args, session, 1);
      const logUser = deriveLogUser(args, session, 2);

      if (!payload.paramID || !payload.lotID)
        return { ok: false, msg: "Parameter dan Lot wajib" };
      if (!payload.startDate || !payload.endDate)
        return { ok: false, msg: "Rentang tanggal wajib" };

      const results: Record<string, any> = {};
      const savedLevels: string[] = [];

      const startDateISO = dateToISO(parseDateStr(String(payload.startDate)));
      const endDateISO = dateToISO(parseDateStr(String(payload.endDate)));

      for (const lvStr of ["L1", "L2", "L3"]) {
        const stats = await calcStatsFromInputQC(
          [payload.lotID, lvStr, payload.startDate, payload.endDate, ownerUsername],
          session
        );
        if (!stats.n) {
          results[lvStr] = null;
          continue;
        }
        const lvNum = normalizeLevelToInt(lvStr);
        // Look up existing row by (paramID, lotID, level, ownerUsername)
        const existing = await db.calculatedStats.findFirst({
          where: {
            paramID: String(payload.paramID),
            lotID: String(payload.lotID),
            level: lvNum,
            ownerUsername,
          },
        });
        const dataFields = {
          paramID: String(payload.paramID),
          lotID: String(payload.lotID),
          level: lvNum,
          calcMean: typeof stats.mean === "number" ? stats.mean : null,
          calcSD: typeof stats.sd === "number" ? stats.sd : null,
          calcCV: typeof stats.cv === "number" ? stats.cv : null,
          n: stats.n,
          startDate: startDateISO,
          endDate: endDateISO,
          ownerUsername,
        };
        if (existing) {
          await db.calculatedStats.update({
            where: { id: existing.id },
            data: dataFields,
          });
        } else {
          await db.calculatedStats.create({
            data: { id: genID("STAT"), ...dataFields },
          });
        }
        results[lvStr] = stats;
        savedLevels.push(lvStr);
      }

      await logA(
        ownerUsername,
        "SAVE_CALC_STATS",
        savedLevels.join(","),
        logUser
      );
      return {
        ok: true,
        msg: savedLevels.length + " level dihitung & disimpan",
        results,
        savedLevels,
      };
    } catch (e: any) {
      return { ok: false, msg: e?.message || String(e) };
    }
  });
}

// ============================================================
// deleteCalcStats — delete by statID + owner
// args[0]=statID, args[1]=ownerUsername, args[2]=logUser
// ============================================================
export async function deleteCalcStats(args: any[], session: SessionData | null) {
  return withLock("calcstats_delete", async () => {
    const statID = args[0];
    const ownerUsername = deriveOwner(args, session, 1);
    if (!statID) return { ok: false, msg: "Stats tidak ditemukan" };
    const existing = await db.calculatedStats.findFirst({
      where: { id: String(statID), ownerUsername },
    });
    if (!existing) return { ok: false, msg: "Stats tidak ditemukan" };
    await db.calculatedStats.delete({ where: { id: String(statID) } });
    return { ok: true };
  });
}

// ============================================================
// calcCVFromInputQC — population CV per level
// args[0]=lotID, args[1]=startDate, args[2]=endDate, args[3]=ownerUsername
// Returns {cvL1, cvL2, cvL3, nL1, nL2, nL3}.
// ============================================================
export async function calcCVFromInputQC(args: any[], session: SessionData | null) {
  const lotID = args[0];
  const startDate = args[1];
  const endDate = args[2];
  const ownerUsername = deriveOwner(args, session, 3);

  if (!lotID) {
    return { cvL1: null, cvL2: null, cvL3: null, nL1: 0, nL2: 0, nL3: 0 };
  }

  const where: any = { lotID: String(lotID), ownerUsername };
  const sd = parseDateStr(startDate ? String(startDate) : null);
  const ed = parseDateStr(endDate ? String(endDate) : null);
  if (sd || ed) {
    const dateFilter: any = {};
    if (sd) dateFilter.gte = dateToISO(sd);
    if (ed) dateFilter.lte = dateToISO(ed);
    where.tanggal = dateFilter;
  }

  const rows = await db.inputQC.findMany({ where });
  const vals: number[][] = [[], [], []];
  for (const r of rows) {
    (["level1", "level2", "level3"] as const).forEach((col, idx) => {
      const n = parseNumSafe(r[col]);
      if (n !== null && n !== 0) vals[idx].push(n);
    });
  }

  function calcCV(arr: number[]): { cv: number | null; n: number } {
    if (!arr.length) return { cv: null, n: 0 };
    let sum = 0;
    for (const v of arr) sum += v;
    const mean = sum / arr.length;
    if (!mean) return { cv: null, n: arr.length };
    let sq = 0;
    for (const v of arr) sq += Math.pow(v - mean, 2);
    const sdv = Math.sqrt(sq / arr.length);
    return { cv: parseFloat((sdv / mean * 100).toFixed(2)), n: arr.length };
  }

  const c1 = calcCV(vals[0]);
  const c2 = calcCV(vals[1]);
  const c3 = calcCV(vals[2]);
  return {
    cvL1: c1.cv,
    cvL2: c2.cv,
    cvL3: c3.cv,
    nL1: c1.n,
    nL2: c2.n,
    nL3: c3.n,
  };
}

// ============================================================
// v9.22 — Z-Score helpers (QC & PME)
//
// Z-Score QC  : Z = (nilai QC − meanLot) / SDLot, dihitung dari InputQC
//               dalam rentang tanggal (qcStartDate→qcEndDate, fallback CV).
// Z-Score PME : Z = (hasil − meanPeserta) / SDPA (peer group eksternal).
// Interpretasi standar internasional (ISO 13528 / EQAS):
//   |Z| ≤ 1 sangat memuaskan · |Z| ≤ 2 memuaskan · 2<|Z|<3 meragukan
//   |Z| ≥ 3 tidak memuaskan (perlu tindakan)
// ============================================================

interface QCZStats {
  n: number;
  meanZ: number | null;
  sdZ: number | null;
  minZ: number | null;
  maxZ: number | null;
  maxAbsZ: number | null;
  nWarn: number; // 2 < |Z| < 3
  nReject: number; // |Z| >= 3
}

function computeZStats(arr: number[]): QCZStats {
  if (!arr.length)
    return { n: 0, meanZ: null, sdZ: null, minZ: null, maxZ: null, maxAbsZ: null, nWarn: 0, nReject: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length);
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  return {
    n: arr.length,
    meanZ: +mean.toFixed(3),
    sdZ: +sd.toFixed(3),
    minZ: +min.toFixed(3),
    maxZ: +max.toFixed(3),
    maxAbsZ: +Math.max(Math.abs(min), Math.abs(max)).toFixed(3),
    nWarn: arr.filter((z) => Math.abs(z) > 2 && Math.abs(z) < 3).length,
    nReject: arr.filter((z) => Math.abs(z) >= 3).length,
  };
}

// Ambil array Z per level dari baris InputQC (lot map sudah tersedia)
function collectZPerLevel(
  qcRows: any[],
  lotMap: Record<string, any>,
  lv: number
): number[] {
  const out: number[] = [];
  for (const q of qcRows) {
    const lot = lotMap[q.lotID];
    if (!lot) continue;
    const m = lotMeanOf(lot, lv);
    const s = lotSDOf(lot, lv);
    const col = ("level" + lv) as "level1" | "level2" | "level3";
    const v = parseNumSafe(q[col]);
    if (v === null || v === 0 || !m || !s) continue;
    out.push((v - m) / s);
  }
  return out;
}

// ============================================================
// getBiasPME — list with per-level computed details
// args[0]=ownerUsername, args[1]=role, args[2]=filter
// v9.22: + SDPA, Z-Score PME, dan statistik Z-Score QC per level
//        (dihitung dari InputQC rentang qcStartDate→qcEndDate,
//         fallback ke cvStartDate→cvEndDate)
// ============================================================
export async function getBiasPME(args: any[], session: SessionData | null) {
  try {
    const ownerUsername = deriveOwner(args, session, 0);
    const role = deriveRole(args, session, 1);
    const filter = args[2] || {};

    const lotRows = await db.lotQC.findMany({ where: { ownerUsername: ownerUsername } });
    const lotMap: Record<string, any> = {};
    for (const l of lotRows) lotMap[l.id] = l;

    const where: any = {};
    where.ownerUsername = ownerUsername;
    if (filter.paramID) where.paramID = String(filter.paramID);
    if (filter.lotID) where.lotID = String(filter.lotID);
    // v9.23 — filter siklus/tahun/ceklist multi-parameter (submenu Bias PME)
    if (filter.siklus) where.siklus = String(filter.siklus);
    if (filter.tahun) where.tahun = String(filter.tahun);
    if (Array.isArray(filter.paramIDs) && filter.paramIDs.length > 0) {
      where.paramID = { in: filter.paramIDs.map((x: any) => String(x)) };
    }

    const rows = await db.biasPME.findMany({ where });

    // ---- v9.22: preload InputQC untuk Z-Score QC ----
    // Kumpulkan rentang union per paramID (hemat query), lalu fetch sekali.
    const paramRanges: Record<string, { s: string; e: string }> = {};
    for (const r of rows) {
      const s = r.qcStartDate || r.cvStartDate || null;
      const e = r.qcEndDate || r.cvEndDate || null;
      if (!s && !e) continue;
      const cur = paramRanges[r.paramID];
      if (!cur) {
        paramRanges[r.paramID] = { s: s || "0000-01-01", e: e || "9999-12-31" };
      } else {
        if (s && s < cur.s) cur.s = s;
        if (e && e > cur.e) cur.e = e;
      }
    }
    const qcByParam: Record<string, any[]> = {};
    for (const pid of Object.keys(paramRanges)) {
      try {
        qcByParam[pid] = await db.inputQC.findMany({
          where: {
            paramID: pid,
            ownerUsername,
            tanggal: { gte: paramRanges[pid].s, lte: paramRanges[pid].e },
          },
          select: { lotID: true, tanggal: true, level1: true, level2: true, level3: true },
        });
      } catch {
        qcByParam[pid] = [];
      }
    }

    return rows.map((r: any) => {
      const lot = lotMap[r.lotID];
      const item: any = {
        pmeID: r.id,
        paramID: r.paramID,
        lotID: r.lotID,
        namaAlat: r.namaAlat,
        methode: r.methode,
        satuan: r.satuan,
        siklus: r.siklus,
        tahun: r.tahun,
        hasilL1: r.hasilL1,
        hasilL2: r.hasilL2,
        hasilL3: r.hasilL3,
        meanPesertaL1: r.meanPesertaL1,
        meanPesertaL2: r.meanPesertaL2,
        meanPesertaL3: r.meanPesertaL3,
        tea: r.tea,
        cvL1: r.cvL1,
        cvL2: r.cvL2,
        cvL3: r.cvL3,
        cvStartDate: r.cvStartDate,
        cvEndDate: r.cvEndDate,
        // v9.22 — Z-Score PME & rentang QC
        sdpaL1: r.sdpaL1,
        sdpaL2: r.sdpaL2,
        sdpaL3: r.sdpaL3,
        zScoreL1: r.zScoreL1,
        zScoreL2: r.zScoreL2,
        zScoreL3: r.zScoreL3,
        qcStartDate: r.qcStartDate || r.cvStartDate || null,
        qcEndDate: r.qcEndDate || r.cvEndDate || null,
        owner: r.ownerUsername,
        details: {} as Record<string, any>,
      };

      // v9.22: siapkan baris QC milik row ini (filter rentang row sendiri)
      const rowZS = r.qcStartDate || r.cvStartDate || null;
      const rowZE = r.qcEndDate || r.cvEndDate || null;
      let rowQcRows: any[] = [];
      if (rowZS || rowZE) {
        rowQcRows = qcByParam[r.paramID] || [];
        rowQcRows = rowQcRows.filter(
          (q: any) =>
            (!rowZS || (q.tanggal || "") >= rowZS) &&
            (!rowZE || (q.tanggal || "") <= rowZE)
        );
      }

      for (const lv of [1, 2, 3]) {
        const lotMean = lot ? lotMeanOf(lot, lv) : null;
        const lotSD = lot ? lotSDOf(lot, lv) : null;
        const hasil = parseNumSafe(item["hasilL" + lv]);
        const meanP = parseNumSafe(item["meanPesertaL" + lv]);
        const cvUsed = parseNumSafe(item["cvL" + lv]);
        const bias = hasil && meanP ? Math.abs((hasil - meanP) / meanP * 100) : null;
        let cv: number | null = cvUsed;
        if (!cv && lotMean && lotSD) cv = (lotSD / lotMean) * 100;
        const te = bias !== null && cv !== null ? Math.abs(bias) + 1.65 * cv : null;
        const tea = parseNumSafe(item.tea);
        const sigma = tea !== null && bias !== null && cv ? (tea - bias) / cv : null;

        // v9.22 — Z-Score PME efektif (input user, atau auto (hasil−meanP)/SDPA)
        const sdpaV = parseNumSafe(item["sdpaL" + lv]);
        let zPME = parseNumSafe(item["zScoreL" + lv]);
        if (zPME === null && sdpaV && hasil !== null && meanP !== null && meanP !== 0) {
          zPME = (hasil - meanP) / sdpaV;
        }

        // v9.22 — statistik Z-Score QC dari InputQC rentang tanggal
        const qcZ: QCZStats | null =
          rowZS || rowZE ? computeZStats(collectZPerLevel(rowQcRows, lotMap, lv)) : null;

        item.details["L" + lv] = {
          mean: lotMean ? parseFloat(lotMean.toFixed(3)) : null,
          sd: lotSD ? parseFloat(lotSD.toFixed(3)) : null,
          cv: cv !== null ? parseFloat(cv.toFixed(2)) : null,
          bias: bias !== null ? parseFloat(bias.toFixed(2)) : null,
          te: te !== null ? parseFloat(te.toFixed(2)) : null,
          tea,
          sigma: sigma !== null ? parseFloat(sigma.toFixed(2)) : null,
          zPME: zPME !== null ? parseFloat(zPME.toFixed(3)) : null,
          sdpa: sdpaV,
          qcZ,
        };
      }
      return item;
    });
  } catch (e) {
    return [];
  }
}

// ============================================================
// getBiasPMEById — single lookup (no details)
// args[0]=pmeID, args[1]=ownerUsername, args[2]=role
// ============================================================
export async function getBiasPMEById(args: any[], session: SessionData | null) {
  try {
    const pmeID = args[0];
    const ownerUsername = deriveOwner(args, session, 1);
    const role = deriveRole(args, session, 2);
    if (!pmeID) return null;
    const r = await db.biasPME.findFirst({ where: { id: String(pmeID), ownerUsername } });
    if (!r) return null;
    return {
      pmeID: r.id,
      paramID: r.paramID,
      lotID: r.lotID,
      namaAlat: r.namaAlat,
      methode: r.methode,
      satuan: r.satuan,
      siklus: r.siklus,
      tahun: r.tahun,
      hasilL1: r.hasilL1,
      hasilL2: r.hasilL2,
      hasilL3: r.hasilL3,
      meanPesertaL1: r.meanPesertaL1,
      meanPesertaL2: r.meanPesertaL2,
      meanPesertaL3: r.meanPesertaL3,
      tea: r.tea,
      cvL1: r.cvL1,
      cvL2: r.cvL2,
      cvL3: r.cvL3,
      cvStartDate: r.cvStartDate,
      cvEndDate: r.cvEndDate,
      // v9.22 — Z-Score PME & rentang QC
      sdpaL1: r.sdpaL1,
      sdpaL2: r.sdpaL2,
      sdpaL3: r.sdpaL3,
      zScoreL1: r.zScoreL1,
      zScoreL2: r.zScoreL2,
      zScoreL3: r.zScoreL3,
      qcStartDate: r.qcStartDate,
      qcEndDate: r.qcEndDate,
      owner: r.ownerUsername,
    };
  } catch (e) {
    return null;
  }
}

// ============================================================
// saveBiasPME — create (genID 'PME_') or update
// args[0]=payload, args[1]=ownerUsername, args[2]=logUser
// Auto-computes CV from InputQC date range if cvStartDate+cvEndDate+lotID provided.
// ============================================================
export async function saveBiasPME(args: any[], session: SessionData | null) {
  return withLock("biaspme_save", async () => {
    const payload = args[0] || {};
    const ownerUsername = deriveOwner(args, session, 1);
    const logUser = deriveLogUser(args, session, 2);

    let cvL1: number | null = null;
    let cvL2: number | null = null;
    let cvL3: number | null = null;
    if (payload.cvStartDate && payload.cvEndDate && payload.lotID) {
      const cvStats = await calcCVFromInputQC(
        [payload.lotID, payload.cvStartDate, payload.cvEndDate, ownerUsername],
        session
      );
      cvL1 = cvStats.cvL1;
      cvL2 = cvStats.cvL2;
      cvL3 = cvStats.cvL3;
    } else {
      cvL1 = parseNumSafe(payload.cvL1);
      cvL2 = parseNumSafe(payload.cvL2);
      cvL3 = parseNumSafe(payload.cvL3);
    }

    const cvStartISO = payload.cvStartDate
      ? dateToISO(parseDateStr(String(payload.cvStartDate)))
      : null;
    const cvEndISO = payload.cvEndDate
      ? dateToISO(parseDateStr(String(payload.cvEndDate)))
      : null;
    const qcStartISO = payload.qcStartDate
      ? dateToISO(parseDateStr(String(payload.qcStartDate)))
      : null;
    const qcEndISO = payload.qcEndDate
      ? dateToISO(parseDateStr(String(payload.qcEndDate)))
      : null;
    const tahun = payload.tahun ? String(payload.tahun) : String(new Date().getFullYear());

    // v9.22 — SDPA & Z-Score PME (auto: Z=(hasil−meanPeserta)/SDPA jika Z kosong)
    const sdpaIn: (number | null)[] = [
      parseNumSafe(payload.sdpaL1),
      parseNumSafe(payload.sdpaL2),
      parseNumSafe(payload.sdpaL3),
    ];
    const zOut: (number | null)[] = [];
    for (let i = 0; i < 3; i++) {
      const h = parseNumSafe(payload["hasilL" + (i + 1)]);
      const mp = parseNumSafe(payload["meanPesertaL" + (i + 1)]);
      let z = parseNumSafe(payload["zScoreL" + (i + 1)]);
      if (z === null && sdpaIn[i] && h !== null && mp !== null && mp !== 0) {
        z = (h - mp) / (sdpaIn[i] as number);
      }
      zOut.push(z !== null ? +z.toFixed(4) : null);
    }

    const dataFields: any = {
      paramID: String(payload.paramID ?? ""),
      lotID: String(payload.lotID ?? ""),
      namaAlat: payload.namaAlat ? String(payload.namaAlat) : null,
      methode: payload.methode ? String(payload.methode) : null,
      satuan: payload.satuan ? String(payload.satuan) : null,
      siklus: payload.siklus ? String(payload.siklus) : null,
      tahun,
      hasilL1: parseNumSafe(payload.hasilL1),
      hasilL2: parseNumSafe(payload.hasilL2),
      hasilL3: parseNumSafe(payload.hasilL3),
      meanPesertaL1: parseNumSafe(payload.meanPesertaL1),
      meanPesertaL2: parseNumSafe(payload.meanPesertaL2),
      meanPesertaL3: parseNumSafe(payload.meanPesertaL3),
      tea: parseNumSafe(payload.tea),
      cvL1,
      cvL2,
      cvL3,
      cvStartDate: cvStartISO,
      cvEndDate: cvEndISO,
      // v9.22 — Z-Score PME & rentang QC
      sdpaL1: sdpaIn[0],
      sdpaL2: sdpaIn[1],
      sdpaL3: sdpaIn[2],
      zScoreL1: zOut[0],
      zScoreL2: zOut[1],
      zScoreL3: zOut[2],
      qcStartDate: qcStartISO,
      qcEndDate: qcEndISO,
      ownerUsername,
    };

    const pmeID = payload.pmeID || payload.id;
    if (pmeID) {
      const existing = await db.biasPME.findFirst({
        where: { id: String(pmeID), ownerUsername },
      });
      if (!existing) {
        return { ok: false, msg: "PME tidak ditemukan" };
      }
      await db.biasPME.update({
        where: { id: String(pmeID) },
        data: dataFields,
      });
      await logA(ownerUsername, "EDIT_PME", String(pmeID), logUser);
      return { ok: true };
    }

    const newID = genID("PME");
    await db.biasPME.create({
      data: { id: newID, ...dataFields },
    });
    await logA(ownerUsername, "ADD_PME", newID, logUser);
    return { ok: true };
  });
}

// ============================================================
// deleteBiasPME — delete by pmeID + owner
// args[0]=pmeID, args[1]=ownerUsername, args[2]=logUser
// ============================================================
export async function deleteBiasPME(args: any[], session: SessionData | null) {
  return withLock("biaspme_delete", async () => {
    const pmeID = args[0];
    const ownerUsername = deriveOwner(args, session, 1);
    const logUser = deriveLogUser(args, session, 2);
    if (!pmeID) return { ok: false, msg: "PME tidak ditemukan" };
    const existing = await db.biasPME.findFirst({
      where: { id: String(pmeID), ownerUsername },
    });
    if (!existing) return { ok: false, msg: "PME tidak ditemukan" };
    await db.biasPME.delete({ where: { id: String(pmeID) } });
    await logA(ownerUsername, "DEL_PME", String(pmeID), logUser);
    return { ok: true };
  });
}

// ============================================================
// getBiasPMEByFilter — latest matching PME; returns per-level bias/hasil/meanPeserta
// args[0]=paramID, args[1]=lotID, args[2]=siklus, args[3]=tahun, args[4]=ownerUsername
// ============================================================
export async function getBiasPMEByFilter(args: any[], session: SessionData | null) {
  try {
    const paramID = args[0];
    const lotID = args[1];
    const siklus = args[2];
    const tahun = args[3];
    const ownerUsername = deriveOwner(args, session, 4);

    const where: any = { ownerUsername };
    if (paramID) where.paramID = String(paramID);
    if (lotID) where.lotID = String(lotID);
    if (siklus) where.siklus = String(siklus);
    if (tahun) where.tahun = String(tahun);

    const rows = await db.biasPME.findMany({
      where,
      orderBy: { id: "asc" }, // mirror "data[data.length-1]" = last appended row
    });
    if (!rows.length) return { ok: false, msg: "Data PME tidak ditemukan" };

    const latest = rows[rows.length - 1];
    const result: any = {
      ok: true,
      pmeID: latest.id,
      siklus: latest.siklus,
      tahun: latest.tahun,
    };
    for (const lv of [1, 2, 3]) {
      const hasil = parseNumSafe(latest["hasilL" + lv]);
      const meanP = parseNumSafe(latest["meanPesertaL" + lv]);
      const bias = hasil && meanP ? Math.abs((hasil - meanP) / meanP * 100) : null;
      result["biasL" + lv] = bias !== null ? parseFloat(bias.toFixed(2)) : null;
      result["hasilL" + lv] = hasil;
      result["meanPesertaL" + lv] = meanP;
    }
    return result;
  } catch (e) {
    return [];
  }
}

// ============================================================
// getSigmaCVOpt — list with per-level details
// args[0]=ownerUsername, args[1]=role, args[2]=filter
// details.Lv.bias uses biasPME1/2/3 columns; fallback to lotMean-based bias.
// ============================================================
export async function getSigmaCVOpt(args: any[], session: SessionData | null) {
  try {
    const ownerUsername = deriveOwner(args, session, 0);
    const role = deriveRole(args, session, 1);
    const filter = args[2] || {};

    const paramRows = await db.parameters.findMany({ where: { ownerUsername: ownerUsername } });
    const paramMap: Record<string, string> = {};
    for (const p of paramRows) paramMap[p.id] = p.parameter;

    const lotRows = await db.lotQC.findMany({ where: { ownerUsername: ownerUsername } });
    const lotMap: Record<string, any> = {};
    for (const l of lotRows) lotMap[l.id] = l;

    const where: any = {};
    where.ownerUsername = ownerUsername;
    if (filter.paramID) where.paramID = String(filter.paramID);

    const rows = await db.sigmaCVOpt.findMany({ where });
    const out: any[] = [];
    for (const r of rows) {
      const lot = lotMap[r.lotID];
      const item: any = {
        cvOptID: r.id,
        paramID: r.paramID,
        lotID: r.lotID,
        namaAlat: r.namaAlat,
        startDate: r.startDate,
        endDate: r.endDate,
        avgSigma: r.avgSigma,
        avgSigmaL12: r.avgSigmaL12,
        tea: r.tea,
        nqc: r.nqc,
        catatan: r.catatan,
        owner: r.ownerUsername,
        parameter: paramMap[r.paramID] || "",
        noLot: lot ? lot.noLot : "",
        details: {} as Record<string, any>,
        siklusPME: r.siklusPME || "",
        tahunSiklus: r.tahunSiklus || "",
        biasPME1: r.biasPME1,
        biasPME2: r.biasPME2,
        biasPME3: r.biasPME3,
      };
      if (r.startDate && r.endDate && lot) {
        for (const lv of [1, 2, 3]) {
          const lotMean = lotMeanOf(lot, lv);
          const tea = parseNumSafe(r.tea);
          const stats = await calcStatsFromInputQC(
            [r.lotID, "L" + lv, r.startDate, r.endDate, ownerUsername],
            session
          );
          if (!stats.n) {
            item.details["L" + lv] = null;
            continue;
          }
          const biasPME = parseNumSafe(r["biasPME" + lv]);
          let bias: number | null =
            biasPME !== null && biasPME !== (undefined as any)
              ? Math.abs(biasPME)
              : null;
          // stats.n > 0 guaranteed here, so stats.mean/cv are numbers.
          const calcMean = stats.mean as number;
          const calcCV = stats.cv as number;
          if (bias === null && lotMean) {
            bias = Math.abs((calcMean - lotMean) / lotMean * 100);
          }
          const te = bias !== null ? bias + 1.65 * calcCV : null;
          const sigma = tea && bias !== null && calcCV ? (tea - bias) / calcCV : null;
          item.details["L" + lv] = {
            mean: stats.mean,
            sd: stats.sd,
            cv: stats.cv,
            n: stats.n,
            bias: bias !== null ? parseFloat(bias.toFixed(2)) : null,
            te: te !== null ? parseFloat(te.toFixed(2)) : null,
            tea,
            sigma: sigma !== null ? parseFloat(sigma.toFixed(2)) : null,
          };
        }
      }
      out.push(item);
    }
    return out;
  } catch (e) {
    return [];
  }
}

// ============================================================
// getSigmaCVOptById — single lookup
// args[0]=cvOptID, args[1]=ownerUsername, args[2]=role
// ============================================================
export async function getSigmaCVOptById(args: any[], session: SessionData | null) {
  try {
    const cvOptID = args[0];
    const ownerUsername = deriveOwner(args, session, 1);
    const role = deriveRole(args, session, 2);
    if (!cvOptID) return null;
    const r = await db.sigmaCVOpt.findFirst({ where: { id: String(cvOptID), ownerUsername } });
    if (!r) return null;
    return {
      cvOptID: r.id,
      paramID: r.paramID,
      lotID: r.lotID,
      namaAlat: r.namaAlat,
      startDate: r.startDate,
      endDate: r.endDate,
      avgSigma: r.avgSigma,
      avgSigmaL12: r.avgSigmaL12,
      tea: r.tea,
      nqc: r.nqc,
      catatan: r.catatan,
      owner: r.ownerUsername,
      siklusPME: r.siklusPME || "",
      tahunSiklus: r.tahunSiklus || "",
      biasPME1: r.biasPME1,
      biasPME2: r.biasPME2,
      biasPME3: r.biasPME3,
    };
  } catch (e) {
    return null;
  }
}

// ============================================================
// saveSigmaCVOpt — create (genID 'CVOPT_') or update
// args[0]=payload, args[1]=ownerUsername, args[2]=logUser
// Recomputes avgSigma and avgSigmaL12 from per-level sigma.
// biasPME1/2/3 used if supplied, else lotMean fallback.
// ============================================================
export async function saveSigmaCVOpt(args: any[], session: SessionData | null) {
  return withLock("sigmacvopt_save", async () => {
    const payload = args[0] || {};
    const ownerUsername = deriveOwner(args, session, 1);
    const logUser = deriveLogUser(args, session, 2);

    let avgSigma: number | string = "";
    let avgSigmaL12: number | string = "";

    if (payload.lotID && payload.startDate && payload.endDate) {
      const lot = await db.lotQC.findUnique({ where: { id: String(payload.lotID) } });
      const tea =
        parseNumSafe(payload.tea) ||
        (lot ? parseNumSafe(lot.tea) : 0) ||
        0;
      const sigs: number[] = [];
      const sigs12: number[] = [];
      for (const lv of [1, 2, 3]) {
        const stats = await calcStatsFromInputQC(
          [payload.lotID, "L" + lv, payload.startDate, payload.endDate, ownerUsername],
          session
        );
        if (!stats.n || !lot) continue;
        const biasPME = parseNumSafe(payload["biasPME" + lv]);
        let bias: number | null =
          biasPME !== null ? Math.abs(biasPME) : null;
        // stats.n > 0 guaranteed here, so stats.mean/cv are numbers.
        const calcMean = stats.mean as number;
        const cv = stats.cv as number;
        if (bias === null) {
          const lotMean = lotMeanOf(lot, lv);
          if (lotMean) bias = Math.abs((calcMean - lotMean) / lotMean * 100);
        }
        if (tea && cv && bias !== null) {
          const sg = parseFloat(((tea - bias) / cv).toFixed(2));
          sigs.push(sg);
          if (lv <= 2) sigs12.push(sg);
        }
      }
      if (sigs.length)
        avgSigma = parseFloat(
          (sigs.reduce((a, b) => a + b, 0) / sigs.length).toFixed(2)
        );
      if (sigs12.length)
        avgSigmaL12 = parseFloat(
          (sigs12.reduce((a, b) => a + b, 0) / sigs12.length).toFixed(2)
        );
    }

    const startISO = payload.startDate
      ? dateToISO(parseDateStr(String(payload.startDate)))
      : null;
    const endISO = payload.endDate
      ? dateToISO(parseDateStr(String(payload.endDate)))
      : null;

    const dataFields: any = {
      paramID: String(payload.paramID ?? ""),
      lotID: String(payload.lotID ?? ""),
      namaAlat: payload.namaAlat ? String(payload.namaAlat) : null,
      startDate: startISO,
      endDate: endISO,
      avgSigma: typeof avgSigma === "number" ? avgSigma : null,
      avgSigmaL12: typeof avgSigmaL12 === "number" ? avgSigmaL12 : null,
      tea: parseNumSafe(payload.tea),
      nqc: payload.nqc ? parseInt(String(payload.nqc)) || 0 : 0,
      catatan: payload.catatan ? String(payload.catatan) : null,
      ownerUsername,
      siklusPME: payload.siklusPME ? String(payload.siklusPME) : null,
      tahunSiklus: payload.tahunSiklus ? String(payload.tahunSiklus) : null,
      biasPME1: parseNumSafe(payload.biasPME1),
      biasPME2: parseNumSafe(payload.biasPME2),
      biasPME3: parseNumSafe(payload.biasPME3),
    };

    const cvOptID = payload.cvOptID || payload.id;
    if (cvOptID) {
      const existing = await db.sigmaCVOpt.findFirst({
        where: { id: String(cvOptID), ownerUsername },
      });
      if (!existing) {
        return { ok: false, msg: "Data tidak ditemukan" };
      }
      await db.sigmaCVOpt.update({
        where: { id: String(cvOptID) },
        data: dataFields,
      });
      await logA(ownerUsername, "EDIT_CVOPT", String(cvOptID), logUser);
      return { ok: true, avgSigma, avgSigmaL12 };
    }

    const newID = genID("CVOPT");
    await db.sigmaCVOpt.create({
      data: { id: newID, ...dataFields },
    });
    await logA(ownerUsername, "ADD_CVOPT", newID, logUser);
    return { ok: true, avgSigma, avgSigmaL12 };
  });
}

// ============================================================
// deleteSigmaCVOpt — delete by cvOptID + owner
// args[0]=cvOptID, args[1]=ownerUsername, args[2]=logUser
// ============================================================
export async function deleteSigmaCVOpt(args: any[], session: SessionData | null) {
  return withLock("sigmacvopt_delete", async () => {
    const cvOptID = args[0];
    const ownerUsername = deriveOwner(args, session, 1);
    const logUser = deriveLogUser(args, session, 2);
    if (!cvOptID) return { ok: false, msg: "Data tidak ditemukan" };
    const existing = await db.sigmaCVOpt.findFirst({
      where: { id: String(cvOptID), ownerUsername },
    });
    if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
    await db.sigmaCVOpt.delete({ where: { id: String(cvOptID) } });
    await logA(ownerUsername, "DEL_CVOPT", String(cvOptID), logUser);
    return { ok: true };
  });
}

// ============================================================
// computeQCStats — pure helper (exported for reuse by graph module)
//
// Mirror code.gs computeQCStats(qcData, lot).
// Returns { L1: {n, mean, sd, cv, bias, unc, te, sigma, targetMean, targetSD, tea}, ... }
// Population SD (÷ N). unc = CV/√N. te = |bias|+1.65·CV.
// sigma = (tea-|bias|)/CV.
// Level entry set to null when no non-zero values.
// ============================================================
export function computeQCStats(qcData: any[], lot: any): Record<string, any> {
  const stats: Record<string, any> = {};
  for (const lv of [1, 2, 3]) {
    const m = lot ? parseNumSafe(lot["meanL" + lv]) : null;
    const s = lot ? parseNumSafe(lot["sdL" + lv]) : null;
    const tea = lot ? parseNumSafe(lot.tea) : null;
    const vals: number[] = (qcData || [])
      .map((q) =>
        parseNumSafe(lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3)
      )
      .filter((v) => v !== null && v !== 0) as number[];
    if (!vals.length) {
      stats["L" + lv] = null;
      continue;
    }
    let sum = 0;
    for (const v of vals) sum += v;
    const calcMean = sum / vals.length;
    let sq = 0;
    for (const v of vals) sq += Math.pow(v - calcMean, 2);
    const calcSD = Math.sqrt(sq / vals.length);
    const calcCV = calcMean ? (calcSD / calcMean) * 100 : 0;
    const bias = m ? ((calcMean - m) / m) * 100 : 0;
    const unc = calcCV / Math.sqrt(vals.length);
    const te = Math.abs(bias) + 1.65 * calcCV;
    const sigma = tea && calcCV ? (tea - Math.abs(bias)) / calcCV : null;
    stats["L" + lv] = {
      n: vals.length,
      mean: parseFloat(calcMean.toFixed(4)),
      sd: parseFloat(calcSD.toFixed(4)),
      cv: parseFloat(calcCV.toFixed(2)),
      bias: parseFloat(bias.toFixed(2)),
      unc: parseFloat(unc.toFixed(4)),
      te: parseFloat(te.toFixed(2)),
      sigma: sigma ? parseFloat(sigma.toFixed(2)) : null,
      targetMean: m,
      targetSD: s,
      tea: tea,
    };
  }
  return stats;
}

// ============================================================
// fetchInputQCRows — port of code.gs getInputQC data-fetching
//
// Shared helper used by graph.ts / dashboard.ts / reports.ts.
// Returns InputQC rows matching owner/role + filter, shaped like
// the original GAS getInputQC output (qcID, paramID, lotID, parameter,
// noLot, namaAlat, tanggal (YYYY-MM-DD), level1/2/3, inputBy,
// inputDate (ISO), validated, validatedBy, validatedDate (ISO),
// catatanValidasi, owner).
//
// Filter keys (all optional): paramID, lotID, startDate, endDate,
// paramIDs (array), bidang, namaAlat.
// Superadmin sees all rows; other roles see only their own.
// ============================================================
export async function fetchInputQCRows(
  ownerUsername: string,
  role: string,
  filter: any
): Promise<any[]> {
  try {
    const f = filter || {};
    const where: any = {};
    where.ownerUsername = ownerUsername;
    if (f.paramID) where.paramID = String(f.paramID);
    if (f.lotID) where.lotID = String(f.lotID);
    if (f.paramIDs && Array.isArray(f.paramIDs) && f.paramIDs.length > 0) {
      where.paramID = { in: f.paramIDs.map(String) };
    }
    if (f.namaAlat) {
      where.namaAlat = { contains: String(f.namaAlat) };
    }
    if (f.bidang) {
      // bidang lives on Parameters, not InputQC — fetch matching param IDs.
      const paramRows = await db.parameters.findMany({
        where: { bidang: String(f.bidang) },
        select: { id: true },
      });
      const ids = paramRows.map((p) => p.id);
      where.paramID = ids.length ? { in: ids } : "__none__";
    }
    if (f.startDate || f.endDate) {
      const dateFilter: any = {};
      if (f.startDate) {
        const sd = parseDateStr(String(f.startDate));
        if (sd) dateFilter.gte = dateToISO(sd);
      }
      if (f.endDate) {
        const ed = parseDateStr(String(f.endDate));
        if (ed) dateFilter.lte = dateToISO(ed);
      }
      where.tanggal = dateFilter;
    }
    const rows = await db.inputQC.findMany({
      where,
      orderBy: { tanggal: "asc" },
    });
    return rows.map((r: any) => ({
      qcID: r.id,
      paramID: r.paramID,
      lotID: r.lotID,
      parameter: r.parameter,
      noLot: r.noLot,
      namaAlat: r.namaAlat,
      tanggal: r.tanggal,
      level1: r.level1,
      level2: r.level2,
      level3: r.level3,
      inputBy: r.inputBy,
      inputDate: r.inputDate ? r.inputDate.toISOString() : null,
      validated: r.validated,
      validatedBy: r.validatedBy,
      validatedDate: r.validatedDate ? r.validatedDate.toISOString() : null,
      catatanValidasi: r.catatanValidasi,
      owner: r.ownerUsername,
    }));
  } catch (e) {
    return [];
  }
}

// ============================================================
// getQCZScoreStats — v9.22 (Fitur #2)
// Statistik Z-Score QC untuk satu parameter dalam rentang tanggal.
//
// args[0]=paramID, args[1]=startDate, args[2]=endDate,
// args[3]=ownerUsername
//
// Z = (nilai QC − meanLot) / SDLot (per level, pakai target LotQC).
// Return per level: {n, meanZ, sdZ, minZ, maxZ, maxAbsZ, nWarn, nReject}
// Interpretasi standar internasional dilakukan di frontend.
// ============================================================
export async function getQCZScoreStats(args: any[], session: SessionData | null) {
  try {
    const paramID = args[0];
    const startDate = args[1];
    const endDate = args[2];
    const ownerUsername = deriveOwner(args, session, 3);
    if (!paramID) return { ok: false, msg: "Parameter wajib dipilih" };
    const s = parseDateStr(startDate ? String(startDate) : null);
    const e = parseDateStr(endDate ? String(endDate) : null);
    if (!s || !e) return { ok: false, msg: "Rentang tanggal tidak valid" };

    const qcRows = await db.inputQC.findMany({
      where: {
        paramID: String(paramID),
        ownerUsername,
        tanggal: { gte: dateToISO(s), lte: dateToISO(e) },
      },
      select: { lotID: true, tanggal: true, level1: true, level2: true, level3: true },
    });
    const lotRows = await db.lotQC.findMany({
      where: { paramID: String(paramID), ownerUsername },
    });
    const lotMap: Record<string, any> = {};
    for (const l of lotRows) lotMap[l.id] = l;

    const stats: Record<string, QCZStats> = {};
    for (const lv of [1, 2, 3]) {
      stats["L" + lv] = computeZStats(collectZPerLevel(qcRows, lotMap, lv));
    }

    return {
      ok: true,
      paramID: String(paramID),
      startDate: dateToISO(s),
      endDate: dateToISO(e),
      stats,
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || "Gagal menghitung Z-Score QC" };
  }
}
