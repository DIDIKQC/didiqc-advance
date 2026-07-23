// ============================================================
// dashboard.ts — Dashboard aggregate (port dari code.gs)
//
// Port 1:1 dari fungsi-fungsi dashboard di code.gs:
//   - getDashboardData(ownerUsername, role)
//   - computeSigmaByBidang(ownerUsername, role, params, lots, allQC)
//   - computeCVBiasByBidang(ownerUsername, role, lots, allQC)
//   - computeMonthTrend(ownerUsername, role, lots, allQC, params)
//   - getDashboardDetailTrend(ownerUsername, role)
//   - getDashboardAnalisisTrend(ownerUsername, role, filter)
//
// Setiap fungsi menerima (args: any[], session: SessionData | null).
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
  getWestgardViolations30Days,
  computeSigmaForLevel,
} from "@/lib/backend/westgard";
import { fetchInputQCRows } from "@/lib/backend/qc-helpers";
import { getTrendAnalisisData } from "@/lib/backend/reports";

// ============================================================
// Helpers — derive owner/role dari args+session (mirror master-data.ts)
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
// getDashboardData — port 1:1 dari code.gs (lines 1603-1635)
// args[0]=ownerUsername, args[1]=role
// ============================================================
export async function getDashboardData(
  args: any[],
  session: SessionData | null
) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  try {
    const now = new Date();
    const todayStr = dateToISO(now);

    const whereP: any = role === "superadmin" ? {} : { ownerUsername: ownerUsername };
    const whereL: any = role === "superadmin" ? {} : { ownerUsername: ownerUsername };

    const [paramRows, lotRows] = await Promise.all([
      db.parameters.findMany({ where: whereP, orderBy: { parameter: "asc" } }),
      db.lotQC.findMany({ where: whereL, orderBy: { noLot: "asc" } }),
    ]);

    const params = paramRows.map((r) => ({
      paramID: r.id,
      parameter: r.parameter,
      owner: r.ownerUsername,
      bidang: r.bidang,
    }));
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

    const allQC = await fetchInputQCRows(ownerUsername, role, {});

    const todayQC = allQC.filter(function (q) {
      return q.tanggal === todayStr;
    });
    const validated = allQC.filter(function (q) {
      return q.validated;
    });
    const pending = allQC.filter(function (q) {
      return !q.validated;
    });
    const expired = lots.filter(function (l) {
      if (!l.expiredDate) return false;
      const d = parseDateStr(l.expiredDate);
      return d && d < now;
    });
    const d30 = new Date(now.getTime() + 30 * 86400000);
    const nearExpiry = lots.filter(function (l) {
      if (!l.expiredDate) return false;
      const d = parseDateStr(l.expiredDate);
      return d && d >= now && d <= d30;
    });

    const wgViolations = await getWestgardViolations30Days(
      [ownerUsername, role],
      session
    );
    const sigmaByBidang = computeSigmaByBidangInternal(params, lots, allQC);
    const cvBiasByBidang = computeCVBiasByBidangInternal(lots, allQC, params);
    const trendDetail = computeMonthTrendInternal(lots, allQC, params);

    const d7 = new Date(now.getTime() - 7 * 86400000);
    const d30b = new Date(now.getTime() - 30 * 86400000);
    const weeklyQC = allQC.filter(function (q) {
      const d = parseDateStr(q.tanggal);
      return d && d >= d7;
    }).length;
    const monthlyQC = allQC.filter(function (q) {
      const d = parseDateStr(q.tanggal);
      return d && d >= d30b;
    }).length;

    return {
      ok: true,
      stats: {
        totalParam: params.length,
        totalLot: lots.length,
        totalQC: allQC.length,
        todayQC: todayQC.length,
        validated: validated.length,
        pending: pending.length,
        expired: expired.length,
        nearExpiry: nearExpiry.length,
      },
      wgViolations: wgViolations,
      sigmaByBidang: sigmaByBidang,
      cvBiasByBidang: cvBiasByBidang,
      trendDetail: trendDetail,
      weeklyQC: weeklyQC,
      monthlyQC: monthlyQC,
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ============================================================
// computeSigmaByBidang — port 1:1 dari code.gs (lines 1636-1660)
// args[0]=ownerUsername, args[1]=role
// (public export — re-fetches params/lots/qc)
// ============================================================
export async function computeSigmaByBidang(
  args: any[],
  session: SessionData | null
) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  const where: any = role === "superadmin" ? {} : { ownerUsername };
  const [paramRows, lotRows] = await Promise.all([
    db.parameters.findMany({ where, orderBy: { parameter: "asc" } }),
    db.lotQC.findMany({ where, orderBy: { noLot: "asc" } }),
  ]);
  const params = paramRows.map((r) => ({
    paramID: r.id,
    parameter: r.parameter,
    bidang: r.bidang,
  }));
  const lots = lotRows.map((r) => ({
    lotID: r.id,
    paramID: r.paramID,
    noLot: r.noLot,
    tea: r.tea,
    meanL1: r.meanL1,
    sdL1: r.sdL1,
    meanL2: r.meanL2,
    sdL2: r.sdL2,
    meanL3: r.meanL3,
    sdL3: r.sdL3,
  }));
  const allQC = await fetchInputQCRows(ownerUsername, role, {});
  return computeSigmaByBidangInternal(params, lots, allQC);
}

// Internal implementation matching GAS exactly (operates on already-loaded arrays)
// FIX: Include ALL bidang from params (even if no lots/QC data yet) so they
// appear in the dashboard charts with null values. Sebelumnya hanya iterate
// over lots, sehingga bidang tanpa lots (mis. Hematologi) tidak muncul.
function computeSigmaByBidangInternal(
  params: any[],
  lots: any[],
  allQC: any[]
): Record<string, any> {
  const paramBidang: Record<string, string> = {};
  // Collect all distinct bidang from params FIRST (so bidang with 0 lots appear)
  const allBidang = new Set<string>();
  params.forEach(function (p) {
    const b = p.bidang || "Lainnya";
    paramBidang[p.paramID] = b;
    allBidang.add(b);
  });

  const bidangData: Record<string, any> = {};
  // Initialize all bidang with empty arrays (so they appear even without lots)
  allBidang.forEach(function (b) {
    bidangData[b] = { sigL1: [], sigL2: [], sigL3: [] };
  });

  lots.forEach(function (lot) {
    const bidang = paramBidang[lot.paramID] || "Lainnya";
    if (!bidangData[bidang])
      bidangData[bidang] = { sigL1: [], sigL2: [], sigL3: [] };
    const lotQCs = allQC.filter(function (q) {
      return q.lotID === lot.lotID;
    });
    [1, 2, 3].forEach(function (lv) {
      const sigma = computeSigmaForLevel(lot, "L" + lv, lotQCs);
      if (sigma !== null) bidangData[bidang]["sigL" + lv].push(sigma);
    });
  });

  // Build result for ALL bidang (sorted alphabetically for consistent display)
  const result: Record<string, any> = {};
  const sortedBidang = Array.from(allBidang).sort();
  sortedBidang.forEach(function (b) {
    result[b] = {};
    [1, 2, 3].forEach(function (lv) {
      const arr = bidangData[b]["sigL" + lv];
      result[b]["sigL" + lv] = arr.length
        ? parseFloat(
            (
              arr.reduce(function (a, c) {
                return a + c;
              }, 0) / arr.length
            ).toFixed(2)
          )
        : null;
    });
  });
  return result;
}

// ============================================================
// computeCVBiasByBidang — port 1:1 dari code.gs (lines 1661-1684)
// args[0]=ownerUsername, args[1]=role
// ============================================================
export async function computeCVBiasByBidang(
  args: any[],
  session: SessionData | null
) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  const where: any = role === "superadmin" ? {} : { ownerUsername };
  const [paramRows, lotRows] = await Promise.all([
    db.parameters.findMany({ where }),
    db.lotQC.findMany({ where, orderBy: { noLot: "asc" } }),
  ]);
  const params = paramRows.map((r) => ({
    paramID: r.id,
    parameter: r.parameter,
    bidang: r.bidang,
  }));
  const lots = lotRows.map((r) => ({
    lotID: r.id,
    paramID: r.paramID,
    noLot: r.noLot,
    meanL1: r.meanL1,
    sdL1: r.sdL1,
    biasPct: r.biasPct,
    tea: r.tea,
  }));
  const allQC: any[] = []; // not strictly used by computeCVBiasByBidang in GAS
  return computeCVBiasByBidangInternal(lots, allQC, params);
}

function computeCVBiasByBidangInternal(
  lots: any[],
  _allQC: any[],
  params: any[]
): Record<string, any> {
  const paramBidang: Record<string, string> = {};
  // Collect all distinct bidang from params FIRST (so bidang with 0 lots appear)
  const allBidang = new Set<string>();
  params.forEach(function (p) {
    const b = p.bidang || "Lainnya";
    paramBidang[p.paramID] = b;
    allBidang.add(b);
  });

  const bidangData: Record<string, any> = {};
  // Initialize all bidang with empty arrays (so they appear even without lots)
  allBidang.forEach(function (b) {
    bidangData[b] = { cvs: [], biases: [] };
  });

  lots.forEach(function (lot) {
    const bidang = paramBidang[lot.paramID] || "Lainnya";
    if (!bidangData[bidang])
      bidangData[bidang] = { cvs: [], biases: [] };
    const m1 = parseNumSafe(lot.meanL1);
    const s1 = parseNumSafe(lot.sdL1);
    if (m1 && s1) bidangData[bidang].cvs.push((s1 / m1) * 100);
    const bias = parseNumSafe(lot.biasPct);
    if (bias !== null) bidangData[bidang].biases.push(Math.abs(bias));
  });

  // Build result for ALL bidang (sorted alphabetically for consistent display)
  const result: Record<string, any> = {};
  const sortedBidang = Array.from(allBidang).sort();
  sortedBidang.forEach(function (b) {
    const cvs = bidangData[b].cvs;
    const bias = bidangData[b].biases;
    result[b] = {
      avgCV: cvs.length
        ? parseFloat(
            (
              cvs.reduce(function (a, c) {
                return a + c;
              }, 0) / cvs.length
            ).toFixed(2)
          )
        : null,
      avgBias: bias.length
        ? parseFloat(
            (
              bias.reduce(function (a, c) {
                return a + c;
              }, 0) / bias.length
            ).toFixed(2)
          )
        : null,
    };
  });
  return result;
}

// ============================================================
// computeMonthTrend — port 1:1 dari code.gs (lines 1685-1737)
// args[0]=ownerUsername, args[1]=role
// ============================================================
export async function computeMonthTrend(
  args: any[],
  session: SessionData | null
) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  const where: any = role === "superadmin" ? {} : { ownerUsername };
  const [paramRows, lotRows] = await Promise.all([
    db.parameters.findMany({ where }),
    db.lotQC.findMany({ where, orderBy: { noLot: "asc" } }),
  ]);
  const params = paramRows.map((r) => ({
    paramID: r.id,
    parameter: r.parameter,
    bidang: r.bidang,
  }));
  const lots = lotRows.map((r) => ({
    lotID: r.id,
    paramID: r.paramID,
    noLot: r.noLot,
    namaAlat: r.namaAlat,
    tea: r.tea,
    meanL1: r.meanL1,
    sdL1: r.sdL1,
    meanL2: r.meanL2,
    sdL2: r.sdL2,
    meanL3: r.meanL3,
    sdL3: r.sdL3,
  }));
  const allQC = await fetchInputQCRows(ownerUsername, role, {});
  return computeMonthTrendInternal(lots, allQC, params);
}

function computeMonthTrendInternal(
  lots: any[],
  allQC: any[],
  params: any[]
): Record<string, any[]> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lotMap: Record<string, any> = {};
  const paramMap: Record<string, any> = {};
  const paramBidang: Record<string, string> = {};
  lots.forEach(function (l) {
    lotMap[l.lotID] = l;
  });
  params.forEach(function (p) {
    paramMap[p.paramID] = p;
    paramBidang[p.paramID] = p.bidang || "Lainnya";
  });
  const monthQC = allQC.filter(function (q) {
    const d = parseDateStr(q.tanggal);
    return d && d >= startOfMonth && d <= now;
  });
  const byParam: Record<string, any[]> = {};
  monthQC.forEach(function (q) {
    if (!byParam[q.paramID]) byParam[q.paramID] = [];
    byParam[q.paramID].push(q);
  });
  const result: Record<string, any[]> = {};
  Object.keys(byParam).forEach(function (paramID) {
    const qcs = byParam[paramID].sort(function (a, b) {
      return (
        new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime()
      );
    });
    const param = paramMap[paramID];
    const bidang = paramBidang[paramID] || "Lainnya";
    if (!result[bidang]) result[bidang] = [];
    const lotGroups: Record<string, any[]> = {};
    qcs.forEach(function (q) {
      if (!lotGroups[q.lotID]) lotGroups[q.lotID] = [];
      lotGroups[q.lotID].push(q);
    });
    Object.keys(lotGroups).forEach(function (lotID) {
      const lot = lotMap[lotID];
      if (!lot) return;
      const lqcs = lotGroups[lotID];
      const summary: any = {
        paramID: paramID,
        parameter: param ? param.parameter : "",
        namaAlat: lot.namaAlat,
        noLot: lot.noLot,
        levels: {},
      };
      [1, 2, 3].forEach(function (lv) {
        const m = parseNumSafe(lot["meanL" + lv]);
        const s = parseNumSafe(lot["sdL" + lv]);
        const tea = parseNumSafe(lot.tea);
        const vals = lqcs
          .map(function (q) {
            return parseNumSafe(
              lv === 1 ? q.level1 : lv === 2 ? q.level2 : q.level3
            );
          })
          .filter(function (v): v is number { return v !== null && v !== 0; });
        if (!vals.length || !m || !tea) {
          summary.levels["L" + lv] = null;
          return;
        }
        const calcMean =
          vals.reduce(function (a, b) {
            return a + b;
          }, 0) / vals.length;
        const calcSD =
          vals.length > 1
            ? Math.sqrt(
                vals.reduce(function (s2, v) {
                  return s2 + Math.pow(v - calcMean, 2);
                }, 0) / vals.length
              )
            : 0;
        const cv = calcMean ? (calcSD / calcMean) * 100 : 0;
        const bias = m ? ((calcMean - m) / m) * 100 : 0;
        const te = Math.abs(bias) + 1.65 * cv;
        const sigma = tea && cv ? (tea - Math.abs(bias)) / cv : null;
        let wg = checkWestgardRules(vals, calcMean, calcSD);
        wg = filterViolationsBySigma(wg, sigma);
        const realViols = wg.filter(function (v) {
          return !v.ignored && v.type === "rejection";
        }).length;
        summary.levels["L" + lv] = {
          n: vals.length,
          calcMean: parseFloat(calcMean.toFixed(3)),
          cv: parseFloat(cv.toFixed(2)),
          bias: parseFloat(bias.toFixed(2)),
          te: parseFloat(te.toFixed(2)),
          sigma: sigma ? parseFloat(sigma.toFixed(2)) : null,
          tea: tea,
          violations: realViols,
        };
      });
      result[bidang].push(summary);
    });
  });
  return result;
}

// ============================================================
// getDashboardDetailTrend — port 1:1 dari code.gs (lines 3575-3578)
// args[0]=ownerUsername, args[1]=role
// Wraps getDashboardAnalisisTrend with { months: 6 }.
// ============================================================
export async function getDashboardDetailTrend(
  args: any[],
  session: SessionData | null
) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  try {
    return await getDashboardAnalisisTrend(
      [ownerUsername, role, { months: 6 }],
      session
    );
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ============================================================
// getDashboardAnalisisTrend — port 1:1 dari code.gs (lines 2564-2569)
// args[0]=ownerUsername, args[1]=role, args[2]=filter
// NOTE: original code forwards ONLY filter.paramID and filter.months
// (NOT bidang/lotID/tahun/etc.). Match this quirk exactly.
// ============================================================
export async function getDashboardAnalisisTrend(
  args: any[],
  session: SessionData | null
) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  const filter = args[2] || {};
  return getTrendAnalisisData(
    [
      {
        paramID: filter && filter.paramID ? filter.paramID : null,
        months: filter && filter.months ? filter.months : 6,
      },
      ownerUsername,
      role,
    ],
    session
  );
}
