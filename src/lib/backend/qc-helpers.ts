// ============================================================
// qc-helpers.ts — Shared helpers for dashboard/graph/reports
//
// Provides fetchInputQCRows: GAS-compatible InputQC fetcher that returns
// rows in the original code.gs API shape (qcID, paramID, lotID, parameter,
// noLot, namaAlat, tanggal YYYY-MM-DD, level1/2/3, inputBy, inputDate,
// validated, validatedBy, validatedDate, catatanValidasi, owner).
//
// This is a private helper used by PORT-CHUNK5 modules to keep their
// 1:1 ports of code.gs simple. The canonical inputqc.ts (PORT-CHUNK3)
// returns a slightly different shape (qcid lowercase), so we keep
// this local copy to avoid breaking the GAS API contract used by
// dashboard/graph/reports.
// ============================================================

import { db } from "@/lib/db";
import type { SessionData } from "@/lib/session";
import { parseDateStr, fDT } from "@/lib/utils-server";

export async function fetchInputQCRows(
  ownerUsername: string,
  role: string,
  filter: any
): Promise<any[]> {
  try {
    filter = filter || {};
    const where: any = {};
    where.ownerUsername = ownerUsername;
    if (filter.paramID) where.paramID = String(filter.paramID);
    if (filter.lotID) where.lotID = String(filter.lotID);
    if (filter.paramIDs && filter.paramIDs.length)
      where.paramID = { in: filter.paramIDs.map(String) };
    if (filter.namaAlat)
      where.namaAlat = { contains: String(filter.namaAlat) };

    // Build param bidang map if filter.bidang is set
    let bidangParamIDs: string[] | null = null;
    if (filter.bidang) {
      // FIX v9.19: always scope by ownerUsername (tenant isolation)
      const params = await db.parameters.findMany({
        where: { ownerUsername },
      });
      bidangParamIDs = params
        .filter((p) => (p.bidang || "Lainnya") === filter.bidang)
        .map((p) => p.id);
    }

    const rows = await db.inputQC.findMany({
      where,
      orderBy: { tanggal: "asc" },
    });

    let mapped = rows.map((r) => ({
      qcID: r.id,
      paramID: r.paramID,
      lotID: r.lotID,
      parameter: r.parameter,
      noLot: r.noLot,
      namaAlat: r.namaAlat,
      tanggal: r.tanggal, // already YYYY-MM-DD string
      level1: r.level1,
      level2: r.level2,
      level3: r.level3,
      inputBy: r.inputBy,
      inputDate: fDT(r.inputDate),
      validated: !!r.validated,
      validatedBy: r.validatedBy,
      validatedDate: fDT(r.validatedDate),
      catatanValidasi: r.catatanValidasi,
      owner: r.ownerUsername,
    }));

    if (filter.startDate) {
      const sd = parseDateStr(filter.startDate);
      mapped = mapped.filter((q) => {
        const d = parseDateStr(q.tanggal);
        return d && sd && d >= sd;
      });
    }
    if (filter.endDate) {
      const ed = parseDateStr(filter.endDate);
      mapped = mapped.filter((q) => {
        const d = parseDateStr(q.tanggal);
        return d && ed && d <= ed;
      });
    }
    if (bidangParamIDs) {
      mapped = mapped.filter((q) => bidangParamIDs!.indexOf(q.paramID) > -1);
    }
    return mapped;
  } catch (e) {
    return [];
  }
}
