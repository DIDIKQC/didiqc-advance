// ============================================================
// import-db.ts — Import Database dari file Excel hasil Export DB
// (tombol "Import DB" di menu Input Data — KHUSUS SUPERADMIN)
//
// Prinsip (sesuai permintaan user):
//   1. File yang diimport WAJIB template Excel hasil tombol "Export DB"
//      (3 sheet: "Input QC", "Parameter", "Lot QC") sehingga kolom
//      langsung match/sinkron dengan aplikasi.
//   2. APPEND-ONLY — analogi "mencari baris kosong berikutnya di bawahnya":
//      data import ditambahkan SETELAH data yang sudah ada.
//      TIDAK ADA baris lama yang ditimpa/diubah/dihapus.
//   3. TIDAK MENUMPUK: baris yang identik dengan data yang sudah ada
//      di database dilewati (skip) agar tidak terjadi duplikat.
//      - Parameter : kunci = nama parameter (per akun)
//      - Lot QC    : kunci = paramID + No.Lot (per akun)
//      - Input QC  : kunci = paramID + lotID + tanggal (per akun)
//   4. PRIVASI per akun tetap terjaga: semua insert di-scope ke
//      ownerUsername aktif (View-As aware). Kolom "Owner" di file Excel
//      diabaikan — data selalu masuk ke akun yang sedang aktif.
//   5. Hanya superadmin yang boleh memanggil handler ini (dicek server-side).
// ============================================================

import { db } from "@/lib/db";
import type { SessionData } from "@/lib/session";
import { parseNumSafe, dateToISO, parseDateStr, withLock } from "@/lib/utils-server";

// ------------------------------------------------------------
// Helper
// ------------------------------------------------------------

// ID generator anti-tabrakan untuk bulk import dalam milidetik yang sama
let importIdCounter = 0;
function genImportID(prefix: string): string {
  importIdCounter = (importIdCounter + 1) % 1000000;
  return `${prefix}_${Date.now()}_${importIdCounter}_${Math.floor(
    Math.random() * 9999
  )}`;
}

function s(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

// Normalisasi kunci pembanding (case-insensitive + trim) — anti duplikat
function k(v: any): string {
  return s(v).toLowerCase();
}

// Normalisasi tanggal apa pun → "YYYY-MM-DD" atau "" jika tidak valid
function normDate(v: any): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    // Excel serial date → tanggal (via UTC agar tanggal kalender tetap)
    if (v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return "";
  }
  const dt = parseDateStr(String(v));
  return dt ? dateToISO(dt) || "" : "";
}

const CHUNK = 400;

// createMany dengan fallback per-baris — 1 baris bermasalah tidak
// menggagalkan seluruh import (aman utk SQLite lokal & PostgreSQL prod)
async function createManySafe(
  model: any,
  rows: any[],
  label: string
): Promise<number> {
  let created = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    try {
      const r = await model.createMany({ data: chunk });
      created += r.count || 0;
    } catch (e: any) {
      console.error(
        `[importDB] createMany ${label} gagal, fallback per-baris:`,
        e?.message
      );
      for (const row of chunk) {
        try {
          await model.create({ data: row });
          created++;
        } catch (rowErr: any) {
          console.error(`[importDB] gagal insert ${label}:`, rowErr?.message);
        }
      }
    }
  }
  return created;
}

// ------------------------------------------------------------
// Handler utama
// args[0] = { params:[{parameter,bidang,dibuat}],
//             lots:[{parameter,noLot,namaAlat,methode,satuan,sumber,
//                    expiredDate,tea,biasPct,meanL1..3,sdL1..3,targetL1..3}],
//             qc:[{tanggal,parameter,namaAlat,noLot,level1..3,status,
//                  validator,catatanValidasi,inputBy}] }
// args[1] = ownerUsername aktif (getActiveUsername — View-As aware)
// args[2] = logUser
// ------------------------------------------------------------
export async function importDB(args: any[], session: SessionData | null) {
  return withLock("importdb", async () => {
    try {
      // ---- Keamanan: hanya superadmin (dicek server-side) ----
      if (!session || session.role !== "superadmin") {
        return {
          ok: false,
          msg: "Hanya superadmin yang dapat melakukan Import DB",
        };
      }

      const ownerUsername =
        (typeof args[1] === "string" && args[1].length > 0
          ? args[1]
          : session.activeUsername || session.username) || "";
      if (!ownerUsername) return { ok: false, msg: "Akun tidak valid" };

      const payload = args[0] || {};
      const rawParams: any[] = Array.isArray(payload.params) ? payload.params : [];
      const rawLots: any[] = Array.isArray(payload.lots) ? payload.lots : [];
      const rawQC: any[] = Array.isArray(payload.qc) ? payload.qc : [];

      if (!rawParams.length && !rawLots.length && !rawQC.length) {
        return { ok: false, msg: "Tidak ada data yang dapat diimport dari file" };
      }

      // ================= 1. PARAMETER =================
      const paramMap = new Map<string, { id: string; parameter: string }>();
      const existingParams = await db.parameters.findMany({
        where: { ownerUsername },
        select: { id: true, parameter: true },
      });
      existingParams.forEach((p) =>
        paramMap.set(k(p.parameter), { id: p.id, parameter: p.parameter })
      );

      const newParams: any[] = [];
      const newParamKeysFromSheet = new Set<string>();
      let paramSheetValid = 0;
      let paramSheetSkipped = 0;
      let implicitParams = 0;

      // Ambil (atau buat) param berdasarkan nama — dipakai juga lot & QC.
      // Jika parameter belum ada di DB maupun di sheet Parameter, dibuat
      // otomatis (bidang "Lainnya") supaya tidak ada data yang hilang.
      const ensureParam = (
        name: string,
        bidang?: string,
        createdDateHint?: Date
      ): { id: string; parameter: string } | null => {
        const key = k(name);
        if (!key) return null;
        const found = paramMap.get(key);
        if (found) return found;
        const id = genImportID("PAR");
        const parameterName = s(name);
        const row: any = {
          id,
          parameter: parameterName,
          ownerUsername,
          createdDate: createdDateHint || new Date(),
          createdBy: ownerUsername,
          bidang: s(bidang) || "Lainnya",
        };
        newParams.push(row);
        const entry = { id, parameter: parameterName };
        paramMap.set(key, entry);
        return entry;
      };

      for (const r of rawParams) {
        const name = s(r && r.parameter);
        if (!name) continue;
        paramSheetValid++;
        if (paramMap.has(k(name))) {
          paramSheetSkipped++;
          continue;
        }
        // Pertahankan tanggal "Dibuat" bila tersedia di sheet
        const dibuat = normDate(r && r.dibuat);
        const hint = dibuat ? parseDateStr(dibuat) || undefined : undefined;
        ensureParam(name, r && r.bidang, hint);
        newParamKeysFromSheet.add(k(name));
      }

      // ================= 2. LOT QC =================
      const lotMap = new Map<string, string>(); // key(paramID|noLot) -> lotID
      const existingLots = await db.lotQC.findMany({
        where: { ownerUsername },
        select: { id: true, paramID: true, noLot: true },
      });
      existingLots.forEach((l) => lotMap.set(l.paramID + "||" + k(l.noLot), l.id));

      const newLots: any[] = [];
      let lotSheetValid = 0;
      let lotSheetSkipped = 0;
      let implicitLots = 0;

      // Ambil (atau buat) lot berdasarkan paramID + No.Lot — dipakai QC.
      // Lot buatan otomatis hanya berisi nama alat (dari baris QC).
      const ensureLot = (
        paramID: string,
        noLot: string,
        namaAlat?: string,
        implicit?: boolean
      ): string | null => {
        if (!paramID || !s(noLot)) return null;
        const key = paramID + "||" + k(noLot);
        const found = lotMap.get(key);
        if (found) return found;
        const id = genImportID("LOT");
        newLots.push({
          id,
          paramID,
          noLot: s(noLot),
          namaAlat: s(namaAlat) || null,
          methode: null,
          satuan: null,
          expiredDate: null,
          sumber: "Manufaktur",
          meanL1: null,
          sdL1: null,
          targetL1: null,
          meanL2: null,
          sdL2: null,
          targetL2: null,
          meanL3: null,
          sdL3: null,
          targetL3: null,
          tea: null,
          biasPct: null,
          ownerUsername,
        });
        lotMap.set(key, id);
        if (implicit) implicitLots++;
        return id;
      };

      for (const r of rawLots) {
        const noLot = s(r && r.noLot);
        const pname = s(r && r.parameter);
        if (!noLot || !pname) continue;
        lotSheetValid++;
        const param = ensureParam(pname);
        if (!param) continue;
        if (lotMap.has(param.id + "||" + k(noLot))) {
          lotSheetSkipped++;
          continue;
        }
        const id = genImportID("LOT");
        newLots.push({
          id,
          paramID: param.id,
          noLot,
          namaAlat: s(r.namaAlat) || null,
          methode: s(r.methode) || null,
          satuan: s(r.satuan) || null,
          expiredDate: normDate(r.expiredDate) || null,
          sumber: s(r.sumber) || "Manufaktur",
          meanL1: parseNumSafe(r.meanL1),
          sdL1: parseNumSafe(r.sdL1),
          targetL1: parseNumSafe(r.targetL1),
          meanL2: parseNumSafe(r.meanL2),
          sdL2: parseNumSafe(r.sdL2),
          targetL2: parseNumSafe(r.targetL2),
          meanL3: parseNumSafe(r.meanL3),
          sdL3: parseNumSafe(r.sdL3),
          targetL3: parseNumSafe(r.targetL3),
          tea: parseNumSafe(r.tea),
          biasPct: parseNumSafe(r.biasPct),
          ownerUsername,
        });
        lotMap.set(param.id + "||" + k(noLot), id);
      }

      // ================= 3. INPUT QC =================
      const qcMap = new Map<string, boolean>(); // key(paramID|lotID|tanggal)
      const existingQC = await db.inputQC.findMany({
        where: { ownerUsername },
        select: { paramID: true, lotID: true, tanggal: true },
      });
      existingQC.forEach((q) =>
        qcMap.set(q.paramID + "||" + q.lotID + "||" + k(q.tanggal), true)
      );

      const newQC: any[] = [];
      let qcSheetValid = 0;
      let qcSheetSkipped = 0;

      for (const r of rawQC) {
        const pname = s(r && r.parameter);
        const noLot = s(r && r.noLot);
        const tanggal = normDate(r && r.tanggal);
        if (!pname || !noLot || !tanggal) continue;
        qcSheetValid++;
        const param = ensureParam(pname);
        if (!param) continue;
        const lotID = ensureLot(param.id, noLot, r && r.namaAlat, true);
        if (!lotID) continue;
        const key = param.id + "||" + lotID + "||" + tanggal.toLowerCase();
        if (qcMap.has(key)) {
          qcSheetSkipped++;
          continue;
        }
        qcMap.set(key, true);
        const isValid = k(r.status) === "valid";
        newQC.push({
          id: genImportID("QC"),
          paramID: param.id,
          lotID,
          parameter: param.parameter,
          noLot,
          namaAlat: s(r.namaAlat) || null,
          tanggal,
          level1: parseNumSafe(r.level1),
          level2: parseNumSafe(r.level2),
          level3: parseNumSafe(r.level3),
          inputBy: s(r.inputBy) || ownerUsername,
          inputDate: new Date(),
          validated: isValid,
          validatedBy: isValid ? s(r.validator) || ownerUsername : null,
          validatedDate: isValid ? new Date() : null,
          catatanValidasi: s(r.catatanValidasi) || null,
          ownerUsername,
        });
      }

      // ================= INSERT (append) =================
      await createManySafe(db.parameters, newParams, "parameter");
      await createManySafe(db.lotQC, newLots, "lot");
      await createManySafe(db.inputQC, newQC, "inputqc");

      return {
        ok: true,
        counts: {
          paramsCreated: newParams.length,
          paramsExisting: paramSheetSkipped,
          implicitParams: Math.max(0, newParams.length - newParamKeysFromSheet.size),
          lotsCreated: newLots.length - implicitLots,
          lotsExisting: lotSheetSkipped,
          implicitLots,
          qcCreated: newQC.length,
          qcSkipped: qcSheetSkipped,
          paramsRead: paramSheetValid,
          lotsRead: lotSheetValid,
          qcRead: qcSheetValid,
        },
        msg: "Import selesai",
      };
    } catch (e: any) {
      console.error("[importDB] error:", e?.message);
      return { ok: false, msg: e?.message || "Import gagal" };
    }
  });
}
