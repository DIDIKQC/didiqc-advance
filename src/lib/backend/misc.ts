// ============================================================
// Misc backend module — Log Activity, Catatan, Filter option lists
// Port dari code.gs
//
// Fungsi yang dipublikasikan:
// - getLogActivity, clearLogActivity
// - getCatatanLaporan, saveCatatanLaporan
// - getCatatanTabulasi, saveCatatanTabulasi
// - getCatatanDokter, saveCatatanDokter
// - getSiklusPMEList, getTahunSiklusList
// - getPeriodeCalcStatsList, getPeriodeSigmaCVOptList
// ============================================================

import { db } from "@/lib/db";
import {
  genID,
  logA,
  ownerMatch,
  fD,
  fDT,
  nowISO,
  dateToISO,
  isSameDay,
  withLock,
} from "@/lib/utils-server";
import type { SessionData } from "@/lib/session";

// ============================================================
// LOG ACTIVITY — only today's entries (cap 500, reversed)
// ============================================================
export async function getLogActivity(args: any[], _session: SessionData | null) {
  const [ownerUsername, role] = args as [string, string];
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rows =
      role === "superadmin"
        ? await db.logActivity.findMany({
            where: { timestamp: { gte: today } },
            orderBy: { timestamp: "asc" },
            take: 500,
          })
        : await db.logActivity.findMany({
            where: {
              timestamp: { gte: today },
              username: String(ownerUsername).toLowerCase(),
            },
            orderBy: { timestamp: "asc" },
            take: 500,
          });

    // Filter to same-day (defensive — gte today is enough, but be safe)
    const filtered = rows.filter((r) => isSameDay(r.timestamp, today));
    // Reverse so newest first
    filtered.reverse();

    return filtered.map((r) => ({
      timestamp: fDT(r.timestamp),
      username: r.username,
      action: r.action,
      detail: r.detail,
    }));
  } catch (e) {
    return [];
  }
}

// clearLogActivity — superadmin wipes all, others wipe own rows
export async function clearLogActivity(args: any[], _session: SessionData | null) {
  const [ownerUsername, role] = args as [string, string];
  try {
    return await withLock("clearLogActivity", async () => {
      if (role === "superadmin") {
        await db.logActivity.deleteMany({});
      } else {
        await db.logActivity.deleteMany({
          where: { username: String(ownerUsername).toLowerCase() },
        });
      }
      return { ok: true };
    });
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// CATATAN LAPORAN
// ============================================================

// getCatatanLaporan — returns rows for owner, optionally filtered by filterKey
export async function getCatatanLaporan(
  args: any[],
  _session: SessionData | null
) {
  const [ownerUsername, filterKey] = args as [string, string?];
  try {
    const where: any = { ownerUsername: String(ownerUsername).toLowerCase() };
    if (filterKey) where.filterKey = filterKey;
    const rows = await db.laporanCatatan.findMany({ where });
    return rows.map((r) => ({
      catatanID: r.id,
      filterKey: r.filterKey,
      bulanTahun: r.bulanTahun || "",
      paramID: r.paramID || "",
      lotID: r.lotID || "",
      namaAlat: r.namaAlat || "",
      catatan: r.catatan || "",
      owner: r.ownerUsername,
    }));
  } catch (e) {
    return [];
  }
}

// saveCatatanLaporan — upsert by filterKey+paramID+lotID+owner
export async function saveCatatanLaporan(
  args: any[],
  _session: SessionData | null
) {
  const [payload, ownerUsername, logUser] = args as [any, string, string?];
  try {
    return await withLock("saveCatatanLaporan", async () => {
      const owner = String(ownerUsername).toLowerCase();
      const existing = await db.laporanCatatan.findFirst({
        where: {
          filterKey: payload.filterKey || "",
          paramID: payload.paramID || "",
          lotID: payload.lotID || "",
          ownerUsername: owner,
        },
      });
      if (existing) {
        await db.laporanCatatan.update({
          where: { id: existing.id },
          data: { catatan: payload.catatan || "" },
        });
        return { ok: true };
      }
      await db.laporanCatatan.create({
        data: {
          id: genID("CAT"),
          filterKey: payload.filterKey || "",
          bulanTahun: payload.bulanTahun || null,
          paramID: payload.paramID || null,
          lotID: payload.lotID || null,
          namaAlat: payload.namaAlat || null,
          catatan: payload.catatan || null,
          ownerUsername: owner,
        },
      });
      return { ok: true };
    });
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// CATATAN TABULASI
// ============================================================

// getCatatanTabulasi — single row by periodKey
export async function getCatatanTabulasi(
  args: any[],
  _session: SessionData | null
) {
  const periodKey = args[0];
  try {
    if (!periodKey) return null;
    const row = await db.tabulasiCatatan.findUnique({
      where: { periodKey: String(periodKey) },
    });
    if (!row) return null;
    return {
      catatan: row.catatan,
      by: row.by,
      createdDate: fDT(row.createdDate),
    };
  } catch (e) {
    return null;
  }
}

// saveCatatanTabulasi — upsert by periodKey
export async function saveCatatanTabulasi(
  args: any[],
  _session: SessionData | null
) {
  const [periodKey, catatan, username, logUser] = args as [
    string,
    string,
    string?,
    string?
  ];
  try {
    return await withLock("saveCatatanTabulasi", async () => {
      await db.tabulasiCatatan.upsert({
        where: { periodKey: String(periodKey) },
        update: {
          catatan: catatan || null,
          by: username || null,
          createdDate: new Date(),
        },
        create: {
          periodKey: String(periodKey),
          catatan: catatan || null,
          by: username || null,
        },
      });
      return { ok: true };
    });
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// CATATAN DOKTER (v9.6)
// ============================================================

// getCatatanDokter — filtered by owner + optional filterKey
export async function getCatatanDokter(
  args: any[],
  _session: SessionData | null
) {
  const [ownerUsername, filterKey] = args as [string, string?];
  try {
    const where: any = { ownerUsername: String(ownerUsername).toLowerCase() };
    if (filterKey) where.filterKey = filterKey;
    const rows = await db.catatanDokter.findMany({ where });
    return rows.map((r) => ({
      catatanID: r.id,
      filterKey: r.filterKey,
      bidang: r.bidang || "",
      paramID: r.paramID || "",
      lotID: r.lotID || "",
      catatan: r.catatan || "",
      owner: r.ownerUsername,
      createdDate: fDT(r.createdDate),
    }));
  } catch (e) {
    return [];
  }
}

// saveCatatanDokter — upsert by filterKey+owner
export async function saveCatatanDokter(
  args: any[],
  _session: SessionData | null
) {
  const [payload, ownerUsername] = args as [any, string];
  try {
    return await withLock("saveCatatanDokter", async () => {
      const owner = String(ownerUsername).toLowerCase();
      const filterKey =
        payload.filterKey ||
        `${payload.bidang || ""}_${payload.paramID || ""}_${
          payload.lotID || ""
        }`;
      const existing = await db.catatanDokter.findFirst({
        where: { filterKey, ownerUsername: owner },
      });
      if (existing) {
        await db.catatanDokter.update({
          where: { id: existing.id },
          data: { catatan: payload.catatan || "" },
        });
        return { ok: true };
      }
      await db.catatanDokter.create({
        data: {
          id: genID("CD"),
          filterKey,
          bidang: payload.bidang || null,
          paramID: payload.paramID || null,
          lotID: payload.lotID || null,
          catatan: payload.catatan || null,
          ownerUsername: owner,
        },
      });
      return { ok: true };
    });
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// FILTER OPTION LISTS
// ============================================================

// getSiklusPMEList — unique siklus from BiasPME, sorted asc
export async function getSiklusPMEList(args: any[], _session: SessionData | null) {
  const [ownerUsername, role] = args as [string, string];
  try {
    const rows =
      role === "superadmin"
        ? await db.biasPME.findMany({ select: { siklus: true, ownerUsername: true } })
        : await db.biasPME.findMany({
            where: { ownerUsername: String(ownerUsername).toLowerCase() },
            select: { siklus: true, ownerUsername: true },
          });
    const set = new Set<string>();
    for (const r of rows) {
      if (r.siklus) set.add(String(r.siklus));
    }
    return Array.from(set).sort();
  } catch (e) {
    return [];
  }
}

// getTahunSiklusList — unique tahun from BiasPME, sorted desc
export async function getTahunSiklusList(
  args: any[],
  _session: SessionData | null
) {
  const [ownerUsername, role] = args as [string, string];
  try {
    const rows =
      role === "superadmin"
        ? await db.biasPME.findMany({ select: { tahun: true, ownerUsername: true } })
        : await db.biasPME.findMany({
            where: { ownerUsername: String(ownerUsername).toLowerCase() },
            select: { tahun: true, ownerUsername: true },
          });
    const set = new Set<string>();
    for (const r of rows) {
      if (r.tahun) set.add(String(r.tahun));
    }
    return Array.from(set).sort().reverse();
  } catch (e) {
    return [];
  }
}

// getPeriodeCalcStatsList — unique {start, end} periods from CalculatedStats
export async function getPeriodeCalcStatsList(
  args: any[],
  _session: SessionData | null
) {
  const [ownerUsername, role] = args as [string, string];
  try {
    const rows =
      role === "superadmin"
        ? await db.calculatedStats.findMany({
            select: { startDate: true, endDate: true, ownerUsername: true },
          })
        : await db.calculatedStats.findMany({
            where: { ownerUsername: String(ownerUsername).toLowerCase() },
            select: { startDate: true, endDate: true, ownerUsername: true },
          });
    const map: Record<string, { start: string; end: string }> = {};
    for (const r of rows) {
      if (r.startDate && r.endDate) {
        const start = dateToISO(r.startDate);
        const end = dateToISO(r.endDate);
        if (!start || !end) continue;
        const key = `${start}|${end}`;
        if (!map[key]) map[key] = { start, end };
      }
    }
    return Object.values(map);
  } catch (e) {
    return [];
  }
}

// getPeriodeSigmaCVOptList — unique {start, end} periods from SigmaCVOpt
export async function getPeriodeSigmaCVOptList(
  args: any[],
  _session: SessionData | null
) {
  const [ownerUsername, role] = args as [string, string];
  try {
    const rows =
      role === "superadmin"
        ? await db.sigmaCVOpt.findMany({
            select: { startDate: true, endDate: true, ownerUsername: true },
          })
        : await db.sigmaCVOpt.findMany({
            where: { ownerUsername: String(ownerUsername).toLowerCase() },
            select: { startDate: true, endDate: true, ownerUsername: true },
          });
    const map: Record<string, { start: string; end: string }> = {};
    for (const r of rows) {
      if (r.startDate && r.endDate) {
        const start = dateToISO(r.startDate);
        const end = dateToISO(r.endDate);
        if (!start || !end) continue;
        const key = `${start}|${end}`;
        if (!map[key]) map[key] = { start, end };
      }
    }
    return Object.values(map);
  } catch (e) {
    return [];
  }
}
