// ============================================================
// reports.ts — Laporan / Trend / Instrument / Tabulasi / OPSpecs
//              (port dari code.gs)
//
// Port 1:1 dari fungsi-fungsi:
//   - getLaporanData(payload, ownerUsername, role)
//   - buildLevelInterpretation(s, lot, qcs, lv)
//   - getReportData(ownerUsername, role, filter)
//   - estimateErrorPer100(sigma)
//   - getTrendAnalisisData(payload, ownerUsername, role)
//   - computeSigmaPME(pme, lv, lot)
//   - getInstrumentCompare(ownerUsername, role, filter)
//   - getTabulasiData(ownerUsername, role, filter)
//   - getOPSpecsData(ownerUsername, role, filter)
//   - computePed(sigma)
//   - computePfr(sigma)
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
  filterViolationsBySigma,
  categorizeWestgardError,
} from "@/lib/backend/westgard";
import { computeQCStats } from "@/lib/backend/calculations";
import { fetchInputQCRows } from "@/lib/backend/qc-helpers";
import { getGraphData } from "@/lib/backend/graph";
import { getCatatanLaporan, getCatatanTabulasi } from "@/lib/backend/misc";
import { getKopSurat } from "@/lib/backend/master-data";

// ============================================================
// Helpers — derive owner/role from args+session
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

// ============================================================
// estimateErrorPer100 — port 1:1 dari code.gs (lines 2552-2563)
// ============================================================
export function estimateErrorPer100(sigma: number | null | undefined): number {
  if (sigma === null || sigma === undefined || isNaN(sigma)) return 69;
  if (sigma >= 6) return 0;
  if (sigma >= 5.5) return 0;
  if (sigma >= 5) return 1;
  if (sigma >= 4.5) return 1;
  if (sigma >= 4) return 1;
  if (sigma >= 3.5) return 3;
  if (sigma >= 3) return 7;
  if (sigma >= 2.5) return 16;
  if (sigma >= 2) return 31;
  return 69;
}

// ============================================================
// computePed — port 1:1 dari code.gs (line 3098)
// ============================================================
export function computePed(sigma: number | null | undefined): number {
  if (sigma === null || sigma === undefined || isNaN(sigma)) return 10.0;
  if (sigma >= 6) return 99.9;
  if (sigma >= 5) return 99.0;
  if (sigma >= 4) return 90.0;
  if (sigma >= 3) return 70.0;
  if (sigma >= 2) return 40.0;
  return 10.0;
}

// ============================================================
// computePfr — port 1:1 dari code.gs (line 3100)
// ============================================================
export function computePfr(sigma: number | null | undefined): number {
  if (sigma === null || sigma === undefined || isNaN(sigma)) return 10.0;
  if (sigma >= 6) return 0.1;
  if (sigma >= 5) return 0.5;
  if (sigma >= 4) return 1.0;
  if (sigma >= 3) return 2.0;
  if (sigma >= 2) return 5.0;
  return 10.0;
}

// ============================================================
// buildLevelInterpretation — port 1:1 dari code.gs (lines 2142-2171)
// Pure helper — heuristic text + status based on CV/Bias/Sigma/TE vs TEa.
// ============================================================
export function buildLevelInterpretation(
  s: any,
  lot: any,
  qcs: any[],
  lv: number
): any {
  if (!s) return null;
  const notes: string[] = [];
  let status = "baik";
  let statusColor = "success";
  if (s.cv > 10) {
    notes.push("CV sangat tinggi (" + s.cv + "%) — periksa presisi alat");
    status = "buruk";
    statusColor = "danger";
  } else if (s.cv > 5) {
    notes.push("CV tinggi (" + s.cv + "%) — pertimbangkan optimasi");
    if (status === "baik") {
      status = "cukup";
      statusColor = "warning";
    }
  } else {
    notes.push("CV baik (" + s.cv + "%)");
  }
  if (Math.abs(s.bias) > 5) {
    notes.push("Bias signifikan (" + s.bias + "%) — periksa kalibrasi");
    status = "buruk";
    statusColor = "danger";
  } else if (Math.abs(s.bias) > 2) {
    notes.push("Bias moderate (" + s.bias + "%)");
    if (status === "baik") {
      status = "cukup";
      statusColor = "warning";
    }
  } else {
    notes.push("Bias rendah (" + s.bias + "%)");
  }
  if (s.sigma !== null) {
    if (s.sigma >= 6) notes.push("Kinerja World Class (σ=" + s.sigma + ")");
    else if (s.sigma >= 5) notes.push("Kinerja Excellent (σ=" + s.sigma + ")");
    else if (s.sigma >= 4) notes.push("Kinerja Good (σ=" + s.sigma + ")");
    else if (s.sigma >= 3) {
      notes.push("Kinerja Marginal (σ=" + s.sigma + ") — perlu pemantauan");
      if (status === "baik") {
        status = "cukup";
        statusColor = "warning";
      }
    } else {
      notes.push("Kinerja Poor (σ=" + s.sigma + ") — perbaikan diperlukan!");
      status = "buruk";
      statusColor = "danger";
    }
  }
  if (s.tea && s.te > s.tea) {
    notes.push("Total Error (" + s.te + "%) melampaui TEa (" + s.tea + "%)!");
    status = "buruk";
    statusColor = "danger";
  }
  return { status, statusColor, notes };
}

// ============================================================
// computeSigmaPME — port 1:1 dari code.gs (lines 2570-2581)
// Pure helper: sigma for PME row using lot SD/mean for CV.
// ============================================================
export function computeSigmaPME(pme: any, lv: number, lot: any): number | null {
  const hasilIdx = lv === 1 ? "hasilL1" : lv === 2 ? "hasilL2" : "hasilL3";
  const meanIdx =
    lv === 1 ? "meanPesertaL1" : lv === 2 ? "meanPesertaL2" : "meanPesertaL3";
  const m = parseNumSafe(lot["meanL" + lv]);
  const s = parseNumSafe(lot["sdL" + lv]);
  const tea = parseNumSafe(lot.tea);
  const hasil = parseNumSafe(pme[hasilIdx]);
  const meanP = parseNumSafe(pme[meanIdx]);
  if (!m || !s || !tea || !hasil || !meanP) return null;
  const bias = Math.abs(((hasil - meanP) / meanP) * 100);
  const cv = (s / m) * 100;
  return cv ? parseFloat(((tea - bias) / cv).toFixed(2)) : null;
}

// ============================================================
// getLaporanData — port 1:1 dari code.gs (lines 2068-2141)
// args[0]=payload {paramID, lotID, startDate, endDate, bidang, namaAlat},
// args[1]=ownerUsername, args[2]=role
// ============================================================
export async function getLaporanData(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  try {
    const filter: any = {
      startDate: payload.startDate || null,
      endDate: payload.endDate || null,
      paramID: payload.paramID || null,
      lotID: payload.lotID || null,
      namaAlat: payload.namaAlat || null,
      bidang: payload.bidang || null,
    };

    const where: any = { ownerUsername };
    const [paramRows, lotRows] = await Promise.all([
      db.parameters.findMany({ where, orderBy: { parameter: "asc" } }),
      db.lotQC.findMany({ where, orderBy: { noLot: "asc" } }),
    ]);
    let params: any[] = paramRows.map((r) => ({
      paramID: r.id,
      parameter: r.parameter,
      bidang: r.bidang,
    }));
    let lots: any[] = lotRows.map((r) => ({
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
    }));

    if (filter.bidang)
      params = params.filter(function (p) {
        return (p.bidang || "Lainnya") === filter.bidang;
      });
    if (filter.paramID)
      params = params.filter(function (p) {
        return p.paramID === filter.paramID;
      });
    const paramIDs = params.map(function (p) {
      return p.paramID;
    });
    lots = lots.filter(function (l) {
      return paramIDs.indexOf(l.paramID) > -1;
    });
    if (filter.lotID)
      lots = lots.filter(function (l) {
        return l.lotID === filter.lotID;
      });
    if (filter.namaAlat)
      lots = lots.filter(function (l) {
        return (
          String(l.namaAlat)
            .toLowerCase()
            .indexOf(String(filter.namaAlat).toLowerCase()) > -1
        );
      });

    const result: any[] = [];
    const paramMap: Record<string, any> = {};
    params.forEach(function (p) {
      paramMap[p.paramID] = p;
    });

    for (const lot of lots) {
      const qcFilter: any = { lotID: lot.lotID };
      if (filter.startDate) qcFilter.startDate = filter.startDate;
      if (filter.endDate) qcFilter.endDate = filter.endDate;
      const qcs = await fetchInputQCRows(ownerUsername, role, qcFilter);
      if (!qcs.length) continue;
      qcs.sort(function (a, b) {
        return new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime();
      });
      const stats = computeQCStats(qcs, lot);
      const interpretasi: any = {};
      [1, 2, 3].forEach(function (lv) {
        const s = stats["L" + lv];
        if (!s) {
          interpretasi["L" + lv] = null;
          return;
        }
        interpretasi["L" + lv] = buildLevelInterpretation(s, lot, qcs, lv);
      });
      const wgFlagsByQCID: Record<string, any> = {};
      [1, 2, 3].forEach(function (lv) {
        const m = parseNumSafe(lot["meanL" + lv]);
        const sd = parseNumSafe(lot["sdL" + lv]);
        if (!m || !sd) return;
        const vals = qcs.map(function (q) {
          return parseNumSafe(
            lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3
          );
        });
        const sigma = stats["L" + lv] ? stats["L" + lv].sigma : null;
        qcs.forEach(function (q: any, idx: number) {
          if (vals[idx] === null || vals[idx] === 0) return;
          const subset = vals
            .slice(0, idx + 1)
            .filter(function (x): x is number {
              return x !== null && x !== 0;
            });
          let viol = checkWestgardRules(subset, m, sd);
          viol = filterViolationsBySigma(viol, sigma);
          const rejs = viol.filter(function (v) {
            return !v.ignored && v.type === "rejection";
          });
          if (rejs.length) {
            if (!wgFlagsByQCID[q.qcID]) wgFlagsByQCID[q.qcID] = {};
            wgFlagsByQCID[q.qcID]["L" + lv] = rejs.map(function (v) {
              const cat = categorizeWestgardError(v.rule);
              return { rule: v.rule, category: cat.category };
            });
          }
        });
      });
      result.push({
        paramID: lot.paramID,
        parameter: paramMap[lot.paramID] ? paramMap[lot.paramID].parameter : "",
        bidang: paramMap[lot.paramID]
          ? paramMap[lot.paramID].bidang || "Lainnya"
          : "Lainnya",
        lotID: lot.lotID,
        noLot: lot.noLot,
        namaAlat: lot.namaAlat,
        satuan: lot.satuan,
        methode: lot.methode,
        tea: lot.tea,
        nQC: qcs.length,
        stats: stats,
        qcData: qcs,
        interpretasi: interpretasi,
        wgFlags: wgFlagsByQCID,
        meanL1: lot.meanL1,
        sdL1: lot.sdL1,
        meanL2: lot.meanL2,
        sdL2: lot.sdL2,
        meanL3: lot.meanL3,
        sdL3: lot.sdL3,
      });
    }

    const kop = await getKopSurat([ownerUsername], session);
    return { ok: true, data: result, kop: kop, filter: filter };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ============================================================
// getReportData — port 1:1 dari code.gs (lines 3562-3574)
// args[0]=ownerUsername, args[1]=role, args[2]=filter
// ============================================================
export async function getReportData(args: any[], session: SessionData | null) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  const filter = args[2] || {};
  try {
    const graphData = await getGraphData(
      [
        {
          paramID: filter.paramID,
          lotID: filter.lotID,
          startDate: filter.startDate,
          endDate: filter.endDate,
          sumber: filter.sumber || "Manufaktur",
        },
        ownerUsername,
        role,
      ],
      session
    );
    const catatan = await getCatatanLaporan(
      [ownerUsername, filter.filterKey || ""],
      session
    );
    const kop = await getKopSurat([ownerUsername], session);
    return { ok: true, graphData: graphData, catatan: catatan, kop: kop };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ============================================================
// getTrendAnalisisData — port 1:1 dari code.gs (lines 2173-2551)
// args[0]=payload {tahun, bulanAwal, bulanAkhir, bidang, paramID, lotID,
//                  siklusPME, tahunSiklus, namaAlat, months},
// args[1]=ownerUsername, args[2]=role
// ============================================================
export async function getTrendAnalisisData(
  args: any[],
  session: SessionData | null
) {
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  try {
    const paramID = payload.paramID || null;
    const lotID = payload.lotID || null;
    const bidang = payload.bidang || null;
    const namaAlat = payload.namaAlat || null;
    const tahun = payload.tahun || String(new Date().getFullYear());
    const bulanAwal = parseInt(payload.bulanAwal) || 1;
    const bulanAkhir = parseInt(payload.bulanAkhir) || 12;
    const siklusPME = payload.siklusPME || null;
    const tahunSiklus = payload.tahunSiklus || null;

    // Generate months dari tahun + bulanAwal/bulanAkhir
    const months: any[] = [];
    const y = parseInt(tahun);
    for (let m = bulanAwal; m <= bulanAkhir; m++) {
      const monthEnd = new Date(y, m, 0);
      months.push({
        year: y,
        month: m,
        label: m + "/" + y,
        startISO: y + "-" + String(m).padStart(2, "0") + "-01",
        endISO:
          y +
          "-" +
          String(m).padStart(2, "0") +
          "-" +
          String(monthEnd.getDate()).padStart(2, "0"),
      });
    }

    const where: any = { ownerUsername };
    const [lotRows, paramRows] = await Promise.all([
      db.lotQC.findMany({ where, orderBy: { noLot: "asc" } }),
      db.parameters.findMany({ where, orderBy: { parameter: "asc" } }),
    ]);
    const lots = lotRows.map((r) => ({
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
    }));
    const params = paramRows.map((r) => ({
      paramID: r.id,
      parameter: r.parameter,
      bidang: r.bidang,
    }));
    const paramMap: Record<string, any> = {};
    params.forEach(function (p) {
      paramMap[p.paramID] = p;
    });
    const paramBidang: Record<string, string> = {};
    params.forEach(function (p) {
      paramBidang[p.paramID] = p.bidang || "Lainnya";
    });

    const filteredLots = lots.filter(function (l) {
      if (paramID && l.paramID !== paramID) return false;
      if (lotID && l.lotID !== lotID) return false;
      if (bidang && (paramBidang[l.paramID] || "Lainnya") !== bidang) return false;
      if (
        namaAlat &&
        String(l.namaAlat)
          .toLowerCase()
          .indexOf(String(namaAlat).toLowerCase()) < 0
      )
        return false;
      return true;
    });
    if (!filteredLots.length)
      return {
        ok: true,
        data: {
          months: months,
          sigmaTrend: {},
          teTrend: {},
          interpretasi: {},
        },
      };

    // Fetch all PME rows for filtered lots + (siklusPME, tahunSiklus) filter
    const pmeWhere: any = {};
    pmeWhere.ownerUsername = ownerUsername;
    if (paramID) pmeWhere.paramID = String(paramID);
    if (lotID) pmeWhere.lotID = String(lotID);
    if (siklusPME) pmeWhere.siklus = String(siklusPME);
    if (tahunSiklus) pmeWhere.tahun = String(tahunSiklus);
    const allPMERows = await db.biasPME.findMany({ where: pmeWhere });

    const sigmaTrend: any = {
      terhitung: { L1: [], L2: [], L3: [] },
      pme: { L1: [], L2: [], L3: [] },
      pmecv: { L1: [], L2: [], L3: [] },
      cvopt: { L1: [], L2: [], L3: [] },
    };
    const teTrend: any = { L1: [], L2: [], L3: [], tea: [] };

    const allQCData = await fetchInputQCRows(ownerUsername, role, {
      startDate: months[0].startISO,
      endDate: months[months.length - 1].endISO,
    });

    for (const m of months) {
      [1, 2, 3].forEach(function (lv) {
        const sigList: number[] = [];
        const teList: number[] = [];
        const teaList: number[] = [];
        for (const lot of filteredLots) {
          const mStart = parseDateStr(m.startISO);
          const mEnd = parseDateStr(m.endISO);
          const qcs = allQCData.filter(function (q) {
            if (q.lotID !== lot.lotID) return false;
            const d = parseDateStr(q.tanggal);
            return d && mStart && mEnd && d >= mStart && d <= mEnd;
          });
          if (!qcs.length) continue;
          const mn = parseNumSafe(lot["meanL" + lv]);
          const tea = parseNumSafe(lot.tea);
          const vals = qcs
            .map(function (q) {
              return parseNumSafe(
                lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3
              );
            })
            .filter(function (v): v is number { return v !== null && v !== 0; });
          if (!vals.length || !mn || !tea) continue;
          // PERBAIKAN #2 & #3: Use observed SD/Mean
          const calcMean = vals.reduce(function (a, b) {
            return a + b;
          }, 0) / vals.length;
          const calcSD = Math.sqrt(
            vals.reduce(function (s2, v) {
              return s2 + Math.pow(v - calcMean, 2);
            }, 0) / vals.length
          );
          const calcCV = calcMean ? (calcSD / calcMean) * 100 : 0;
          const bias = mn ? ((calcMean - mn) / mn) * 100 : 0;
          const te = Math.abs(bias) + 1.65 * calcCV;
          const sigma = calcCV ? (tea - Math.abs(bias)) / calcCV : null;
          if (sigma !== null) sigList.push(sigma);
          teList.push(te);
          teaList.push(tea);
        }
        sigmaTrend.terhitung["L" + lv].push(
          sigList.length
            ? parseFloat(
                (
                  sigList.reduce(function (a, b) {
                    return a + b;
                  }, 0) / sigList.length
                ).toFixed(2)
              )
            : null
        );
        teTrend["L" + lv].push(
          teList.length
            ? parseFloat(
                (
                  teList.reduce(function (a, b) {
                    return a + b;
                  }, 0) / teList.length
                ).toFixed(2)
              )
            : null
        );
        if (lv === 1)
          teTrend.tea.push(
            teaList.length
              ? parseFloat(
                  (
                    teaList.reduce(function (a, b) {
                      return a + b;
                    }, 0) / teaList.length
                  ).toFixed(2)
                )
              : null
          );
      });

      // Sigma PME from BiasPME table (latest matching row per lot)
      [1, 2, 3].forEach(function (lv) {
        const sigList: number[] = [];
        for (const lot of filteredLots) {
          const lotPME = allPMERows.filter(function (p: any) {
            return p.lotID === lot.lotID;
          });
          if (!lotPME.length) continue;
          const latest = lotPME[lotPME.length - 1];
          const hasilIdx = lv === 1 ? "hasilL1" : lv === 2 ? "hasilL2" : "hasilL3";
          const meanPIdx =
            lv === 1
              ? "meanPesertaL1"
              : lv === 2
              ? "meanPesertaL2"
              : "meanPesertaL3";
          const cvIdx = lv === 1 ? "cvL1" : lv === 2 ? "cvL2" : "cvL3";
          const hasil = parseNumSafe((latest as any)[hasilIdx]);
          const meanP = parseNumSafe((latest as any)[meanPIdx]);
          const cvPME = parseNumSafe((latest as any)[cvIdx]);
          const tea = parseNumSafe((latest as any).tea) || parseNumSafe(lot.tea);
          if (hasil && meanP && cvPME && tea) {
            const bias = Math.abs(((hasil - meanP) / meanP) * 100);
            sigList.push(parseFloat(((tea - bias) / cvPME).toFixed(2)));
          }
        }
        sigmaTrend.pme["L" + lv].push(
          sigList.length
            ? parseFloat(
                (
                  sigList.reduce(function (a, b) {
                    return a + b;
                  }, 0) / sigList.length
                ).toFixed(2)
              )
            : null
        );
      });

      // Sigma PME CV — same as 'pme' branch (mirror GAS behavior)
      [1, 2, 3].forEach(function (lv) {
        const sigList: number[] = [];
        for (const lot of filteredLots) {
          const lotPME = allPMERows.filter(function (p: any) {
            return p.lotID === lot.lotID;
          });
          if (!lotPME.length) continue;
          const latest = lotPME[lotPME.length - 1];
          const hasilIdx = lv === 1 ? "hasilL1" : lv === 2 ? "hasilL2" : "hasilL3";
          const meanPIdx =
            lv === 1
              ? "meanPesertaL1"
              : lv === 2
              ? "meanPesertaL2"
              : "meanPesertaL3";
          const cvIdx = lv === 1 ? "cvL1" : lv === 2 ? "cvL2" : "cvL3";
          const hasil = parseNumSafe((latest as any)[hasilIdx]);
          const meanP = parseNumSafe((latest as any)[meanPIdx]);
          const cvPME = parseNumSafe((latest as any)[cvIdx]);
          const tea = parseNumSafe((latest as any).tea) || parseNumSafe(lot.tea);
          if (hasil && meanP && cvPME && tea) {
            const bias = Math.abs(((hasil - meanP) / meanP) * 100);
            sigList.push(parseFloat(((tea - bias) / cvPME).toFixed(2)));
          }
        }
        sigmaTrend.pmecv["L" + lv].push(
          sigList.length
            ? parseFloat(
                (
                  sigList.reduce(function (a, b) {
                    return a + b;
                  }, 0) / sigList.length
                ).toFixed(2)
              )
            : null
        );
      });

      // Sigma CV Optional — SigmaCVOpt table (filtered by start <= m.endISO)
      const cvOptWhere: any = { ownerUsername };
      const allCVOptRows = await db.sigmaCVOpt.findMany({
        where: cvOptWhere,
      });
      [1, 2, 3].forEach(function (lv) {
        const sigList: number[] = [];
        for (const lot of filteredLots) {
          const lotOpt = allCVOptRows.filter(function (r: any) {
            return r.lotID === lot.lotID;
          });
          if (!lotOpt.length) continue;
          const validOpt = lotOpt.filter(function (r: any) {
            const sd = parseDateStr(r.startDate);
            if (!sd) return false;
            const mEnd = parseDateStr(m.endISO);
            return mEnd && sd <= mEnd;
          });
          const finalOpt = validOpt.length ? validOpt : lotOpt;
          const latest = finalOpt[finalOpt.length - 1];
          const avgSigma = parseNumSafe((latest as any).avgSigma);
          if (avgSigma !== null) sigList.push(avgSigma);
        }
        sigmaTrend.cvopt["L" + lv].push(
          sigList.length
            ? parseFloat(
                (
                  sigList.reduce(function (a, b) {
                    return a + b;
                  }, 0) / sigList.length
                ).toFixed(2)
              )
            : null
        );
      });
    }

    const interpretasi: any = {};
    ["terhitung", "pme", "pmecv", "cvopt"].forEach(function (src) {
      const labelMap: any = {
        terhitung: "Sigma Terhitung (data QC harian observasi)",
        pme: "Sigma PME (data uji profisiensi)",
        pmecv: "Sigma PME CV (bias PME + CV PME)",
        cvopt: "Sigma CV Optional (data eksternal)",
      };
      const notes: string[] = [];
      const avgPerLv: Record<string, number> = {};
      [1, 2, 3].forEach(function (lv) {
        const arr = sigmaTrend[src]["L" + lv].filter(function (v: any) {
          return v !== null;
        });
        if (arr.length)
          avgPerLv["L" + lv] =
            arr.reduce(function (a: number, b: number) {
              return a + b;
            }, 0) / arr.length;
      });
      const avgAll: number[] = [];
      Object.keys(avgPerLv).forEach(function (k) {
        avgAll.push(avgPerLv[k]);
      });
      const grand = avgAll.length
        ? avgAll.reduce(function (a, b) {
            return a + b;
          }, 0) / avgAll.length
        : null;
      notes.push("Sumber: " + labelMap[src]);
      if (grand !== null) {
        notes.push("Rata-rata sigma 3 level: " + grand.toFixed(2));
        if (grand >= 6) notes.push("Kinerja: World Class — pertahankan!");
        else if (grand >= 5) notes.push("Kinerja: Excellent");
        else if (grand >= 4) notes.push("Kinerja: Good — masih dalam standar");
        else if (grand >= 3) notes.push("Kinerja: Marginal — perlu peningkatan");
        else if (grand >= 2) notes.push("Kinerja: Poor — perbaikan diperlukan");
        else notes.push("Kinerja: Unacceptable — evaluasi mendesak!");
        const errorPer100 = estimateErrorPer100(grand);
        notes.push(
          "Estimasi kemungkinan error per 100 pasien: " + errorPer100 + " pasien"
        );
      } else {
        notes.push("Data tidak cukup untuk interpretasi");
      }
      interpretasi[src] = {
        grandSigma: grand !== null ? parseFloat(grand.toFixed(2)) : null,
        notes: notes,
        estimasiError: grand !== null ? estimateErrorPer100(grand) : null,
      };
    });

    const teInterp: string[] = [];
    const teaAvg = teTrend.tea.filter(function (v: any) {
      return v !== null;
    });
    const teaMean = teaAvg.length
      ? teaAvg.reduce(function (a: number, b: number) {
          return a + b;
        }, 0) / teaAvg.length
      : null;
    [1, 2, 3].forEach(function (lv) {
      const arr = teTrend["L" + lv].filter(function (v: any) {
        return v !== null;
      });
      if (!arr.length) return;
      const avg = arr.reduce(function (a: number, b: number) {
        return a + b;
      }, 0) / arr.length;
      const status = teaMean !== null && avg > teaMean ? "melampaui TEa!" : "baik";
      teInterp.push(
        "L" +
          lv +
          ": Rata-rata TE=" +
          avg.toFixed(2) +
          "%" +
          (teaMean !== null ? " vs TEa=" + teaMean.toFixed(2) + "%" : "") +
          " — " +
          status
      );
    });
    interpretasi.te = {
      teaMean: teaMean,
      notes: teInterp.length ? teInterp : ["Data TE tidak cukup"],
    };

    const paramInfo =
      paramID && paramMap[paramID]
        ? paramMap[paramID].parameter
        : "Semua Parameter";

    // ── Instrument Compare (v9.7) ──
    let instrumentCompare: any[] = [];
    let interpretasiDetail = "";
    let rekomendasiAlat = "";
    if (paramID && filteredLots.length) {
      const alatMap: Record<string, any> = {};
      filteredLots.forEach(function (lot) {
        const alat = lot.namaAlat || "Unknown";
        if (!alatMap[alat])
          alatMap[alat] = {
            namaAlat: alat,
            sigmas: [],
            cvs: [],
            biases: [],
            tes: [],
            tea: null,
            lots: [],
          };
        alatMap[alat].lots.push(lot);
        if (!alatMap[alat].tea) alatMap[alat].tea = parseNumSafe(lot.tea);
        months.forEach(function (m: any) {
          const mS2 = parseDateStr(m.startISO);
          const mE2 = parseDateStr(m.endISO);
          const qcs = allQCData.filter(function (q) {
            if (q.lotID !== lot.lotID) return false;
            const d = parseDateStr(q.tanggal);
            return d && mS2 && mE2 && d >= mS2 && d <= mE2;
          });
          if (!qcs.length) return;
          [1, 2, 3].forEach(function (lv) {
            const vals = qcs
              .map(function (q) {
                return parseNumSafe(
                  lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3
                );
              })
              .filter(function (v): v is number { return v !== null && v !== 0; });
            if (!vals.length) return;
            const mn = parseNumSafe(lot["meanL" + lv]);
            const tea = parseNumSafe(lot.tea);
            if (!mn || !tea) return;
            const calcMean = vals.reduce(function (a, b) {
              return a + b;
            }, 0) / vals.length;
            const calcSD = Math.sqrt(
              vals.reduce(function (s2, v) {
                return s2 + Math.pow(v - calcMean, 2);
              }, 0) / vals.length
            );
            const calcCV = calcMean ? (calcSD / calcMean) * 100 : 0;
            const bias = Math.abs(((calcMean - mn) / mn) * 100);
            const te = bias + 1.65 * calcCV;
            const sigma = calcCV ? (tea - Math.abs(bias)) / calcCV : null;
            if (sigma !== null) alatMap[alat].sigmas.push(sigma);
            alatMap[alat].cvs.push(calcCV);
            alatMap[alat].biases.push(bias);
            alatMap[alat].tes.push(te);
          });
        });
      });
      Object.keys(alatMap).forEach(function (alat) {
        const d = alatMap[alat];
        const avgSig = d.sigmas.length
          ? d.sigmas.reduce(function (a, b) {
              return a + b;
            }, 0) / d.sigmas.length
          : null;
        const avgCV = d.cvs.length
          ? d.cvs.reduce(function (a, b) {
              return a + b;
            }, 0) / d.cvs.length
          : null;
        const avgBias = d.biases.length
          ? d.biases.reduce(function (a, b) {
              return a + b;
            }, 0) / d.biases.length
          : null;
        const avgTE = d.tes.length
          ? d.tes.reduce(function (a, b) {
              return a + b;
            }, 0) / d.tes.length
          : null;
        function interpSigma(s: number | null) {
          if (s === null) return "N/A";
          if (s >= 6) return "Sangat Baik (World Class)";
          if (s >= 5) return "Baik (Excellent)";
          if (s >= 4) return "Cukup (Good)";
          if (s >= 3) return "Marginal";
          return "Buruk (Poor)";
        }
        function interpCV(c: number | null) {
          if (c === null) return "N/A";
          if (c <= 2) return "Sangat Baik";
          if (c <= 5) return "Baik";
          if (c <= 10) return "Cukup";
          return "Buruk";
        }
        function interpBias(b: number | null) {
          if (b === null) return "N/A";
          if (b <= 1) return "Sangat Baik";
          if (b <= 2) return "Baik";
          if (b <= 5) return "Cukup";
          return "Buruk";
        }
        function interpTE(t: number | null) {
          if (t === null) return "N/A";
          const tea = d.tea;
          if (!tea) return "N/A";
          if (t <= tea * 0.5) return "Sangat Baik";
          if (t <= tea * 0.75) return "Baik";
          if (t <= tea) return "Marginal";
          return "Buruk (Melebihi TEa)";
        }
        instrumentCompare.push({
          namaAlat: alat,
          avgSigma: avgSig !== null ? parseFloat(avgSig.toFixed(2)) : null,
          avgCV: avgCV !== null ? parseFloat(avgCV.toFixed(2)) : null,
          avgBias: avgBias !== null ? parseFloat(avgBias.toFixed(2)) : null,
          avgTE: avgTE !== null ? parseFloat(avgTE.toFixed(2)) : null,
          tea: d.tea,
          interpSigma: interpSigma(avgSig),
          interpCV: interpCV(avgCV),
          interpBias: interpBias(avgBias),
          interpTE: interpTE(avgTE),
          nData: d.sigmas.length,
        });
      });
      instrumentCompare.sort(function (a, b) {
        return (b.avgSigma || 0) - (a.avgSigma || 0);
      });
      const detailLines: string[] = [];
      detailLines.push(
        "Perbandingan kinerja instrumen untuk parameter: " + paramInfo
      );
      if (instrumentCompare.length < 2) {
        detailLines.push(
          "Hanya tersedia data untuk " +
            instrumentCompare.length +
            " instrumen. Perbandingan minimal memerlukan 2 instrumen."
        );
      } else {
        const best = instrumentCompare[0];
        const worst = instrumentCompare[instrumentCompare.length - 1];
        detailLines.push(
          "Instrumen terbaik: " +
            best.namaAlat +
            " (σ=" +
            best.avgSigma +
            ", CV=" +
            best.avgCV +
            "%, Bias=" +
            best.avgBias +
            "%)"
        );
        detailLines.push(
          "Instrumen terendah: " +
            worst.namaAlat +
            " (σ=" +
            worst.avgSigma +
            ", CV=" +
            worst.avgCV +
            "%, Bias=" +
            worst.avgBias +
            "%)"
        );
        if (best.avgSigma && worst.avgSigma) {
          const diff = parseFloat((best.avgSigma - worst.avgSigma).toFixed(2));
          detailLines.push("Selisih sigma: " + diff + " point");
        }
        instrumentCompare.forEach(function (ic) {
          detailLines.push(
            " - " +
              ic.namaAlat +
              ": σ=" +
              (ic.avgSigma || "N/A") +
              " [" +
              ic.interpSigma +
              "], CV=" +
              (ic.avgCV || "N/A") +
              "% [" +
              ic.interpCV +
              "], Bias=" +
              (ic.avgBias || "N/A") +
              "% [" +
              ic.interpBias +
              "]"
          );
        });
      }
      interpretasiDetail = detailLines.join("\n");

      const recLines: string[] = [];
      if (instrumentCompare.length >= 2) {
        const bestAlat = instrumentCompare[0];
        const worstAlat = instrumentCompare[instrumentCompare.length - 1];
        recLines.push("REKOMENDASI ALAT:");
        recLines.push(
          "1. Alat terbaik berdasarkan rata-rata sigma: " +
            bestAlat.namaAlat +
            " (σ=" +
            bestAlat.avgSigma +
            ")"
        );
        if (bestAlat.avgSigma && bestAlat.avgSigma >= 5) {
          recLines.push(
            " Kinerja " +
              bestAlat.namaAlat +
              " sudah Excellent/World Class. Pertahankan kondisi alat dan kalibrasi."
          );
        } else if (bestAlat.avgSigma && bestAlat.avgSigma >= 4) {
          recLines.push(
            " Kinerja " +
              bestAlat.namaAlat +
              " baik (Good). Masih dapat ditingkatkan ke level Excellent."
          );
        } else {
          recLines.push(
            " Kinerja alat terbaik masih di bawah standar optimal. Evaluasi metode dan perawatan alat."
          );
        }
        recLines.push(
          "2. Alat dengan kinerja terendah: " +
            worstAlat.namaAlat +
            " (σ=" +
            worstAlat.avgSigma +
            ")"
        );
        if (worstAlat.avgSigma && worstAlat.avgSigma < 3) {
          recLines.push(
            " PERHATIAN: Kinerja " +
              worstAlat.namaAlat +
              " Poor/Unacceptable! Pertimbangkan evaluasi metode, kalibrasi ulang, atau penggantian alat."
          );
        } else if (worstAlat.avgSigma && worstAlat.avgSigma < 4) {
          recLines.push(
            " Kinerja " +
              worstAlat.namaAlat +
              " Marginal. Perlu perbaikan presisi dan/atau akurasi."
          );
        }
        if (
          bestAlat.avgSigma &&
          worstAlat.avgSigma &&
          bestAlat.avgSigma - worstAlat.avgSigma > 2
        ) {
          recLines.push(
            "3. Terdapat perbedaan signifikan (>2σ) antar alat. Investigasi penyebab perbedaan (metode, reagen, kalibrasi)."
          );
        }
      } else if (instrumentCompare.length === 1) {
        recLines.push("REKOMENDASI ALAT:");
        recLines.push(
          "Hanya tersedia 1 instrumen. Tidak dapat melakukan perbandingan antar alat."
        );
        const only = instrumentCompare[0];
        recLines.push(
          "Kinerja " +
            only.namaAlat +
            ": σ=" +
            (only.avgSigma || "N/A") +
            " [" +
            only.interpSigma +
            "]"
        );
      } else {
        recLines.push(
          "REKOMENDASI ALAT: Tidak cukup data untuk memberikan rekomendasi."
        );
      }
      rekomendasiAlat = recLines.join("\n");
    }

    return {
      ok: true,
      data: {
        months: months,
        sigmaTrend: sigmaTrend,
        teTrend: teTrend,
        interpretasi: interpretasi,
        paramInfo: paramInfo,
        filterInfo: {
          paramID: paramID,
          lotID: lotID,
          bidang: bidang,
          namaAlat: namaAlat,
          tahun: tahun,
          bulanAwal: bulanAwal,
          bulanAkhir: bulanAkhir,
          siklusPME: siklusPME,
          tahunSiklus: tahunSiklus,
        },
        instrumentCompare: instrumentCompare,
        interpretasiDetail: interpretasiDetail,
        rekomendasiAlat: rekomendasiAlat,
      },
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ============================================================
// getInstrumentCompare — port 1:1 dari code.gs (lines 2583-2796)
// args[0]=ownerUsername, args[1]=role, args[2]=filter
// ============================================================
export async function getInstrumentCompare(
  args: any[],
  session: SessionData | null
) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  const filter = args[2] || {};
  try {
    const where: any = { ownerUsername };
    const [lotRows, paramRows] = await Promise.all([
      db.lotQC.findMany({ where, orderBy: { noLot: "asc" } }),
      db.parameters.findMany({ where, orderBy: { parameter: "asc" } }),
    ]);
    const lots = lotRows.map((r) => ({
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
    }));
    const params = paramRows.map((r) => ({
      paramID: r.id,
      parameter: r.parameter,
      bidang: r.bidang,
    }));
    const paramMap: Record<string, any> = {};
    params.forEach(function (p) {
      paramMap[p.paramID] = p;
    });
    const alatData: Record<string, any> = {};
    for (const lot of lots) {
      const alat = lot.namaAlat || "Unknown";
      if (!alatData[alat])
        alatData[alat] = { namaAlat: alat, scores: [], params: [] };
      const qcFilter: any = { lotID: lot.lotID };
      if (filter.startDate) qcFilter.startDate = filter.startDate;
      if (filter.endDate) qcFilter.endDate = filter.endDate;
      const qcData = await fetchInputQCRows(ownerUsername, role, qcFilter);
      if (!qcData.length) continue;
      if (filter.paramID && lot.paramID !== filter.paramID) continue;
      const stats = computeQCStats(qcData, lot);
      const sigs: number[] = [];
      [1, 2, 3].forEach(function (lv) {
        if (stats["L" + lv] && stats["L" + lv].sigma !== null)
          sigs.push(stats["L" + lv].sigma);
      });
      const avgSigma = sigs.length
        ? sigs.reduce(function (a, b) {
            return a + b;
          }, 0) / sigs.length
        : null;
      let qgi: number | null = null;
      let qgiInterp = "";
      if (stats.L1 && stats.L1.cv && stats.L1.bias !== undefined) {
        qgi = stats.L1.cv ? stats.L1.bias / (1.5 * stats.L1.cv) : null;
        if (qgi !== null)
          qgiInterp =
            qgi > 1.2
              ? "Imprecision dominant"
              : qgi < 0.8
              ? "Inaccuracy dominant"
              : "Balanced";
      }
      const paramEntry = {
        paramID: lot.paramID,
        parameter: paramMap[lot.paramID] ? paramMap[lot.paramID].parameter : "",
        bidang: paramMap[lot.paramID]
          ? paramMap[lot.paramID].bidang || ""
          : "",
        noLot: lot.noLot,
        tea: parseNumSafe(lot.tea),
        stats: stats,
        avgSigma: avgSigma ? parseFloat(avgSigma.toFixed(2)) : null,
        qgi: qgi !== null ? parseFloat(qgi.toFixed(3)) : null,
        qgiInterp: qgiInterp,
      };
      alatData[alat].scores.push(avgSigma || 0);
      alatData[alat].params.push(paramEntry);
    }
    const ranked: any[] = Object.keys(alatData)
      .map(function (alat) {
        const d = alatData[alat];
        const scores = d.scores.filter(function (s: any) {
          return s !== null;
        });
        const avgScore = scores.length
          ? scores.reduce(function (a: number, b: number) {
              return a + b;
            }, 0) / scores.length
          : 0;
        return {
          namaAlat: alat,
          avgSigma: parseFloat(avgScore.toFixed(2)),
          n: scores.length,
          params: d.params,
        };
      })
      .sort(function (a, b) {
        return b.avgSigma - a.avgSigma;
      });

    function interpSig(s: number | null) {
      if (s === null) return "N/A";
      if (s >= 6) return "Sangat Baik (World Class)";
      if (s >= 5) return "Baik (Excellent)";
      if (s >= 4) return "Cukup (Good)";
      if (s >= 3) return "Marginal";
      return "Buruk (Poor)";
    }
    function interpCV2(c: number | null) {
      if (c === null) return "N/A";
      if (c <= 2) return "Sangat Baik";
      if (c <= 5) return "Baik";
      if (c <= 10) return "Cukup";
      return "Buruk";
    }
    function interpBias2(b: number | null) {
      if (b === null) return "N/A";
      if (b <= 1) return "Sangat Baik";
      if (b <= 2) return "Baik";
      if (b <= 5) return "Cukup";
      return "Buruk";
    }
    function interpTE2(t: number | null, tea: any) {
      if (t === null || !tea) return "N/A";
      if (t <= tea * 0.5) return "Sangat Baik";
      if (t <= tea * 0.75) return "Baik";
      if (t <= tea) return "Marginal";
      return "Buruk (Melebihi TEa)";
    }

    ranked.forEach(function (r) {
      const allCVs: number[] = [];
      const allBiases: number[] = [];
      const allTEs: number[] = [];
      r.params.forEach(function (p: any) {
        [1, 2, 3].forEach(function (lv) {
          const s = p.stats["L" + lv];
          if (s && s.cv !== null && s.cv !== undefined) allCVs.push(s.cv);
          if (s && s.bias !== null && s.bias !== undefined)
            allBiases.push(Math.abs(s.bias));
          if (s && s.te !== null && s.te !== undefined) allTEs.push(s.te);
        });
      });
      r.avgCV = allCVs.length
        ? parseFloat(
            (
              allCVs.reduce(function (a, b) {
                return a + b;
              }, 0) / allCVs.length
            ).toFixed(2)
          )
        : null;
      r.avgBias = allBiases.length
        ? parseFloat(
            (
              allBiases.reduce(function (a, b) {
                return a + b;
              }, 0) / allBiases.length
            ).toFixed(2)
          )
        : null;
      r.avgTE = allTEs.length
        ? parseFloat(
            (
              allTEs.reduce(function (a, b) {
                return a + b;
              }, 0) / allTEs.length
            ).toFixed(2)
          )
        : null;
      r.nParams = r.params.length;
    });

    const detailColumns = ranked.map(function (r) {
      let qgiAvg: number | null = null;
      if (r.avgCV && r.avgBias !== null) {
        qgiAvg = r.avgCV ? r.avgBias / (1.5 * r.avgCV) : null;
      }
      let qgiInterpVal = "";
      if (qgiAvg !== null)
        qgiInterpVal =
          qgiAvg > 1.2
            ? "Imprecision dominant"
            : qgiAvg < 0.8
            ? "Inaccuracy dominant"
            : "Balanced";
      let avgTEa: number | null = null;
      const teas = r.params
        .map(function (p: any) {
          return p.tea;
        })
        .filter(function (t: any) {
          return t !== null;
        });
      if (teas.length)
        avgTEa = teas.reduce(function (a: number, b: number) {
          return a + b;
        }, 0) / teas.length;
      return {
        namaAlat: r.namaAlat,
        avgSigma: r.avgSigma,
        avgCV: r.avgCV,
        avgBias: r.avgBias,
        avgTE: r.avgTE,
        nParams: r.nParams,
        interpSigma: interpSig(r.avgSigma),
        interpCV: interpCV2(r.avgCV),
        interpBias: interpBias2(r.avgBias),
        interpTE: interpTE2(r.avgTE, avgTEa),
        qgiAvg: qgiAvg !== null ? parseFloat(qgiAvg.toFixed(3)) : null,
        qgiInterp: qgiInterpVal,
      };
    });

    const paramCompareMap: Record<string, any> = {};
    ranked.forEach(function (r) {
      r.params.forEach(function (p: any) {
        if (!paramCompareMap[p.paramID]) {
          paramCompareMap[p.paramID] = {
            paramID: p.paramID,
            parameter: p.parameter,
            bidang: p.bidang,
            instruments: [],
          };
        }
        const allCVs: number[] = [];
        const allBiases: number[] = [];
        const allTEs: number[] = [];
        const allSigmas: number[] = [];
        [1, 2, 3].forEach(function (lv) {
          const s = p.stats["L" + lv];
          if (s) {
            if (s.cv !== null && s.cv !== undefined) allCVs.push(s.cv);
            if (s.bias !== null && s.bias !== undefined)
              allBiases.push(Math.abs(s.bias));
            if (s.te !== null && s.te !== undefined) allTEs.push(s.te);
            if (s.sigma !== null && s.sigma !== undefined) allSigmas.push(s.sigma);
          }
        });
        const pCV = allCVs.length
          ? parseFloat(
              (
                allCVs.reduce(function (a, b) {
                  return a + b;
                }, 0) / allCVs.length
              ).toFixed(2)
            )
          : null;
        const pBias = allBiases.length
          ? parseFloat(
              (
                allBiases.reduce(function (a, b) {
                  return a + b;
                }, 0) / allBiases.length
              ).toFixed(2)
            )
          : null;
        const pTE = allTEs.length
          ? parseFloat(
              (
                allTEs.reduce(function (a, b) {
                  return a + b;
                }, 0) / allTEs.length
              ).toFixed(2)
            )
          : null;
        const pSigma = allSigmas.length
          ? parseFloat(
              (
                allSigmas.reduce(function (a, b) {
                  return a + b;
                }, 0) / allSigmas.length
              ).toFixed(2)
            )
          : null;
        paramCompareMap[p.paramID].instruments.push({
          namaAlat: r.namaAlat,
          noLot: p.noLot,
          tea: p.tea,
          avgSigma: pSigma,
          avgCV: pCV,
          avgBias: pBias,
          avgTE: pTE,
          interpSigma: interpSig(pSigma),
          interpCV: interpCV2(pCV),
          interpBias: interpBias2(pBias),
          interpTE: interpTE2(pTE, p.tea),
        });
      });
    });
    const paramCompareDetail = Object.keys(paramCompareMap).map(function (k) {
      return paramCompareMap[k];
    });

    let detailedInterpretasi = "";
    if (ranked.length === 0) {
      detailedInterpretasi = "Tidak cukup data untuk perbandingan instrumen.";
    } else {
      const lines: string[] = [];
      lines.push("=== ANALISIS PERBANDINGAN INSTRUMEN ===");
      lines.push("Jumlah instrumen: " + ranked.length);
      if (ranked.length >= 2) {
        const best = ranked[0];
        const worst = ranked[ranked.length - 1];
        lines.push("");
        lines.push("Instrumen terbaik: " + best.namaAlat);
        lines.push(
          " Sigma: " + (best.avgSigma || "N/A") + " [" + interpSig(best.avgSigma) + "]"
        );
        lines.push(
          " CV: " + (best.avgCV || "N/A") + "% [" + interpCV2(best.avgCV) + "]"
        );
        lines.push(
          " Bias: " + (best.avgBias || "N/A") + "% [" + interpBias2(best.avgBias) + "]"
        );
        lines.push(
          " TE: " +
            (best.avgTE || "N/A") +
            "% [" +
            interpTE2(
              best.avgTE,
              best.params.length ? best.params[0].tea : null
            ) +
            "]"
        );
        lines.push(" Jumlah parameter: " + best.nParams);
        lines.push("");
        lines.push("Instrumen terendah: " + worst.namaAlat);
        lines.push(
          " Sigma: " +
            (worst.avgSigma || "N/A") +
            " [" +
            interpSig(worst.avgSigma) +
            "]"
        );
        lines.push(
          " CV: " + (worst.avgCV || "N/A") + "% [" + interpCV2(worst.avgCV) + "]"
        );
        lines.push(
          " Bias: " +
            (worst.avgBias || "N/A") +
            "% [" +
            interpBias2(worst.avgBias) +
            "]"
        );
        lines.push(
          " TE: " +
            (worst.avgTE || "N/A") +
            "% [" +
            interpTE2(
              worst.avgTE,
              worst.params.length ? worst.params[0].tea : null
            ) +
            "]"
        );
        lines.push(" Jumlah parameter: " + worst.nParams);
        if (best.avgSigma && worst.avgSigma) {
          const diff = parseFloat((best.avgSigma - worst.avgSigma).toFixed(2));
          lines.push("");
          lines.push(
            "Selisih sigma antar instrumen terbaik dan terendah: " + diff + " point"
          );
          if (diff > 2)
            lines.push(
              "Perbedaan signifikan (>2σ) — investigasi penyebab perbedaan (metode, reagen, kalibrasi)."
            );
          else if (diff > 1)
            lines.push(
              "Perbedaan moderat (1-2σ) — pemantauan berkala diperlukan."
            );
          else
            lines.push(
              "Perbedaan kecil (<1σ) — kinerja instrumen relatif seragam."
            );
        }
      }
      lines.push("");
      lines.push("=== DETAIL PER INSTRUMEN ===");
      detailColumns.forEach(function (dc) {
        lines.push("");
        lines.push("■ " + dc.namaAlat + " (" + dc.nParams + " parameter)");
        lines.push(
          " Rata-rata Sigma: " + (dc.avgSigma || "N/A") + " — " + dc.interpSigma
        );
        lines.push(
          " Rata-rata CV: " + (dc.avgCV || "N/A") + "% — " + dc.interpCV
        );
        lines.push(
          " Rata-rata Bias: " + (dc.avgBias || "N/A") + "% — " + dc.interpBias
        );
        lines.push(
          " Rata-rata TE: " + (dc.avgTE || "N/A") + "% — " + dc.interpTE
        );
        if (dc.qgiAvg !== null) {
          lines.push(" QGI: " + dc.qgiAvg + " — " + dc.qgiInterp);
          if (dc.qgiInterp === "Imprecision dominant")
            lines.push(" → Perbaikan presisi (CV) harus diprioritaskan.");
          else if (dc.qgiInterp === "Inaccuracy dominant")
            lines.push(
              " → Perbaikan akurasi (kalibrasi) harus diprioritaskan."
            );
          else lines.push(" → Keseimbangan presisi dan akurasi baik.");
        }
      });
      detailedInterpretasi = lines.join("\n");
    }

    return {
      ok: true,
      data: ranked,
      detailedInterpretasi: detailedInterpretasi,
      detailColumns: detailColumns,
      paramCompareDetail: paramCompareDetail,
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ============================================================
// getTabulasiData — port 1:1 dari code.gs (lines 2798-2876)
// args[0]=ownerUsername, args[1]=role, args[2]=filter {tahun, bulanAwal,
// bulanAkhir, bidang, paramIDs[], startDate, endDate, parameter}
// ============================================================
export async function getTabulasiData(
  args: any[],
  session: SessionData | null
) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  const filter = args[2] || {};
  try {
    const where: any = { ownerUsername };
    const [paramRows, lotRows] = await Promise.all([
      db.parameters.findMany({ where, orderBy: { parameter: "asc" } }),
      db.lotQC.findMany({ where, orderBy: { noLot: "asc" } }),
    ]);
    let params: any[] = paramRows.map((r) => ({
      paramID: r.id,
      parameter: r.parameter,
      bidang: r.bidang,
    }));
    if (filter.paramIDs && filter.paramIDs.length)
      params = params.filter(function (p) {
        return filter.paramIDs.indexOf(p.paramID) > -1;
      });
    if (filter.bidang)
      params = params.filter(function (p) {
        return (p.bidang || "Lainnya") === filter.bidang;
      });
    const lots = lotRows.map((r) => ({
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
    }));
    const result: any[] = [];
    for (const param of params) {
      const paramLots = lots.filter(function (l) {
        return l.paramID === param.paramID;
      });
      for (const lot of paramLots) {
        const qcFilter: any = { lotID: lot.lotID };
        if (filter.startDate) qcFilter.startDate = filter.startDate;
        if (filter.endDate) qcFilter.endDate = filter.endDate;
        const qcData = await fetchInputQCRows(ownerUsername, role, qcFilter);
        if (!qcData.length) continue;
        const stats = computeQCStats(qcData, lot);
        const pmeRows = await db.biasPME.findMany({
          where: { lotID: lot.lotID, ownerUsername: ownerUsername },
        });
        const lotPME = pmeRows;
        const latestPME = lotPME.length ? lotPME[lotPME.length - 1] : null;
        const pmeItem = latestPME
          ? {
              pmeID: latestPME.id,
              paramID: latestPME.paramID,
              lotID: latestPME.lotID,
              namaAlat: latestPME.namaAlat,
              methode: latestPME.methode,
              satuan: latestPME.satuan,
              siklus: latestPME.siklus,
              tahun: latestPME.tahun,
              hasilL1: latestPME.hasilL1,
              hasilL2: latestPME.hasilL2,
              hasilL3: latestPME.hasilL3,
              meanPesertaL1: latestPME.meanPesertaL1,
              meanPesertaL2: latestPME.meanPesertaL2,
              meanPesertaL3: latestPME.meanPesertaL3,
              tea: latestPME.tea,
              cvL1: latestPME.cvL1,
              cvL2: latestPME.cvL2,
              cvL3: latestPME.cvL3,
              cvStartDate: latestPME.cvStartDate,
              cvEndDate: latestPME.cvEndDate,
              owner: latestPME.ownerUsername,
              details: {} as Record<string, any>,
            }
          : null;
        if (pmeItem) {
          [1, 2, 3].forEach(function (lv) {
            const lotMean = parseNumSafe(lot["meanL" + lv]);
            const lotSD = parseNumSafe(lot["sdL" + lv]);
            const hasil = parseNumSafe((pmeItem as any)["hasilL" + lv]);
            const meanP = parseNumSafe(
              (pmeItem as any)["meanPesertaL" + lv]
            );
            const cvUsed = parseNumSafe((pmeItem as any)["cvL" + lv]);
            const bias =
              hasil && meanP ? Math.abs(((hasil - meanP) / meanP) * 100) : null;
            let cv: number | null = cvUsed;
            if (!cv && lotMean && lotSD) cv = (lotSD / lotMean) * 100;
            const te =
              bias !== null && cv !== null ? Math.abs(bias) + 1.65 * cv : null;
            const tea = parseNumSafe(pmeItem.tea);
            const sigma =
              tea !== null && bias !== null && cv ? (tea - bias) / cv : null;
            (pmeItem as any).details["L" + lv] = {
              mean: lotMean ? parseFloat(lotMean.toFixed(3)) : null,
              sd: lotSD ? parseFloat(lotSD.toFixed(3)) : null,
              cv: cv !== null ? parseFloat(cv.toFixed(2)) : null,
              bias: bias !== null ? parseFloat(bias.toFixed(2)) : null,
              te: te !== null ? parseFloat(te.toFixed(2)) : null,
              tea: tea,
              sigma: sigma !== null ? parseFloat(sigma.toFixed(2)) : null,
            };
          });
        }
        result.push({
          paramID: param.paramID,
          parameter: param.parameter,
          bidang: param.bidang || "Lainnya",
          lotID: lot.lotID,
          namaAlat: lot.namaAlat,
          noLot: lot.noLot,
          satuan: lot.satuan,
          tea: parseNumSafe(lot.tea),
          stats: stats,
          pme: pmeItem,
          nQC: qcData.length,
        });
      }
    }

    // ── PME Rekap Detail (v9.7) ──
    const pmeRekapDetail: any[] = [];
    const allPME = await db.biasPME.findMany({
      where: { ownerUsername },
    });
    const pmeFiltered = allPME.filter(function (pme: any) {
      if (filter.tahun && String(pme.tahun) !== String(filter.tahun))
        return false;
      if (filter.bulan && pme.siklus !== filter.bulan) return false;
      if (filter.bidang) {
        const pParam = params.find(function (pp) {
          return pp.paramID === pme.paramID;
        });
        if (!pParam || (pParam.bidang || "Lainnya") !== filter.bidang)
          return false;
      }
      if (
        filter.paramIDs &&
        filter.paramIDs.length &&
        filter.paramIDs.indexOf(pme.paramID) < 0
      )
        return false;
      if (filter.parameter && pme.paramID !== filter.parameter) return false;
      return true;
    });
    pmeFiltered.forEach(function (pme: any) {
      let pName = "";
      const pParam = params.find(function (pp) {
        return pp.paramID === pme.paramID;
      });
      if (pParam) pName = pParam.parameter;
      const tea = parseNumSafe(pme.tea);
      const row: any = {
        Parameter: pName,
        TEa: tea,
        Siklus: pme.siklus,
        TahunSiklus: pme.tahun,
        NamaAlat: pme.namaAlat,
        HasilL1: null,
        HasilL2: null,
        HasilL3: null,
        HasilPL1: null,
        HasilPL2: null,
        HasilPL3: null,
        BiasL1: null,
        BiasL2: null,
        BiasL3: null,
        SigmaL1: null,
        SigmaL2: null,
        SigmaL3: null,
      };
      [1, 2, 3].forEach(function (lv) {
        const hasil = parseNumSafe(pme["hasilL" + lv]);
        const meanP = parseNumSafe(pme["meanPesertaL" + lv]);
        const bias =
          hasil && meanP ? ((hasil - meanP) / meanP) * 100 : null;
        const cv =
          parseNumSafe(pme["cvL" + lv]) || null;
        const sigma =
          tea !== null && bias !== null && cv ? (tea - Math.abs(bias)) / cv : null;
        row["HasilL" + lv] = hasil;
        row["HasilPL" + lv] = meanP;
        row["BiasL" + lv] = bias !== null ? parseFloat(bias.toFixed(2)) : null;
        row["SigmaL" + lv] =
          sigma !== null ? parseFloat(sigma.toFixed(2)) : null;
      });
      pmeRekapDetail.push(row);
    });

    const periodKey = (filter.startDate || "") + "_" + (filter.endDate || "");
    const catatan = await getCatatanTabulasi([periodKey], session);
    const kop = await getKopSurat([ownerUsername], session);
    return {
      ok: true,
      data: result,
      catatan: catatan,
      periodKey: periodKey,
      kop: kop,
      filter: filter,
      pmeRekapDetail: pmeRekapDetail,
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ============================================================
// getOPSpecsData — port 1:1 dari code.gs (lines 2878-3097)
// args[0]=ownerUsername, args[1]=role, args[2]=filter {tahun, bidang,
// paramID, startDate, endDate}
// ============================================================
export async function getOPSpecsData(
  args: any[],
  session: SessionData | null
) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  const filter = args[2] || {};
  try {
    const where: any = { ownerUsername };
    let paramRows = await db.parameters.findMany({
      where,
      orderBy: { parameter: "asc" },
    });
    if (filter.bidang)
      paramRows = paramRows.filter(function (p) {
        return (p.bidang || "Lainnya") === filter.bidang;
      });
    const lotRows = await db.lotQC.findMany({
      where,
      orderBy: { noLot: "asc" },
    });
    const allQC = await fetchInputQCRows(ownerUsername, role, {
      startDate: filter.startDate || undefined,
      endDate: filter.endDate || undefined,
    });
    const result: any[] = [];
    const opsAnalisisDetail: string[] = [];
    const opsCriticalErrorData: any[] = [];

    for (const param of paramRows) {
      const paramLots = lotRows.filter(function (l) {
        return l.paramID === param.id;
      });
      for (const lotRow of paramLots) {
        const lot: any = {
          lotID: lotRow.id,
          paramID: lotRow.paramID,
          noLot: lotRow.noLot,
          namaAlat: lotRow.namaAlat,
          meanL1: lotRow.meanL1,
          sdL1: lotRow.sdL1,
          meanL2: lotRow.meanL2,
          sdL2: lotRow.sdL2,
          meanL3: lotRow.meanL3,
          sdL3: lotRow.sdL3,
          tea: lotRow.tea,
        };
        const qcs = allQC.filter(function (q) {
          return q.lotID === lot.lotID;
        });
        if (!qcs.length) continue;
        const tea = parseNumSafe(lot.tea);
        if (!tea) continue;
        // Compute sigma per level using observation CV (v9.10 fix)
        const levelData: any = {};
        [1, 2, 3].forEach(function (lv) {
          const mLv = parseNumSafe(lot["meanL" + lv]);
          if (!mLv) return;
          const valsLv = qcs
            .map(function (q: any) {
              return parseNumSafe(
                lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3
              );
            })
            .filter(function (v): v is number { return v !== null && v !== 0; });
          if (!valsLv.length) return;
          const calcMeanLv = valsLv.reduce(function (a, b) {
            return a + b;
          }, 0) / valsLv.length;
          const calcSDLv = Math.sqrt(
            valsLv.reduce(function (s2, v) {
              return s2 + Math.pow(v - calcMeanLv, 2);
            }, 0) / valsLv.length
          );
          const cvLv = calcMeanLv ? (calcSDLv / calcMeanLv) * 100 : 0;
          if (!cvLv) return;
          const biasLv = Math.abs(((calcMeanLv - mLv) / mLv) * 100);
          const sigmaLv = (tea - biasLv) / cvLv;
          levelData["L" + lv] = {
            cv: cvLv,
            bias: biasLv,
            sigma: sigmaLv,
            mean: mLv,
          };
        });
        let smallestLevel: string | null = null;
        let smallestSigma: number | null = null;
        ["L1", "L2", "L3"].forEach(function (lv) {
          const ld = levelData[lv];
          if (
            ld &&
            ld.sigma !== null &&
            (smallestSigma === null || ld.sigma < smallestSigma)
          ) {
            smallestSigma = ld.sigma;
            smallestLevel = lv;
          }
        });
        if (!smallestLevel) continue;
        const cv = levelData[smallestLevel].cv;
        const bias = levelData[smallestLevel].bias;
        const sigma: any = smallestSigma;
        const ped = sigma ? computePed(sigma) : null;
        const pfr = sigma ? computePfr(sigma) : null;
        const biasAbs = Math.abs(bias);
        const sec =
          tea !== null && cv ? (tea - biasAbs) / cv - 1.65 : null;
        const rec =
          tea !== null && cv ? (tea - biasAbs) / (1.65 * cv) - 1 : null;

        // Detailed OPSpecs Analysis (v9.7)
        let pedInterp = "";
        if (ped === null)
          pedInterp = "Tidak dapat dihitung (data tidak cukup)";
        else if (ped >= 90)
          pedInterp = "Sangat Baik - Probabilitas deteksi error sangat tinggi";
        else if (ped >= 50)
          pedInterp = "Cukup Baik - Probabilitas deteksi error memadai";
        else pedInterp = "Kurang Baik - Perlu evaluasi metode dan aturan QC";
        const dSec = sec ? parseFloat(sec.toFixed(2)) : null;
        const dRec = rec ? parseFloat(rec.toFixed(4)) : null;
        let critErrInterp = "";
        if (dSec === null || dRec === null) critErrInterp = "Data tidak cukup";
        else if (dSec > 3 && dRec < 1.5)
          critErrInterp = "Baik - Critical error terdeteksi dengan baik";
        else if (dSec > 2)
          critErrInterp = "Cukup - Kemampuan deteksi critical error moderat";
        else
          critErrInterp =
            "Kurang - Risiko critical error tinggi, evaluasi metode";

        const detailText =
          "Parameter: " +
          param.parameter +
          " | Alat: " +
          lot.namaAlat +
          " | CV=" +
          parseFloat(cv.toFixed(2)) +
          "% | Bias=" +
          parseFloat(bias.toFixed(2)) +
          "% | TEa=" +
          tea +
          "% | Sigma=" +
          (sigma ? sigma.toFixed(2) : "N/A") +
          " | PED=" +
          ped +
          "% [" +
          pedInterp +
          "]";
        opsAnalisisDetail.push(detailText);
        opsCriticalErrorData.push({
          parameter: param.parameter,
          namaAlat: lot.namaAlat,
          deltaSEc: dSec,
          deltaREc: dRec,
          criticalErrorInterp: critErrInterp,
          ped: ped,
          pedInterp: pedInterp,
          cv: parseFloat(cv.toFixed(2)),
          bias: parseFloat(bias.toFixed(2)),
          tea: tea,
          sigma: sigma ? parseFloat(sigma.toFixed(2)) : null,
        });
        result.push({
          paramID: param.id,
          parameter: param.parameter,
          bidang: param.bidang || "Lainnya",
          lotID: lot.lotID,
          namaAlat: lot.namaAlat,
          noLot: lot.noLot,
          cv: parseFloat(cv.toFixed(2)),
          bias: parseFloat(bias.toFixed(2)),
          tea: tea,
          sigma: sigma ? parseFloat(sigma.toFixed(2)) : null,
          ped: ped,
          pfr: pfr,
          sec: sec,
          rec: rec,
        });
      }
    }

    const kop = await getKopSurat([ownerUsername], session);

    // OPSpecs Kesimpulan & Analisis Detail (Enhanced)
    let opsKesimpulan = "";
    if (result.length > 0) {
      const totalPEDok = result.filter(function (r) {
        return r.ped && r.ped >= 90;
      }).length;
      const totalPECukup = result.filter(function (r) {
        return r.ped && r.ped >= 50 && r.ped < 90;
      }).length;
      const totalPEKurang = result.filter(function (r) {
        return r.ped && r.ped < 50;
      }).length;
      const avgSigmaAll = result
        .filter(function (r) {
          return r.sigma !== null;
        })
        .map(function (r) {
          return r.sigma;
        });
      const avgSigma = avgSigmaAll.length
        ? avgSigmaAll.reduce(function (a, b) {
            return a + b;
          }, 0) / avgSigmaAll.length
        : null;
      const kesLines: string[] = [];
      kesLines.push("═══════════════════════════════════════════");
      kesLines.push("KESIMPULAN ANALISIS OPSPECS & CRITICAL-ERROR");
      kesLines.push("═══════════════════════════════════════════");
      kesLines.push("");
      kesLines.push("▸ Total parameter dievaluasi: " + result.length);
      kesLines.push(" ─ PED Sangat Baik (≥90%): " + totalPEDok + " parameter");
      kesLines.push(
        " ─ PED Cukup Baik (50-89%): " + totalPECukup + " parameter"
      );
      kesLines.push(
        " ─ PED Kurang Baik (<50%): " + totalPEKurang + " parameter"
      );
      if (avgSigma !== null)
        kesLines.push(" ─ Rata-rata Sigma: " + avgSigma.toFixed(2));
      kesLines.push("");
      kesLines.push("───────────────────────────────────────────");
      kesLines.push(
        "ANALISIS DETAIL PER PARAMETER (OPSpecs & Critical-Error):"
      );
      kesLines.push("───────────────────────────────────────────");
      result.forEach(function (r, idx) {
        kesLines.push("");
        kesLines.push(
          (idx + 1) + ". " + r.parameter + " (" + r.namaAlat + ")"
        );
        kesLines.push(
          " CV: " +
            r.cv +
            "% | Bias: " +
            r.bias +
            "% | TEa: " +
            r.tea +
            "% | Sigma: " +
            (r.sigma !== null ? r.sigma : "N/A")
        );
        kesLines.push("");
        kesLines.push(" ■ ANALISIS OPSpecs (Grafik OPSpecs):");
        kesLines.push(
          " ─ Titik koordinat (CV=" +
            r.cv +
            "%, Bias=" +
            r.bias +
            "%) berada di " +
            (r.sigma >= 4
              ? "ZONA AMAN (hijau)"
              : r.sigma >= 2
              ? "ZONA KRITIS (kuning)"
              : "ZONA BAHAYA (merah)") +
            "."
        );
        if (r.sigma !== null && r.sigma >= 6) {
          kesLines.push(
            " ─ Sigma " +
              r.sigma +
              " (World Class): Kinerja QC sangat baik. Aturan 1-3s saja sudah cukup untuk mendeteksi error. Probabilitas error tidak terdeteksi sangat rendah."
          );
        } else if (r.sigma !== null && r.sigma >= 5) {
          kesLines.push(
            " ─ Sigma " +
              r.sigma +
              " (Excellent): Kinerja sangat baik. Sistem QC mampu mendeteksi error dengan baik menggunakan aturan multi-rule standar."
          );
        } else if (r.sigma !== null && r.sigma >= 4) {
          kesLines.push(
            " ─ Sigma " +
              r.sigma +
              " (Good): Kinerja baik. Gunakan aturan 1-3s, 2-2s, R-4s untuk menjaga kualitas."
          );
        } else if (r.sigma !== null && r.sigma >= 3) {
          kesLines.push(
            " ─ Sigma " +
              r.sigma +
              " (Marginal): Kinerja marginal. Perlu multi-rule lengkap (1-3s, 2-2s, R-4s, 4-1s) dan pemantauan ketat. Pertimbangkan perbaikan presisi atau metode."
          );
        } else if (r.sigma !== null) {
          kesLines.push(
            " ─ Sigma " +
              r.sigma +
              " (Poor/Unacceptable): KINERJA BURUK! QC tidak reliable. Diperlukan evaluasi menyeluruh: perbaikan kalibrasi, ganti reagen, atau pertimbangkan penggantian metode/alat."
          );
        }
        kesLines.push("");
        kesLines.push(" ■ HUBUNGAN OPSpecs DAN CRITICAL-ERROR:");
        const ceData = opsCriticalErrorData.filter(function (c) {
          return c.parameter === r.parameter && c.namaAlat === r.namaAlat;
        })[0];
        if (r.sigma !== null && ceData) {
          if (r.sigma >= 4) {
            kesLines.push(
              " ─ Grafik OPSpecs menunjukkan titik di ZONA AMAN, dan grafik Critical-Error mengonfirmasi ΔSEc besar (≥3 SD) dan ΔREc kecil (≤1 CV). Ini berarti: (1) Sistem QC memiliki performa sangat baik, (2) Error sistematik maupun acak dapat terdeteksi sebelum melewati spesifikasi, (3) Risiko error klinis sangat rendah. Tidak ada tindakan korektif yang mendesak."
            );
          } else if (r.sigma >= 3) {
            kesLines.push(
              " ─ Grafik OPSpecs menunjukkan titik mendekati batas zona kritis, sedangkan grafik Critical-Error menunjukkan ΔSEc moderat dan ΔREc meningkat. Ini berarti: (1) Sistem QC masih mampu mendeteksi error besar, namun mungkin melewatkan error kecil-kecil, (2) Peningkatan CV atau Bias sedikit saja dapat mendorong titik masuk zona bahaya, (3) Diperlukan peningkatan presisi dan pemantauan bias secara berkala. Rekomendasi: pertahankan multi-rule lengkap dan evaluasi tren sigma."
            );
          } else {
            kesLines.push(
              " ─ Grafik OPSpecs menunjukkan titik di ZONA BAHAYA/KEKRITIS, dan grafik Critical-Error mengonfirmasi ΔSEc kecil (<2 SD) dan/atau ΔREc besar (>1.5 CV). Ini berarti: (1) Sistem QC TIDAK MAMPU mendeteksi error secara memadai, (2) Bahkan error kecil sudah mendekati atau melampaui batas spesifikasi, (3) Risiko hasil QC keliru yang masuk ke pasien sangat tinggi. TINDAKAN: (a) Investigasi sumber error — periksa kalibrasi, reagen, pipetting, dan kondisi alat, (b) Pertimbangkan perubahan metode atau penggantian alat jika perbaikan tidak memadai, (c) Tingkatkan frekuensi QC sementara, (d) Lakukan PME untuk konfirmasi akurasi."
            );
          }
        } else if (r.sigma !== null) {
          kesLines.push(
            " ─ Sigma = " +
              r.sigma +
              " menunjukkan kinerja " +
              (r.sigma >= 4 ? "baik" : "marginal/buruk") +
              ". Tindakan perbaikan " +
              (r.sigma >= 4 ? "tidak mendesak" : "DIPERLUKAN") +
              "."
          );
        }
      });
      kesLines.push("");
      kesLines.push("───────────────────────────────────────────");
      kesLines.push("KESIMPULAN UMUM & REKOMENDASI:");
      kesLines.push("───────────────────────────────────────────");
      if (totalPEDok === result.length && result.length > 0) {
        kesLines.push(
          "✅ SELURUH parameter memiliki kinerja OPSpecs SANGAT BAIK (Ped ≥90%, Sigma ≥4)."
        );
        kesLines.push(
          " Sistem QC saat ini dapat diandalkan. Pertahankan strategi QC dan monitoring berkala."
        );
        kesLines.push(
          " Grafik OPSpecs dan Critical-Error saling mengonfirmasi bahwa kemampuan deteksi error sangat baik untuk semua parameter."
        );
      } else if (totalPEKurang === 0) {
        kesLines.push(
          "⚠️ Sebagian parameter memiliki kinerja OPSpecs CUKUP (Ped 50-89%)."
        );
        kesLines.push(
          " Perlu pemantauan dan evaluasi berkala. Pastikan tidak terjadi degradasi kinerja."
        );
        kesLines.push(
          " Tinjau parameter dengan Ped terendah untuk perbaikan preventif."
        );
      } else {
        kesLines.push(
          "✅ " +
            totalPEKurang +
            " parameter memiliki kinerja OPSpecs KURANG (Ped <50%)."
        );
        kesLines.push(" Parameter ini memerlukan evaluasi dan perbaikan SEGERA:");
        const krgParams = opsCriticalErrorData.filter(function (c) {
          return c.ped !== null && c.ped < 50;
        });
        krgParams.forEach(function (c) {
          kesLines.push(
            " → " +
              c.parameter +
              " (" +
              c.namaAlat +
              "): σ=" +
              (c.sigma || "N/A") +
              ", Ped=" +
              c.ped +
              "%, ΔSEc=" +
              (c.deltaSEc || "N/A") +
              ", ΔREc=" +
              (c.deltaREc || "N/A")
          );
        });
        kesLines.push(
          " Hubungan OPSpecs-Critical-Error: Titik-titik di zona bahaya pada grafik OPSpecs berkorelasi dengan ΔSEc kecil dan ΔREc besar pada grafik Critical-Error, menunjukkan bahwa error yang tidak terdeteksi oleh aturan QC saat ini sudah mendekati/melampaui batas spesifikasi (TEa)."
        );
        kesLines.push("");
        kesLines.push(" REKOMENDASI TINDAKAN:");
        kesLines.push(
          " 1. Evaluasi dan perbaiki presisi (turunkan CV) — periksa teknik, reagen, kalibrasi"
        );
        kesLines.push(
          " 2. Evaluasi dan perbaiki akurasi (turunkan Bias) — periksa kalibrasi, lot reagen"
        );
        kesLines.push(" 3. Tingkatkan frekuensi QC untuk parameter kritis");
        kesLines.push(
          " 4. Pertimbangkan perubahan metode/alat jika sigma tetap <3 setelah perbaikan"
        );
        kesLines.push(
          " 5. Lakukan PME untuk memvalidasi kinerja terhadap laboratorium lain"
        );
      }
      opsKesimpulan = kesLines.join("\n");
    } else {
      opsKesimpulan = "Tidak cukup data untuk membuat kesimpulan OPSpecs.";
    }

    return {
      ok: true,
      data: result,
      kop: kop,
      opsAnalisisDetail: opsAnalisisDetail,
      opsKesimpulan: opsKesimpulan,
      opsCriticalErrorData: opsCriticalErrorData,
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}
