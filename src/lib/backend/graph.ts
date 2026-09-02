// ============================================================
// graph.ts — LJ chart / Westgard graph data (port dari code.gs)
//
// Port 1:1 dari fungsi-fungsi graph di code.gs:
//   - getGraphData(payload, ownerUsername, role)
//   - getMeanSDForLevel(lot, lv, sumber, qcData, ownerUsername)
//   - getSmallestSigmaBySrc(paramID, lotID, sigmaSource, ownerUsername, lot,
//                            qcData, filterOpts)
//   - getSigmaBasedGraphData(payload, ownerUsername, role)
// ============================================================

import { db } from "@/lib/db";
import type { SessionData } from "@/lib/session";
import {
  parseNumSafe,
  parseDateStr,
  dateToISO,
} from "@/lib/utils-server";
import {
  checkWestgardRules,
  checkWestgardAcrossLevels,
  getActiveRulesBySigma,
  filterViolationsBySigma,
  categorizeWestgardError,
  computeSigmaForLevel,
} from "@/lib/backend/westgard";
import { computeQCStats } from "@/lib/backend/calculations";
import { fetchInputQCRows } from "@/lib/backend/qc-helpers";

// ============================================================
// Helpers — derive owner/role from args+session (mirror master-data.ts)
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

// Fetch a single lot row (Prisma → GAS API shape with lotID/paramID/etc.)
async function fetchLotByID(
  lotID: string,
  ownerUsername?: string
): Promise<any | null> {
  if (!lotID) return null;
  const r = await db.lotQC.findFirst({
    where: {
      id: String(lotID),
      ...(ownerUsername ? { ownerUsername } : {}),
    },
  });
  if (!r) return null;
  return {
    lotID: r.id,
    paramID: r.paramID,
    noLot: r.noLot,
    namaAlat: r.namaAlat,
    methode: r.methode,
    satuan: r.satuan,
    expiredDate: r.expiredDate,
    sumber: r.sumber,
    meanL1: r.meanL1,
    sdL1: r.sdL1,
    targetL1: r.targetL1,
    meanL2: r.meanL2,
    sdL2: r.sdL2,
    targetL2: r.targetL2,
    meanL3: r.meanL3,
    sdL3: r.sdL3,
    targetL3: r.targetL3,
    tea: r.tea,
    biasPct: r.biasPct,
    owner: r.ownerUsername,
  };
}

// ============================================================
// getGraphData — port 1:1 dari code.gs (lines 1740-1853)
// args[0]=payload {paramID, lotID, startDate, endDate, sumber, sigmaSource},
// args[1]=ownerUsername, args[2]=role
// ============================================================
export async function getGraphData(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  try {
    const paramID = payload.paramID;
    const lotID = payload.lotID;
    const sumber = payload.sumber || "Manufaktur";

    const qcData = await fetchInputQCRows(ownerUsername, role, {
      paramID: paramID,
      lotID: lotID,
      startDate: payload.startDate,
      endDate: payload.endDate,
    });
    qcData.sort(function (a: any, b: any) {
      const dA = new Date(a.tanggal);
      const dB = new Date(b.tanggal);
      if (dA.getTime() !== dB.getTime()) return dA.getTime() - dB.getTime();
      const idA = new Date(a.inputDate || 0).getTime();
      const idB = new Date(b.inputDate || 0).getTime();
      return idA - idB;
    });

    const lot = await fetchLotByID(String(lotID), ownerUsername);
    const paramRow = paramID
      ? await db.parameters.findFirst({
          where: { id: String(paramID), ownerUsername: ownerUsername },
        })
      : null;
    const param = paramRow
      ? { paramID: paramRow.id, parameter: paramRow.parameter, bidang: paramRow.bidang }
      : null;

    if (!lot) return { ok: false, msg: "Lot tidak ditemukan" };

    const ljDataUnified: any = { L1: [], L2: [], L3: [] };
    qcData.forEach(function (q: any, qIdx: number) {
      ["L1", "L2", "L3"].forEach(function (lv) {
        const lvNum = parseInt(lv.replace("L", ""));
        const val = parseNumSafe(
          lvNum === 1 ? q.level1 : lvNum === 2 ? q.level2 : q.level3
        );
        if (val !== null && val !== 0) {
          ljDataUnified[lv].push({
            idx: qIdx,
            date: q.tanggal,
            value: val,
            qcID: q.qcID,
            catatanValidasi: q.catatanValidasi || "",
          });
        }
      });
    });

    const levelMeta: any = {};
    const meansByLevel: any = {};
    const sdsByLevel: any = {};
    for (const lv of [1, 2, 3]) {
      const msInfo = await getMeanSDForLevel(
        [lot, lv, sumber, qcData, ownerUsername],
        session
      );
      const m = msInfo.mean;
      const s = msInfo.sd;
      const vals = ljDataUnified["L" + lv].map(function (p: any) {
        return p.value;
      });
      meansByLevel["L" + lv] = m;
      sdsByLevel["L" + lv] = s;
      const sigma = computeSigmaForLevel(lot, "L" + lv, qcData);
      const wgMap: any = {};
      vals.forEach(function (v: number, i: number) {
        const subset = vals.slice(0, i + 1);
        const viol = checkWestgardRules(subset, m, s);
        viol.forEach(function (vi: any) {
          const cat = categorizeWestgardError(vi.rule);
          vi.category = cat.category;
          vi.categoryDesc = cat.desc;
        });
        wgMap[i] = viol;
      });
      const ruleInfo = getActiveRulesBySigma(sigma);
      levelMeta["L" + lv] = {
        mean: m,
        sd: s,
        tea: parseNumSafe(lot.tea),
        target: parseNumSafe(lot["targetL" + lv]),
        westgard: wgMap,
        sigma: sigma,
        activeRules: ruleInfo.rules,
        mode: ruleInfo.mode,
        sumberInfo: msInfo.source,
      };
    }

    const wgAcrossRaw = checkWestgardAcrossLevels(
      ljDataUnified,
      meansByLevel,
      sdsByLevel
    );
    let wgAcross: any[] = [];
    wgAcrossRaw.forEach(function (v: any) {
      const cat = categorizeWestgardError(v.rule);
      v.category = cat.category;
      v.categoryDesc = cat.desc;
      wgAcross.push(v);
      // Inject across-level violations into the involved levels' westgard maps
      v.levels.forEach(function (lv: string, idx: number) {
        const ptIdx = v.indices[idx];
        if (levelMeta[lv]) {
          if (!levelMeta[lv].westgard[ptIdx])
            levelMeta[lv].westgard[ptIdx] = [];
          const exists = levelMeta[lv].westgard[ptIdx].some(function (ex: any) {
            return ex.rule === v.rule;
          });
          if (!exists) {
            levelMeta[lv].westgard[ptIdx].push({
              rule: v.rule,
              type: v.type,
              desc: v.desc,
              category: v.category,
              categoryDesc: v.categoryDesc,
            });
          }
        }
      });
    });
    const worstSigma = Math.min.apply(
      null,
      [1, 2, 3].map(function (lv) {
        return levelMeta["L" + lv].sigma === null ? 6 : levelMeta["L" + lv].sigma;
      })
    );
    wgAcross = filterViolationsBySigma(wgAcross, worstSigma);
    wgAcross.forEach(function (v: any) {
      const cat = categorizeWestgardError(v.rule);
      v.category = cat.category;
      v.categoryDesc = cat.desc;
    });

    const stats = computeQCStats(qcData, lot);
    const qgiData: any = {};
    [1, 2, 3].forEach(function (lv) {
      const s = stats["L" + lv];
      if (!s || !s.cv) {
        qgiData["L" + lv] = null;
        return;
      }
      const qgi = s.cv ? s.bias / (1.5 * s.cv) : null;
      qgiData["L" + lv] = {
        qgi: qgi !== null ? parseFloat(qgi.toFixed(3)) : null,
        interp:
          qgi === null
            ? ""
            : qgi > 1.2
            ? "Imprecision dominant — perbaiki presisi"
            : qgi < 0.8
            ? "Inaccuracy dominant — perbaiki akurasi/kalibrasi"
            : "Balanced — perbaiki keduanya",
      };
    });

    return {
      ok: true,
      parameter: param ? param.parameter : "",
      lotID: lotID,
      namaAlat: lot.namaAlat,
      noLot: lot.noLot,
      satuan: lot.satuan,
      methode: lot.methode,
      expiredDate: dateToISO(lot.expiredDate),
      tea: lot.tea,
      sumber: sumber,
      sumberLot: lot.sumber,
      ljDataUnified: ljDataUnified,
      levelMeta: levelMeta,
      stats: stats,
      qgiData: qgiData,
      wgAcross: wgAcross,
      startDate: payload.startDate,
      endDate: payload.endDate,
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ============================================================
// getMeanSDForLevel — port 1:1 dari code.gs (lines 1855-1887)
// args: [lot, lv, sumber, qcData, ownerUsername]
// ============================================================
export async function getMeanSDForLevel(
  args: any[],
  _session: SessionData | null
) {
  const lot = args[0];
  const lv = args[1];
  const sumber = args[2];
  const qcData = args[3] || [];
  const ownerUsername = args[4];

  const lvNum = parseInt(String(lv).replace("L", ""));
  const lotMean = parseNumSafe(lot["meanL" + lvNum]);
  const lotSD = parseNumSafe(lot["sdL" + lvNum]);
  if (!sumber || sumber === "Manufaktur")
    return { mean: lotMean, sd: lotSD, source: "Manufaktur" };

  if (sumber === "Terhitung berjalan") {
    const vals = qcData
      .map(function (q: any) {
        return parseNumSafe(
          lvNum === 1 ? q.level1 : lvNum === 2 ? q.level2 : q.level3
        );
      })
      .filter(function (v): v is number { return v !== null && v !== 0; });
    if (vals.length < 2)
      return { mean: lotMean, sd: lotSD, source: "Manufaktur (data kurang)" };
    const mean = vals.reduce(function (a: number, b: number) {
      return a + b;
    }, 0) / vals.length;
    const sdv = Math.sqrt(
      vals.reduce(function (s: number, v: number) {
        return s + Math.pow(v - mean, 2);
      }, 0) / (vals.length - 1)
    );
    return {
      mean: parseFloat(mean.toFixed(4)),
      sd: parseFloat(sdv.toFixed(4)),
      source: "Terhitung berjalan (N=" + vals.length + ")",
    };
  }

  if (sumber === "Terhitung Fix") {
    const rows = await db.calculatedStats.findMany({
      where: {
        lotID: lot.lotID,
        ownerUsername: String(ownerUsername).toLowerCase(),
      },
      orderBy: { id: "asc" },
    });
    // Search latest matching level (level stored as Int 1/2/3 OR string L1/L2/L3)
    let matched: any = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const lvlStr =
        typeof r.level === "number" ? "L" + r.level : String(r.level);
      const lvlNumStr = String(r.level);
      if (lvlStr === "L" + lvNum || lvlNumStr === String(lvNum)) {
        matched = r;
        break;
      }
    }
    if (matched) {
      const cm = parseNumSafe(matched.calcMean);
      const cs = parseNumSafe(matched.calcSD);
      if (cm && cs)
        return {
          mean: cm,
          sd: cs,
          source: "Terhitung Fix (N=" + matched.n + ")",
        };
    }
    return {
      mean: lotMean,
      sd: lotSD,
      source: "Manufaktur (CalcStats tidak ditemukan)",
    };
  }
  return { mean: lotMean, sd: lotSD, source: "Manufaktur" };
}

// ============================================================
// getSmallestSigmaBySrc — port 1:1 dari code.gs (lines 1889-1989)
// args: [paramID, lotID, sigmaSource, ownerUsername, lot, qcData, filterOpts]
// ============================================================
export async function getSmallestSigmaBySrc(
  args: any[],
  _session: SessionData | null
): Promise<number | null> {
  const paramID = args[0];
  const lotID = args[1];
  const sigmaSource = args[2];
  const ownerUsername = args[3];
  const lot = args[4];
  const qcData = args[5] || [];
  const filterOpts = args[6] || {};

  const tea = parseNumSafe(lot.tea);

  // FIX v9.26: Normalisasi nama sumber sigma — toleran variasi spasi/ketik
  // (mis. "Sigma TerkecilPME" dari klien lama tetap dikenali sebagai "Sigma Terkecil PME")
  const srcKey = String(sigmaSource || "").replace(/\s+/g, " ").trim();

  if (srcKey === "Sigma Terkecil Terhitung") {
    if (!tea) return null;
    const sigmas: number[] = [];
    [1, 2, 3].forEach(function (lv) {
      const m = parseNumSafe(lot["meanL" + lv]);
      const t = parseNumSafe(lot.tea);
      if (!m || !t) return;
      const vals = qcData
        .map(function (q: any) {
          return parseNumSafe(
            lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3
          );
        })
        .filter(function (v): v is number { return v !== null && v !== 0; });
      if (!vals.length) return;
      // PERBAIKAN: Use observed SD/Mean (calcSD/calcMean)
      const calcMean = vals.reduce(function (a, b) {
        return a + b;
      }, 0) / vals.length;
      const calcSD = Math.sqrt(
        vals.reduce(function (s2, v) {
          return s2 + Math.pow(v - calcMean, 2);
        }, 0) / vals.length
      );
      const calcCV = calcMean ? (calcSD / calcMean) * 100 : 0;
      const bias = m ? ((calcMean - m) / m) * 100 : 0;
      if (calcCV) {
        const sigma = (tea - Math.abs(bias)) / calcCV;
        sigmas.push(parseFloat(sigma.toFixed(2)));
      }
    });
    return sigmas.length ? Math.min.apply(null, sigmas) : null;
  }

  // FIX v9.26: "Sigma Terkecil PME" — hitung sigma PERSIS seperti submenu Bias PME
  // (getBiasPME): TEa dari baris PME (fallback TEa lot), CV prioritas cvL{lv} dari
  // baris PME, fallback CV dari SD/Mean lot. Sebelumnya cabang ini bergantung pada
  // TEa + SD + Mean lot sehingga bisa N/A padahal sigma tampil di submenu Bias PME.
  if (srcKey === "Sigma Terkecil PME") {
    const pmeWhere: any = {
      paramID: String(paramID),
      lotID: String(lotID),
      ownerUsername: ownerUsername,
    };
    if (filterOpts.siklusPME) pmeWhere.siklus = filterOpts.siklusPME;
    if (filterOpts.tahunSiklus) pmeWhere.tahun = String(filterOpts.tahunSiklus);
    const pmeRows = await db.biasPME.findMany({ where: pmeWhere });
    const sigmas2: number[] = [];
    for (const pmeRow of pmeRows) {
      // TEa baris PME dulu (sama seperti getBiasPME yang memakai item.tea),
      // fallback ke TEa lot bila baris PME tidak menyimpan TEa
      const tRow = parseNumSafe(pmeRow.tea) || tea;
      if (!tRow) continue;
      for (const lv of [1, 2, 3]) {
        const m = parseNumSafe(lot["meanL" + lv]);
        const s = parseNumSafe(lot["sdL" + lv]);
        const hasil = parseNumSafe(
          lv === 1 ? pmeRow.hasilL1 : lv === 2 ? pmeRow.hasilL2 : pmeRow.hasilL3
        );
        const meanP = parseNumSafe(
          lv === 1
            ? pmeRow.meanPesertaL1
            : lv === 2
            ? pmeRow.meanPesertaL2
            : pmeRow.meanPesertaL3
        );
        if (!hasil || !meanP) continue;
        // Rumus bias identik getBiasPME: |(hasil − meanPeserta)/meanPeserta| × 100
        const bias = Math.abs(((hasil - meanP) / meanP) * 100);
        // CV identik getBiasPME: cvL{lv} dari PME dulu, fallback (SD/Mean lot) × 100
        const cvPME = parseNumSafe(
          lv === 1 ? pmeRow.cvL1 : lv === 2 ? pmeRow.cvL2 : pmeRow.cvL3
        );
        const cv = cvPME || (m && s ? (s / m) * 100 : null);
        if (cv) sigmas2.push(parseFloat(((tRow - bias) / cv).toFixed(2)));
      }
    }
    return sigmas2.length ? Math.min.apply(null, sigmas2) : null;
  }

  if (srcKey === "Sigma Terkecil PME CV") {
    let csRows = await db.calculatedStats.findMany({
      where: {
        paramID: String(paramID),
        lotID: String(lotID),
        ownerUsername: ownerUsername,
      },
    });
    if (filterOpts.periodeCS && filterOpts.periodeCS.start && filterOpts.periodeCS.end) {
      const pStart = parseDateStr(filterOpts.periodeCS.start);
      const pEnd = parseDateStr(filterOpts.periodeCS.end);
      csRows = csRows.filter(function (cs: any) {
        const csStart = parseDateStr(cs.startDate);
        const csEnd = parseDateStr(cs.endDate);
        return (
          csStart &&
          csEnd &&
          pStart &&
          pEnd &&
          csStart.getTime() === pStart.getTime() &&
          csEnd.getTime() === pEnd.getTime()
        );
      });
    }
    // Compute sigma for each CalcStats row (mirrors getCalcStats logic)
    const sigmas3: number[] = [];
    for (const cs of csRows) {
      const lotRow = lot;
      const lvNum = parseInt(String(cs.level).replace("L", ""));
      const lotMean = parseNumSafe(lotRow["meanL" + lvNum]);
      const teaVal = parseNumSafe(lotRow.tea);
      const calcMean = parseNumSafe(cs.calcMean);
      const calcCV = parseNumSafe(cs.calcCV);
      if (lotMean && calcMean && calcCV && teaVal) {
        const bias = ((calcMean - lotMean) / lotMean) * 100;
        const sigma = (teaVal - Math.abs(bias)) / calcCV;
        if (!isNaN(sigma)) sigmas3.push(parseFloat(sigma.toFixed(2)));
      }
    }
    return sigmas3.length ? Math.min.apply(null, sigmas3) : null;
  }

  if (srcKey === "Sigma Terkecil CV Optional") {
    let cvRows = await db.sigmaCVOpt.findMany({
      where: {
        paramID: String(paramID),
        lotID: String(lotID),
        ownerUsername: ownerUsername,
      },
    });
    if (
      filterOpts.periodeCVOpt &&
      filterOpts.periodeCVOpt.start &&
      filterOpts.periodeCVOpt.end
    ) {
      const pStart2 = parseDateStr(filterOpts.periodeCVOpt.start);
      const pEnd2 = parseDateStr(filterOpts.periodeCVOpt.end);
      cvRows = cvRows.filter(function (cv: any) {
        const cvStart = parseDateStr(cv.startDate);
        const cvEnd = parseDateStr(cv.endDate);
        if (!cvStart || !cvEnd || !pStart2 || !pEnd2) return false;
        return (
          cvStart.getTime() === pStart2.getTime() &&
          cvEnd.getTime() === pEnd2.getTime()
        );
      });
    }
    const sigmas4: number[] = [];
    for (const r of cvRows) {
      // Compute per-level sigma using biasPME1/2/3 and observed CV
      const teaVal = parseNumSafe(r.tea);
      const lotRow = lot;
      const startDate = r.startDate;
      const endDate = r.endDate;
      for (const lv of [1, 2, 3]) {
        const biasPMELv = parseNumSafe(r["biasPME" + lv]);
        const lotMean = parseNumSafe(lotRow["meanL" + lv]);
        // Compute calcStats from InputQC for this lot/level/period
        let calcCV: number | null = null;
        if (startDate && endDate && lotRow.lotID) {
          const qcs = await fetchInputQCRows(ownerUsername, "user", {
            lotID: lotRow.lotID,
            startDate: startDate,
            endDate: endDate,
          });
          const vals = qcs
            .map(function (q: any) {
              return parseNumSafe(
                lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3
              );
            })
            .filter(function (v): v is number { return v !== null && v !== 0; });
          if (vals.length) {
            const calcMean = vals.reduce(function (a, b) {
              return a + b;
            }, 0) / vals.length;
            const calcSD = Math.sqrt(
              vals.reduce(function (s2, v) {
                return s2 + Math.pow(v - calcMean, 2);
              }, 0) / vals.length
            );
            calcCV = calcMean ? (calcSD / calcMean) * 100 : 0;
          }
        }
        let bias: number | null =
          biasPMELv !== null && biasPMELv !== undefined ? Math.abs(biasPMELv) : null;
        if (bias === null && lotMean) {
          // Fallback requires calcMean — skip if no QC available
          bias = null;
        }
        if (teaVal && bias !== null && calcCV) {
          const sigma = (teaVal - bias) / calcCV;
          if (!isNaN(sigma)) sigmas4.push(parseFloat(sigma.toFixed(2)));
        }
      }
      // FALLBACK: avgSigma / avgSigmaL12 from DB
      if (sigmas4.length === 0) {
        const s = parseNumSafe(r.avgSigma);
        if (s !== null && !isNaN(s)) sigmas4.push(s);
        const s12 = parseNumSafe(r.avgSigmaL12);
        if (s12 !== null && !isNaN(s12)) sigmas4.push(s12);
      }
    }
    return sigmas4.length ? Math.min.apply(null, sigmas4) : null;
  }
  return null;
}

// ============================================================
// getSigmaBasedGraphData — port 1:1 dari code.gs (lines 1990-2038)
// args[0]=payload, args[1]=ownerUsername, args[2]=role
// ============================================================
export async function getSigmaBasedGraphData(
  args: any[],
  session: SessionData | null
) {
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  try {
    const graphRes: any = await getGraphData(
      [payload, ownerUsername, role],
      session
    );
    if (!graphRes.ok) return graphRes;

    const sigmaSource = payload.sigmaSource || "Sigma Terkecil Terhitung";
    const lot = await fetchLotByID(String(payload.lotID), ownerUsername);
    const qcData = await fetchInputQCRows(ownerUsername, role, {
      paramID: payload.paramID,
      lotID: payload.lotID,
      startDate: payload.startDate,
      endDate: payload.endDate,
    });
    const filterOpts = {
      siklusPME: payload.siklusPME || null,
      tahunSiklus: payload.tahunSiklus || null,
      periodeCS: payload.periodeCS || null,
      periodeCVOpt: payload.periodeCVOpt || null,
    };
    const smallestSigma = lot
      ? await getSmallestSigmaBySrc(
          [
            payload.paramID,
            payload.lotID,
            sigmaSource,
            ownerUsername,
            lot,
            qcData,
            filterOpts,
          ],
          session
        )
      : null;
    const ruleInfo = getActiveRulesBySigma(smallestSigma);

    ["L1", "L2", "L3"].forEach(function (lv) {
      const meta = graphRes.levelMeta[lv];
      if (!meta) return;
      const newWgMap: any = {};
      Object.keys(meta.westgard).forEach(function (i) {
        const viol = meta.westgard[i] || [];
        newWgMap[i] = filterViolationsBySigma(viol, smallestSigma);
        newWgMap[i].forEach(function (vi: any) {
          const cat = categorizeWestgardError(vi.rule);
          vi.category = cat.category;
          vi.categoryDesc = cat.desc;
        });
      });
      meta.westgard = newWgMap;
      meta.activeRules = ruleInfo.rules;
      meta.mode = ruleInfo.mode;
      // PERBAIKAN: Update sigma di levelMeta dengan smallestSigma
      if (smallestSigma !== null && smallestSigma !== undefined) {
        meta.sigma = smallestSigma;
      }
    });

    graphRes.sigmaBasedActive = true;
    graphRes.smallestSigma = smallestSigma;
    graphRes.sigmaSource = sigmaSource;
    graphRes.activeRulesMode = ruleInfo.mode;
    graphRes.warning = ruleInfo.warning;
    graphRes.activeRules = ruleInfo.rules;
    return graphRes;
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}
