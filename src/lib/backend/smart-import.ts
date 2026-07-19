// ============================================================
// Smart Import & Hapus Data Privat module
// Port dari code.gs fungsi:
//   - smartImportQC      (import batch QC dengan fuzzy-match param+lot)
//   - getInputQCForHapus (filter InputQC untuk layar hapus data)
//   - hapusDataPrivat    (bulk delete inputqc/lotqc/parameter + log)
//
// Catatan porting:
// - SMART_PWD = 'didikqc' (mirror code.gs)
// - Hanya tipe 'inputqc' yang push row ke HistoriQC (DATA DIHAPUS)
// - logA() selalu dipanggil untuk audit trail
// ============================================================

import { db } from "@/lib/db";
import {
  genID,
  logA,
  parseNumSafe,
  SMART_PWD,
  parseDateStr,
  dateToISO,
  withLock,
  getActiveUsername,
} from "@/lib/utils-server";
import type { SessionData } from "@/lib/session";

// ============================================================
// smartImportQC — import batch QC dengan fuzzy-match parameter+lot
// args[0]=payload {rows:[{parameter,noLot,tanggal,level1,level2,level3}], smartPassword}
// args[1]=ownerUsername
//
// Match logic (mirror code.gs):
//   1. Cari parameter exact (case insensitive). Jika tidak ketemu,
//      cari fuzzy: substring dua arah.
//   2. Cari lot di antara lot milik parameter tsb:
//      - Jika row.noLot diisi: exact match (case insensitive)
//      - Jika tidak ketemu & ada ≥1 lot untuk param: pakai lot pertama
//   3. Parse tanggal via parseDateStr. Skip jika invalid.
//   4. Insert InputQC row dengan genID('QC').
// ============================================================
export async function smartImportQC(args: any[], session: SessionData | null) {
  return withLock("inputqc_smart_import", async () => {
    try {
      const [payload, ownerUsernameArg] = args;
      const owner = ownerUsernameArg || getActiveUsername(session);

      if (!payload || payload.smartPassword !== SMART_PWD) {
        return { ok: false, msg: "Password salah" };
      }

      const rows: any[] = payload.rows || [];
      const [params, lots] = await Promise.all([
        db.parameters.findMany({ where: { ownerUsername: owner } }),
        db.lotQC.findMany({ where: { ownerUsername: owner } }),
      ]);

      let count = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const row of rows) {
        // --- Match parameter ---
        let matched = params.find(
          (p) =>
            p.parameter.toLowerCase() ===
            String(row.parameter || "").toLowerCase()
        );
        if (!matched) {
          matched = params.find((p) => {
            const pp = p.parameter.toLowerCase();
            const rp = String(row.parameter || "").toLowerCase();
            return rp.indexOf(pp) > -1 || pp.indexOf(rp) > -1;
          });
        }
        if (!matched) {
          errors.push("Param: " + row.parameter);
          skipped++;
          continue;
        }

        // --- Match lot ---
        // Prisma schema: Parameters.id (was paramID in GAS), LotQC.id (was lotID in GAS),
        // LotQC.paramID is the FK to Parameters.id
        const paramID = matched.id;
        const paramLots = lots.filter((l) => l.paramID === paramID);
        let matchedLot: any = null;
        if (row.noLot) {
          matchedLot = paramLots.find(
            (l) =>
              l.noLot.toLowerCase() === String(row.noLot).toLowerCase()
          );
        }
        if (!matchedLot && paramLots.length > 0) {
          matchedLot = paramLots[0];
        }
        if (!matchedLot) {
          errors.push("Lot tdk ditemukan: " + row.parameter);
          skipped++;
          continue;
        }

        // --- Validate tanggal ---
        if (!row.tanggal) {
          errors.push("Tanggal kosong");
          skipped++;
          continue;
        }
        const dt = parseDateStr(String(row.tanggal));
        if (!dt) {
          errors.push("Tgl invalid: " + row.tanggal);
          skipped++;
          continue;
        }
        const isoDate = dateToISO(dt);
        if (!isoDate) {
          errors.push("Tgl invalid: " + row.tanggal);
          skipped++;
          continue;
        }

        // --- Insert InputQC ---
        await db.inputQC.create({
          data: {
            id: genID("QC"),
            paramID: paramID,
            lotID: matchedLot.id,
            parameter: matched.parameter,
            noLot: matchedLot.noLot,
            namaAlat: matchedLot.namaAlat || null,
            tanggal: isoDate,
            level1: parseNumSafe(row.level1),
            level2: parseNumSafe(row.level2),
            level3: parseNumSafe(row.level3),
            inputBy: owner,
            inputDate: new Date(),
            validated: false,
            validatedBy: null,
            validatedDate: null,
            catatanValidasi: null,
            ownerUsername: owner,
          },
        });
        count++;
      }

      await logA(
        owner,
        "SMART_IMPORT",
        count + " imported, " + skipped + " skipped"
      );

      return { ok: true, count, skipped, errors };
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}

// ============================================================
// getInputQCForHapus — ambil InputQC terfilter untuk layar Hapus Data
// args[0]=ownerUsername, args[1]=payload {startDate, endDate, paramIDs}
// ============================================================
export async function getInputQCForHapus(
  args: any[],
  session: SessionData | null
) {
  try {
    const [ownerUsernameArg, payload] = args;
    const owner = ownerUsernameArg || getActiveUsername(session);
    const filter = payload || {};

    const where: any = { ownerUsername: owner };

    if (filter.paramIDs && filter.paramIDs.length > 0) {
      where.paramID = { in: filter.paramIDs };
    }

    if (filter.startDate || filter.endDate) {
      const dateFilter: any = {};
      if (filter.startDate) {
        const sd = parseDateStr(String(filter.startDate));
        if (sd) dateFilter.gte = dateToISO(sd);
      }
      if (filter.endDate) {
        const ed = parseDateStr(String(filter.endDate));
        if (ed) dateFilter.lte = dateToISO(ed);
      }
      where.tanggal = dateFilter;
    }

    const rows = await db.inputQC.findMany({
      where,
      orderBy: { tanggal: "desc" },
    });

    // Map ke shape yang sama dengan GAS getInputQC output
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
// hapusDataPrivat — bulk delete inputqc/lotqc/parameter
// args[0]=type ('inputqc'|'lotqc'|'parameter')
// args[1]=ids (array of string)
// args[2]=ownerUsername
// args[3]=alasan (min 5 chars)
// args[4]=gatePassword (must === 'didikqc')
// args[5]=logUser
//
// Untuk type='inputqc': push row HistoriQC (actionType='DATA DIHAPUS',
// changeDetail=alasan) sebelum delete, persis seperti deleteInputQC
// di code.gs.
// ============================================================
export async function hapusDataPrivat(
  args: any[],
  session: SessionData | null
) {
  const type = args[0];
  return withLock(`hapus_${type}`, async () => {
    try {
      const [
        _type,
        ids,
        ownerUsernameArg,
        alasan,
        gatePassword,
        logUser,
      ] = args;
      const owner = ownerUsernameArg || getActiveUsername(session);

      if (gatePassword !== SMART_PWD) {
        return { ok: false, msg: "Password salah" };
      }
      if (!alasan || String(alasan).length < 5) {
        return { ok: false, msg: "Alasan min 5 karakter" };
      }

      let count = 0;
      const idList: any[] = Array.isArray(ids) ? ids : [];

      for (const id of idList) {
        let ok = false;
        if (type === "inputqc") {
          ok = await deleteInputQCInternal(String(id), owner, String(alasan));
        } else if (type === "lotqc") {
          ok = await deleteLotQCInternal(String(id), owner);
        } else if (type === "parameter") {
          ok = await deleteParameterInternal(String(id), owner);
        }
        if (ok) count++;
      }

      await logA(
        owner,
        "HAPUS_" + type.toUpperCase(),
        count + " item, alasan: " + alasan,
        logUser
      );

      return { ok: true, count };
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}

// ============================================================
// Internal helper: delete InputQC + push HistoriQC row
// (mirror deleteInputQC di code.gs — logUser tidak diteruskan dari
// hapusDataPrivat agar sesuai behavior aslinya; by = ownerUsername)
// ============================================================
async function deleteInputQCInternal(
  qcID: string,
  owner: string,
  alasan: string
): Promise<boolean> {
  const row = await db.inputQC.findUnique({ where: { id: qcID } });
  if (
    !row ||
    String(row.ownerUsername).toLowerCase() !== String(owner).toLowerCase()
  ) {
    return false;
  }

  // Push to HistoriQC (mirrors addHistoriQC with actionType='DATA DIHAPUS')
  await db.historiQC.create({
    data: {
      id: genID("HQC"),
      qcid: row.id,
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
      deletedBy: owner, // by = logUser || ownerUsername → falls back to owner
      deletedDate: new Date(),
      ownerUsername: row.ownerUsername,
      actionType: "DATA DIHAPUS",
      changeDetail: alasan || "",
    },
  });

  await db.inputQC.delete({ where: { id: qcID } });

  await logA(owner, "DEL_QC", qcID + "|" + alasan);
  return true;
}

// ============================================================
// Internal helper: delete LotQC (mirror deleteLotQC di code.gs)
// ============================================================
async function deleteLotQCInternal(
  lotID: string,
  owner: string
): Promise<boolean> {
  const row = await db.lotQC.findUnique({ where: { id: lotID } });
  if (
    !row ||
    String(row.ownerUsername).toLowerCase() !== String(owner).toLowerCase()
  ) {
    return false;
  }
  await db.lotQC.delete({ where: { id: lotID } });
  await logA(owner, "DEL_LOT", lotID);
  return true;
}

// ============================================================
// Internal helper: delete Parameter (mirror deleteParameter di code.gs)
// ============================================================
async function deleteParameterInternal(
  paramID: string,
  owner: string
): Promise<boolean> {
  const row = await db.parameters.findUnique({ where: { id: paramID } });
  if (
    !row ||
    String(row.ownerUsername).toLowerCase() !== String(owner).toLowerCase()
  ) {
    return false;
  }
  await db.parameters.delete({ where: { id: paramID } });
  await logA(owner, "DEL_PARAM", paramID);
  return true;
}
