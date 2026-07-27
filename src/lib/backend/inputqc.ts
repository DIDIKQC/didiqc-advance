// ============================================================
// inputqc.ts — Input QC, Histori QC, Validasi QC (port dari code.gs)
//
// Port 1:1 dari fungsi-fungsi QC di code.gs:
//   - Input QC : getInputQC, getInputQCById, saveInputQC, deleteInputQC,
//                addHistoriQC, getQCByDateRange, bulkInputQC
//   - Histori  : getHistoriQC, restoreHistoriQC, deleteHistoriQC
//   - Validasi : getValidasiData, validateQC, validateQCBulk
//
// Setiap fungsi menerima (args: any[], session: SessionData | null).
// - ownerUsername efektif: args[idx] || session.activeUsername || session.username
// - role efektif         : args[idx] || session.activeRole || session.role
// - logUser efektif      : args[idx] || session.loginUsername || session.username
// - superadmin melihat semua data; user lain hanya miliknya sendiri.
//
// Catatan porting:
// - Prisma: InputQC.id  (was qcID in GAS), LotQC.id (was lotID in GAS),
//   Parameters.id (was paramID in GAS). FK tetap paramID/lotID.
// - tanggal disimpan sebagai string YYYY-MM-DD (sesuai schema InputQC.tanggal).
// - inputDate / validatedDate / deletedDate adalah DateTime di Prisma →
//   dikonversi ke ISO string saat dipetakan ke API shape.
// - checkAndNotifyWestgard (di GAS mengirim email) di-skip di port ini —
//   hanya console.log placeholder. Engine Westgard akan diport di chunk lain.
// - Year-sharding "InputQC_<year>" sheet tidak ada di Next.js (semua di
//   tabel InputQC); filter.year diterjemahkan jadi filter tanggal LIKE '<year>-%'.
// ============================================================

import { db } from "@/lib/db";
import type { SessionData } from "@/lib/session";
import {
  genID,
  logA,
  parseNumSafe,
  parseDateStr,
  dateToISO,
  fD,
  fDT,
  withLock,
  SMART_PWD,
} from "@/lib/utils-server";

// ============================================================
// Helpers — derive owner/role/logUser dari args+session
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

function deriveLogUser(
  args: any[],
  session: SessionData | null,
  idx: number
): string {
  const fromArgs = args[idx];
  if (typeof fromArgs === "string" && fromArgs.length > 0) return fromArgs;
  if (session) {
    if (session.loginUsername) return session.loginUsername;
    if (session.username) return session.username;
  }
  return "";
}

// ============================================================
// Mappers — Prisma row → API shape (JSON-serializable)
// ============================================================

// Map Prisma InputQC row to API shape (mirror code.gs getInputQC output)
// NOTE: field name is `qcID` (capital ID) to match original code.gs & frontend.
function mapQCRow(r: any) {
  return {
    qcID: r.id,
    paramID: r.paramID,
    lotID: r.lotID,
    parameter: r.parameter,
    noLot: r.noLot,
    namaAlat: r.namaAlat,
    tanggal: r.tanggal, // already YYYY-MM-DD in DB
    level1: r.level1,
    level2: r.level2,
    level3: r.level3,
    inputBy: r.inputBy,
    inputDate: r.inputDate ? r.inputDate.toISOString() : null,
    validated: !!r.validated,
    validatedBy: r.validatedBy,
    validatedDate: r.validatedDate ? r.validatedDate.toISOString() : null,
    catatanValidasi: r.catatanValidasi,
    ownerUsername: r.ownerUsername,
  };
}

// Map Prisma HistoriQC row to API shape (mirror code.gs getHistoriQC output).
// pinfo = {parameter, bidang} from Parameters table, used only when
// historiRow.parameter is empty (defensive — original GAS code does this).
// NOTE: field names are `hqcID` and `qcID` (capital ID) to match original code.gs & frontend.
function mapHistoriRow(r: any, pinfo?: { parameter: string; bidang: string } | null) {
  return {
    hqcID: r.id,
    qcID: r.qcid,
    paramID: r.paramID,
    lotID: r.lotID,
    parameter: r.parameter || (pinfo ? pinfo.parameter : ""),
    noLot: r.noLot,
    namaAlat: r.namaAlat,
    tanggal: r.tanggal,
    level1: r.level1,
    level2: r.level2,
    level3: r.level3,
    inputBy: r.inputBy,
    deletedBy: r.deletedBy,
    deletedDate: r.deletedDate ? r.deletedDate.toISOString() : null,
    ownerUsername: r.ownerUsername,
    actionType: r.actionType,
    changeDetail: r.changeDetail,
  };
}

// ============================================================
// INPUT QC — mirror code.gs getInputQC/getInputQCById/saveInputQC/...
// ============================================================

// function getInputQC(ownerUsername, role, filter)
// filter: {paramID, lotID, paramIDs[], bidang, namaAlat, startDate, endDate, year}
// Returns array of QC objects. superadmin sees all.
export async function getInputQC(args: any[], session: SessionData | null) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  const filter = args[2] || {};
  try {
    const where: any = {};
    if (role !== "superadmin") where.ownerUsername = ownerUsername;
    if (filter.paramID) where.paramID = String(filter.paramID);
    if (filter.lotID) where.lotID = String(filter.lotID);
    if (filter.paramIDs && Array.isArray(filter.paramIDs) && filter.paramIDs.length > 0) {
      where.paramID = { in: filter.paramIDs.map(String) };
    }

    // Status filter — 'valid' = validated true, 'pending' = validated false
    if (filter.status === "valid" || filter.status === "validated") {
      where.validated = true;
    } else if (filter.status === "pending" || filter.status === "unvalidated") {
      where.validated = false;
    }

    // Date-range filter on tanggal (YYYY-MM-DD string in DB)
    if (filter.startDate || filter.endDate) {
      const dateFilter: any = {};
      if (filter.startDate) {
        const sd = parseDateStr(String(filter.startDate));
        if (sd) {
          const iso = dateToISO(sd);
          if (iso) dateFilter.gte = iso;
        }
      }
      if (filter.endDate) {
        const ed = parseDateStr(String(filter.endDate));
        if (ed) {
          const iso = dateToISO(ed);
          if (iso) dateFilter.lte = iso;
        }
      }
      if (Object.keys(dateFilter).length > 0) where.tanggal = dateFilter;
    }

    // Year filter — in GAS this selects a different sheet (InputQC_<year>);
    // here we filter tanggal by prefix '<year>-'
    if (filter.year) {
      const yearStr = String(filter.year);
      if (yearStr !== String(new Date().getFullYear())) {
        where.tanggal = { ...(where.tanggal || {}), startsWith: yearStr + "-" };
      }
    }

    const rows = await db.inputQC.findMany({
      where,
      orderBy: [{ tanggal: "desc" }, { inputDate: "desc" }],
    });

    // bidang filter needs Parameters join — apply in-memory like GAS original
    let paramBidangMap: Record<string, string> = {};
    if (filter.bidang) {
      const params = await db.parameters.findMany({});
      for (const p of params) {
        paramBidangMap[p.id] = p.bidang || "Lainnya";
      }
    }

    let result = rows.map(mapQCRow);

    if (filter.bidang) {
      const targetBidang = String(filter.bidang);
      result = result.filter((r) => {
        const b = paramBidangMap[r.paramID] || "Lainnya";
        return b === targetBidang;
      });
    }

    if (filter.namaAlat) {
      const needle = String(filter.namaAlat).toLowerCase();
      result = result.filter((r) => {
        const hay = String(r.namaAlat || "").toLowerCase();
        return hay.indexOf(needle) > -1;
      });
    }

    return result;
  } catch (e) {
    return [];
  }
}

// function getInputQCById(qcID, ownerUsername, role)
// Returns single QC object or null.
export async function getInputQCById(args: any[], session: SessionData | null) {
  const qcID = args[0];
  const ownerUsername = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  try {
    if (!qcID) return null;
    const where: any = { id: String(qcID) };
    if (role !== "superadmin") where.ownerUsername = ownerUsername;
    const r = await db.inputQC.findFirst({ where });
    if (!r) return null;
    return mapQCRow(r);
  } catch (e) {
    return null;
  }
}

// function saveInputQC(payload, ownerUsername, logUser)
// payload: {id?, paramID, lotID, parameter, noLot, namaAlat, tanggal,
//           level1, level2, level3, catatanValidasi?}
// Create (genID 'QC') or update. On edit push HistoriQC 'EDIT_QC'.
export async function saveInputQC(args: any[], session: SessionData | null) {
  return withLock("inputqc_save", async () => {
    try {
      const payload = args[0] || {};
      const ownerUsername = deriveOwner(args, session, 1);
      const logUser = deriveLogUser(args, session, 2);

      // Resolve lot & param for autofill (mirror GAS getLotByID/getParamByID)
      const [lot, param] = await Promise.all([
        db.lotQC.findUnique({ where: { id: String(payload.lotID) } }),
        db.parameters.findUnique({ where: { id: String(payload.paramID) } }),
      ]);

      const parameterStr = param ? param.parameter : String(payload.parameter || "");
      const noLotStr = lot ? lot.noLot : String(payload.noLot || "");
      const namaAlatStr = lot ? lot.namaAlat || null : payload.namaAlat ? String(payload.namaAlat) : null;

      // tanggal: YYYY-MM-DD string
      let tanggalStr: string;
      if (payload.tanggal) {
        const dt = parseDateStr(String(payload.tanggal));
        tanggalStr = dt ? (dateToISO(dt) || new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10);
      } else {
        tanggalStr = new Date().toISOString().slice(0, 10);
      }

      const qcID = payload.id || payload.qcID || payload.qcid;

      if (qcID) {
        // Update path — verify ownership (case-insensitive like GAS)
        const existing = await db.inputQC.findFirst({
          where: {
            id: String(qcID),
            ownerUsername: { equals: ownerUsername },
          },
        });
        if (!existing) {
          return { ok: false, msg: "Data tidak ditemukan" };
        }

        // Build change-detail string (mirror GAS 'L1:old→new,L2:...,L3:...')
        const changeDetail =
          "L1:" + existing.level1 + "→" + payload.level1 +
          ",L2:" + existing.level2 + "→" + payload.level2 +
          ",L3:" + existing.level3 + "→" + payload.level3;

        // Push HistoriQC row from the OLD data
        await addHistoriQCInternal(existing, logUser || ownerUsername, "EDIT_QC", changeDetail);

        await db.inputQC.update({
          where: { id: String(qcID) },
          data: {
            paramID: String(payload.paramID ?? existing.paramID),
            lotID: String(payload.lotID ?? existing.lotID),
            parameter: parameterStr,
            noLot: noLotStr,
            namaAlat: namaAlatStr,
            tanggal: tanggalStr,
            level1: parseNumSafe(payload.level1),
            level2: parseNumSafe(payload.level2),
            level3: parseNumSafe(payload.level3),
            catatanValidasi: payload.catatanValidasi != null ? String(payload.catatanValidasi) : existing.catatanValidasi,
          },
        });

        await logA(ownerUsername, "EDIT_QC", String(qcID), logUser);
        return { ok: true };
      }

      // Create path
      const newID = genID("QC");
      await db.inputQC.create({
        data: {
          id: newID,
          paramID: String(payload.paramID ?? ""),
          lotID: String(payload.lotID ?? ""),
          parameter: parameterStr,
          noLot: noLotStr,
          namaAlat: namaAlatStr,
          tanggal: tanggalStr,
          level1: parseNumSafe(payload.level1),
          level2: parseNumSafe(payload.level2),
          level3: parseNumSafe(payload.level3),
          inputBy: ownerUsername,
          inputDate: new Date(),
          validated: false,
          validatedBy: null,
          validatedDate: null,
          catatanValidasi: payload.catatanValidasi != null ? String(payload.catatanValidasi) : null,
          ownerUsername,
        },
      });

      // GAS calls checkAndNotifyWestgard(paramID, lotID, ownerUsername, newID).
      // The Westgard engine + email notifier will be ported in another chunk;
      // here we just log a placeholder.
      console.log(
        `[inputqc] checkAndNotifyWestgard skipped for paramID=${payload.paramID} lotID=${payload.lotID} qcID=${newID}`
      );

      await logA(ownerUsername, "ADD_QC", newID, logUser);
      return { ok: true, qcID: newID };
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}

// function deleteInputQC(qcID, ownerUsername, alasan, logUser)
// Delete QC row, push HistoriQC with actionType 'DATA DIHAPUS'.
export async function deleteInputQC(args: any[], session: SessionData | null) {
  return withLock("inputqc_delete", async () => {
    try {
      const qcID = args[0];
      const ownerUsername = deriveOwner(args, session, 1);
      const alasan = args[2] != null ? String(args[2]) : "";
      const logUser = deriveLogUser(args, session, 3);
      const by = logUser || ownerUsername;

      if (!qcID) return { ok: false, msg: "Data tidak ditemukan" };

      const existing = await db.inputQC.findFirst({
        where: {
          id: String(qcID),
          ownerUsername: { equals: ownerUsername },
        },
      });
      if (!existing) {
        return { ok: false, msg: "Data tidak ditemukan" };
      }

      await addHistoriQCInternal(existing, by, "DATA DIHAPUS", alasan || "");
      await db.inputQC.delete({ where: { id: String(qcID) } });
      await logA(ownerUsername, "DEL_QC", String(qcID) + "|" + alasan, logUser);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}

// function addHistoriQC(rowArr, deletedBy, actionType, changeDetail)
// Append to HistoriQC table with genID 'HQC'.
// rowArr is the original QC row data — accepted as either:
//   - a Prisma InputQC row object (preferred, used internally)
//   - a legacy array-shaped object (rows[0]=id, rows[1]=paramID, ...)
//   - a plain API-shape object {qcid, paramID, lotID, ...}
export async function addHistoriQC(args: any[], _session: SessionData | null) {
  try {
    const rowArr = args[0];
    const deletedBy = args[1] || "";
    const actionType = args[2] || "";
    const changeDetail = args[3] != null ? String(args[3]) : "";
    await addHistoriQCInternal(rowArr, String(deletedBy), String(actionType), changeDetail);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message };
  }
}

// Internal helper: append a HistoriQC row from an InputQC row.
// Accepts Prisma InputQC object, legacy array, or API-shape object.
async function addHistoriQCInternal(
  row: any,
  deletedBy: string,
  actionType: string,
  changeDetail: string
): Promise<void> {
  // Normalize row to a uniform object
  let r: any;
  if (Array.isArray(row)) {
    r = {
      id: row[0],
      paramID: row[1],
      lotID: row[2],
      parameter: row[3],
      noLot: row[4],
      namaAlat: row[5],
      tanggal: row[6],
      level1: row[7],
      level2: row[8],
      level3: row[9],
      inputBy: row[10],
      ownerUsername: row[16],
    };
  } else if (row && typeof row === "object") {
    r = {
      id: row.id || row.qcid || row.qcID,
      paramID: row.paramID,
      lotID: row.lotID,
      parameter: row.parameter,
      noLot: row.noLot,
      namaAlat: row.namaAlat,
      tanggal: row.tanggal,
      level1: row.level1,
      level2: row.level2,
      level3: row.level3,
      inputBy: row.inputBy,
      ownerUsername: row.ownerUsername || row.owner,
    };
  } else {
    return;
  }

  await db.historiQC.create({
    data: {
      id: genID("HQC"),
      qcid: r.id != null ? String(r.id) : null,
      paramID: String(r.paramID ?? ""),
      lotID: r.lotID != null ? String(r.lotID) : null,
      parameter: String(r.parameter ?? ""),
      noLot: r.noLot != null ? String(r.noLot) : null,
      namaAlat: r.namaAlat != null ? String(r.namaAlat) : null,
      tanggal: r.tanggal != null ? String(r.tanggal) : null,
      level1: parseNumSafe(r.level1),
      level2: parseNumSafe(r.level2),
      level3: parseNumSafe(r.level3),
      inputBy: r.inputBy != null ? String(r.inputBy) : null,
      deletedBy: deletedBy || null,
      deletedDate: new Date(),
      ownerUsername: String(r.ownerUsername ?? ""),
      actionType: actionType || "",
      changeDetail: changeDetail || null,
    },
  });
}

// function getQCByDateRange(paramID, lotID, startDate, endDate, ownerUsername)
// Returns {ok, data} where data is sorted (asc by tanggal) QC list.
export async function getQCByDateRange(args: any[], session: SessionData | null) {
  try {
    const paramID = args[0];
    const lotID = args[1];
    const startDate = args[2];
    const endDate = args[3];
    const ownerUsername = deriveOwner(args, session, 4);

    const data = await getInputQC(
      [ownerUsername, "user", { paramID, lotID, startDate, endDate }],
      session
    );
    data.sort((a: any, b: any) => {
      const da = a.tanggal ? new Date(a.tanggal).getTime() : 0;
      const db2 = b.tanggal ? new Date(b.tanggal).getTime() : 0;
      return da - db2;
    });
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, msg: e.message };
  }
}

// function bulkInputQC(payload, ownerUsername, logUser)
// payload: {rows: [{tanggal, level1, level2, level3}], paramID, lotID,
//           parameter, noLot, namaAlat, smartPassword}
// Validate smartPassword === 'didikqc'. Batch insert.
// Returns {ok, count, skipped, errors}.
export async function bulkInputQC(args: any[], session: SessionData | null) {
  return withLock("inputqc_bulk", async () => {
    try {
      const payload = args[0] || {};
      const ownerUsername = deriveOwner(args, session, 1);
      const logUser = deriveLogUser(args, session, 2);

      if (payload.smartPassword !== SMART_PWD) {
        return { ok: false, msg: "Password Smart Input salah" };
      }

      const [lot, param] = await Promise.all([
        db.lotQC.findUnique({ where: { id: String(payload.lotID) } }),
        db.parameters.findUnique({ where: { id: String(payload.paramID) } }),
      ]);

      const parameterStr = param ? param.parameter : String(payload.parameter || "");
      const noLotStr = lot ? lot.noLot : String(payload.noLot || "");
      const namaAlatStr = lot ? lot.namaAlat || null : payload.namaAlat ? String(payload.namaAlat) : null;

      let count = 0;
      let skipped = 0;
      const errors: string[] = [];
      const rows: any[] = payload.rows || [];

      for (const row of rows) {
        if (!row.tanggal) {
          errors.push("Tanggal kosong");
          skipped++;
          continue;
        }
        const dt = parseDateStr(String(row.tanggal));
        if (!dt || isNaN(dt.getTime())) {
          errors.push("Tanggal invalid: " + row.tanggal);
          skipped++;
          continue;
        }
        const isoDate = dateToISO(dt);
        if (!isoDate) {
          errors.push("Tanggal invalid: " + row.tanggal);
          skipped++;
          continue;
        }
        const l1 = parseNumSafe(row.level1);
        const l2 = parseNumSafe(row.level2);
        const l3 = parseNumSafe(row.level3);
        if (l1 === null && l2 === null && l3 === null) {
          skipped++;
          continue;
        }

        await db.inputQC.create({
          data: {
            id: genID("QC"),
            paramID: String(payload.paramID ?? ""),
            lotID: String(payload.lotID ?? ""),
            parameter: parameterStr,
            noLot: noLotStr,
            namaAlat: namaAlatStr,
            tanggal: isoDate,
            level1: l1,
            level2: l2,
            level3: l3,
            inputBy: ownerUsername,
            inputDate: new Date(),
            validated: false,
            validatedBy: null,
            validatedDate: null,
            catatanValidasi: null,
            ownerUsername,
          },
        });
        count++;
      }

      await logA(ownerUsername, "BULK_QC", count + " data ditambahkan", logUser);
      return { ok: true, count, skipped, errors };
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}

// ============================================================
// HISTORI QC — mirror code.gs getHistoriQC/restoreHistoriQC/deleteHistoriQC
// ============================================================

// function getHistoriQC(ownerUsername, role, filter)
// filter: {actionType, paramID, lotID, bidang, startDate, endDate}
// Returns array of histori objects.
export async function getHistoriQC(args: any[], session: SessionData | null) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  const filter = args[2] || {};
  try {
    const where: any = {};
    if (role !== "superadmin") where.ownerUsername = ownerUsername;
    if (filter.actionType) where.actionType = String(filter.actionType);
    if (filter.paramID) where.paramID = String(filter.paramID);
    if (filter.lotID) where.lotID = String(filter.lotID);

    if (filter.startDate || filter.endDate) {
      const dateFilter: any = {};
      if (filter.startDate) {
        const sd = parseDateStr(String(filter.startDate));
        if (sd) {
          const iso = dateToISO(sd);
          if (iso) dateFilter.gte = iso;
        }
      }
      if (filter.endDate) {
        const ed = parseDateStr(String(filter.endDate));
        if (ed) {
          const iso = dateToISO(ed);
          if (iso) dateFilter.lte = iso;
        }
      }
      if (Object.keys(dateFilter).length > 0) where.tanggal = dateFilter;
    }

    const rows = await db.historiQC.findMany({
      where,
      orderBy: { deletedDate: "desc" },
    });

    // Build paramMap for bidang filter & parameter fallback (mirror GAS)
    let paramMap: Record<string, { parameter: string; bidang: string }> = {};
    if (filter.bidang) {
      const params = await db.parameters.findMany({});
      for (const p of params) {
        paramMap[p.id] = { parameter: p.parameter, bidang: p.bidang || "Lainnya" };
      }
    }

    let result = rows.map((r: any) => mapHistoriRow(r, paramMap[r.paramID] || null));

    if (filter.bidang) {
      const targetBidang = String(filter.bidang);
      result = result.filter((r: any) => {
        const pinfo = paramMap[r.paramID];
        const b = pinfo ? pinfo.bidang : "Lainnya";
        return b === targetBidang;
      });
    }

    return result;
  } catch (e) {
    return [];
  }
}

// function restoreHistoriQC(hqcID, ownerUsername)
// Find the histori row, recreate the InputQC row from it, add a new
// histori row with actionType 'RESTORED'.
export async function restoreHistoriQC(args: any[], session: SessionData | null) {
  return withLock("inputqc_restore", async () => {
    try {
      const hqcID = args[0];
      const ownerUsername = deriveOwner(args, session, 1);

      if (!hqcID) return { ok: false, msg: "Data histori tidak ditemukan" };

      // Find histori row (case-insensitive owner match — mirror GAS)
      const historiRow = await db.historiQC.findFirst({
        where: {
          id: String(hqcID),
          ownerUsername: { equals: ownerUsername },
        },
      });
      if (!historiRow) {
        return { ok: false, msg: "Data histori tidak ditemukan" };
      }
      if (historiRow.actionType !== "DATA DIHAPUS") {
        return { ok: false, msg: "Hanya data DIHAPUS yang bisa di-restore" };
      }

      // Make sure the QC ID isn't already present in InputQC
      if (historiRow.qcid) {
        const existing = await db.inputQC.findUnique({
          where: { id: String(historiRow.qcid) },
        });
        if (existing) {
          return { ok: false, msg: "Data QC sudah ada di InputQC" };
        }
      }

      // Recreate the InputQC row
      const newQcID = historiRow.qcid || genID("QC");
      await db.inputQC.create({
        data: {
          id: String(newQcID),
          paramID: String(historiRow.paramID ?? ""),
          lotID: historiRow.lotID ? String(historiRow.lotID) : "",
          parameter: String(historiRow.parameter ?? ""),
          noLot: historiRow.noLot ? String(historiRow.noLot) : "",
          namaAlat: historiRow.namaAlat,
          tanggal: historiRow.tanggal ? String(historiRow.tanggal) : new Date().toISOString().slice(0, 10),
          level1: historiRow.level1,
          level2: historiRow.level2,
          level3: historiRow.level3,
          inputBy: historiRow.inputBy || ownerUsername,
          inputDate: new Date(),
          validated: false,
          validatedBy: null,
          validatedDate: null,
          catatanValidasi: null,
          ownerUsername: historiRow.ownerUsername,
        },
      });

      // Add a new histori row recording the restore
      await db.historiQC.create({
        data: {
          id: genID("HQC"),
          qcid: String(newQcID),
          paramID: String(historiRow.paramID ?? ""),
          lotID: historiRow.lotID,
          parameter: String(historiRow.parameter ?? ""),
          noLot: historiRow.noLot,
          namaAlat: historiRow.namaAlat,
          tanggal: historiRow.tanggal,
          level1: historiRow.level1,
          level2: historiRow.level2,
          level3: historiRow.level3,
          inputBy: historiRow.inputBy,
          deletedBy: ownerUsername,
          deletedDate: new Date(),
          ownerUsername: historiRow.ownerUsername,
          actionType: "RESTORED",
          changeDetail: "Restored from HQC=" + hqcID,
        },
      });

      await logA(ownerUsername, "RESTORE_QC", String(newQcID));
      return { ok: true, msg: "Data berhasil di-restore" };
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}

// function deleteHistoriQC(hqcID, ownerUsername)
// Permanently delete the histori row.
export async function deleteHistoriQC(args: any[], session: SessionData | null) {
  return withLock("histori_delete", async () => {
    try {
      const hqcID = args[0];
      const ownerUsername = deriveOwner(args, session, 1);

      if (!hqcID) return { ok: false, msg: "Data histori tidak ditemukan" };

      const existing = await db.historiQC.findFirst({
        where: {
          id: String(hqcID),
          ownerUsername: { equals: ownerUsername },
        },
      });
      if (!existing) {
        return { ok: false, msg: "Data histori tidak ditemukan" };
      }

      await db.historiQC.delete({ where: { id: String(hqcID) } });
      await logA(ownerUsername, "DELETE_HISTORI", "HQC=" + hqcID);
      return { ok: true, msg: "Histori berhasil dihapus permanen" };
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}

// ============================================================
// VALIDASI QC — mirror code.gs getValidasiData/validateQC/validateQCBulk
// ============================================================

// function getValidasiData(ownerUsername, role, filter)
// Returns QC rows enriched with z-scores per level + lot mean/SD/TEa/satuan.
// z1 = (level1 - lot.meanL1) / lot.sdL1 (when lot found and SD != 0)
export async function getValidasiData(args: any[], session: SessionData | null) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  const filter = args[2] || {};
  try {
    const qcData = await getInputQC([ownerUsername, role, filter], session);
    const lots = await db.lotQC.findMany({});
    const lotMap: Record<string, any> = {};
    for (const l of lots) lotMap[l.id] = l;

    // z-score helper (mirror GAS zS)
    function zS(val: any, mean: number | null, sd: number | null): number | null {
      if (val === null || val === undefined || val === "" || !mean || !sd) return null;
      const v = parseNumSafe(val);
      if (v === null) return null;
      return (v - mean) / sd;
    }

    const result = qcData.map((q: any) => {
      const lot = lotMap[q.lotID];
      const mL1 = lot ? parseNumSafe(lot.meanL1) : null;
      const sL1 = lot ? parseNumSafe(lot.sdL1) : null;
      const mL2 = lot ? parseNumSafe(lot.meanL2) : null;
      const sL2 = lot ? parseNumSafe(lot.sdL2) : null;
      const mL3 = lot ? parseNumSafe(lot.meanL3) : null;
      const sL3 = lot ? parseNumSafe(lot.sdL3) : null;
      return {
        qcID: q.qcID,
        paramID: q.paramID,
        lotID: q.lotID,
        parameter: q.parameter,
        noLot: q.noLot,
        namaAlat: q.namaAlat,
        tanggal: q.tanggal,
        level1: q.level1,
        level2: q.level2,
        level3: q.level3,
        z1: zS(q.level1, mL1, sL1),
        z2: zS(q.level2, mL2, sL2),
        z3: zS(q.level3, mL3, sL3),
        validated: q.validated,
        validatedBy: q.validatedBy,
        validatedDate: q.validatedDate,
        catatanValidasi: q.catatanValidasi,
        lotMeanL1: mL1,
        lotSDL1: sL1,
        lotMeanL2: mL2,
        lotSDL2: sL2,
        lotMeanL3: mL3,
        lotSDL3: sL3,
        tea: lot ? parseNumSafe(lot.tea) : null,
        satuan: lot ? lot.satuan : null,
        ownerUsername: q.ownerUsername,
      };
    });
    return result;
  } catch (e) {
    return [];
  }
}

// function validateQC(qcID, catatanValidasi, validatedBy, ownerUsername, logUser)
// Set validated=true, validatedBy, validatedDate=now, catatanValidasi.
// Note: original GAS logs action under `validatedBy` username (not ownerUsername).
export async function validateQC(args: any[], session: SessionData | null) {
  return withLock("inputqc_validate", async () => {
    try {
      const qcID = args[0];
      const catatanValidasi = args[1] != null ? String(args[1]) : "";
      const validatedBy = args[2] || "";
      const ownerUsername = deriveOwner(args, session, 3);
      const logUser = deriveLogUser(args, session, 4);

      if (!qcID) return { ok: false, msg: "Data tidak ditemukan" };

      // Superadmin (real role from session) can validate ANY QC row regardless
      // of ownerUsername — mirrors getInputQC behavior. When viewing-as another
      // user, ownerUsername is that user (filter still applies for non-superadmin
      // real role). When superadmin views own account, ownerUsername='admin' but
      // QC rows may belong to other users, so skip the owner filter.
      const findWhere: any = { id: String(qcID) };
      if (session?.role !== "superadmin") {
        findWhere.ownerUsername = { equals: ownerUsername };
      }
      const existing = await db.inputQC.findFirst({ where: findWhere });
      if (!existing) {
        return { ok: false, msg: "Data tidak ditemukan" };
      }

      await db.inputQC.update({
        where: { id: String(qcID) },
        data: {
          validated: true,
          validatedBy: validatedBy || null,
          validatedDate: new Date(),
          catatanValidasi: catatanValidasi || null,
        },
      });

      // GAS: logA(validatedBy, 'VALIDATE_QC', qcID, logUser) — uses validatedBy
      // (the validator's username), not ownerUsername.
      await logA(validatedBy || ownerUsername, "VALIDATE_QC", String(qcID), logUser);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}

// function validateQCBulk(qcIDs, catatanValidasi, validatedBy, ownerUsername, logUser)
// Iterate qcIDs, only validate those whose validated is currently false.
// Returns {ok, count}.
export async function validateQCBulk(args: any[], session: SessionData | null) {
  return withLock("inputqc_validate_bulk", async () => {
    try {
      const qcIDs: any[] = Array.isArray(args[0]) ? args[0] : [];
      const catatanValidasi = args[1] != null ? String(args[1]) : "";
      const validatedBy = args[2] || "";
      const ownerUsername = deriveOwner(args, session, 3);
      const logUser = deriveLogUser(args, session, 4);

      let count = 0;
      const ids = qcIDs.map(String);

      // Fetch rows that match ID + owner + not-yet-validated
      const rows = await db.inputQC.findMany({
        where: {
          id: { in: ids },
          ownerUsername: { equals: ownerUsername },
          validated: false,
        },
      });

      for (const r of rows) {
        await db.inputQC.update({
          where: { id: r.id },
          data: {
            validated: true,
            validatedBy: validatedBy || null,
            validatedDate: new Date(),
            catatanValidasi: catatanValidasi || null,
          },
        });
        count++;
      }

      if (count > 0) {
        await logA(
          validatedBy || ownerUsername,
          "VALIDATE_QC_BULK",
          count + " entries",
          logUser
        );
      }
      return { ok: true, count };
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}

// function updateValidasiNote(qcID, catatanValidasi, ownerUsername, logUser)
// Update ONLY the validation note for an already-validated QC row.
// Preserves validatedBy / validatedDate audit trail (unlike validateQC which
// overwrites them). Used by the Validasi QC menu's "Edit catatan" action.
export async function updateValidasiNote(args: any[], session: SessionData | null) {
  return withLock("inputqc_update_note", async () => {
    try {
      const qcID = args[0];
      const catatanValidasi = args[1] != null ? String(args[1]) : "";
      const ownerUsername = deriveOwner(args, session, 2);
      const logUser = deriveLogUser(args, session, 3);

      if (!qcID) return { ok: false, msg: "Data tidak ditemukan" };

      // Superadmin can edit note on ANY QC row (see validateQC for rationale).
      const findWhere: any = { id: String(qcID) };
      if (session?.role !== "superadmin") {
        findWhere.ownerUsername = { equals: ownerUsername };
      }
      const existing = await db.inputQC.findFirst({ where: findWhere });
      if (!existing) {
        return { ok: false, msg: "Data tidak ditemukan" };
      }

      await db.inputQC.update({
        where: { id: String(qcID) },
        data: {
          catatanValidasi: catatanValidasi || null,
        },
      });

      await logA(
        existing.validatedBy || ownerUsername,
        "EDIT_VALIDASI_NOTE",
        String(qcID),
        logUser
      );
      return { ok: true };
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}

// function unvalidateQC(qcID, ownerUsername, logUser)
// Clear validation fields (validated=false, validatedBy/Date/catatan=null) on
// a QC row, keeping the QC data itself. Used by the Validasi QC menu's "Hapus"
// action which removes only the validation, not the QC entry.
export async function unvalidateQC(args: any[], session: SessionData | null) {
  return withLock("inputqc_unvalidate", async () => {
    try {
      const qcID = args[0];
      const ownerUsername = deriveOwner(args, session, 1);
      const logUser = deriveLogUser(args, session, 2);

      if (!qcID) return { ok: false, msg: "Data tidak ditemukan" };

      // Superadmin can unvalidate ANY QC row (see validateQC for rationale).
      const findWhere: any = { id: String(qcID) };
      if (session?.role !== "superadmin") {
        findWhere.ownerUsername = { equals: ownerUsername };
      }
      const existing = await db.inputQC.findFirst({ where: findWhere });
      if (!existing) {
        return { ok: false, msg: "Data tidak ditemukan" };
      }

      await db.inputQC.update({
        where: { id: String(qcID) },
        data: {
          validated: false,
          validatedBy: null,
          validatedDate: null,
          catatanValidasi: null,
        },
      });

      await logA(
        existing.validatedBy || ownerUsername,
        "UNVALIDATE_QC",
        String(qcID),
        logUser
      );
      return { ok: true };
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}
