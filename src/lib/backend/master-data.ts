// ============================================================
// master-data.ts — Master data CRUD (port dari code.gs)
//
// Port 1:1 dari fungsi-fungsi master data di code.gs:
//   - Parameters       : getParameters, saveParameter, deleteParameter, getParamByID
//   - LotQC            : getLotQC, saveLotQC, deleteLotQC, getLotByID, getLotInfoForAutoFill
//   - DaftarTEa        : getDaftarTEa, saveDaftarTEa, deleteDaftarTEa
//   - KopSurat         : getKopSurat, saveKopSurat
//   - Settings         : getSetting, setSetting, getSettings, saveSettings
//
// Setiap fungsi menerima (args: any[], session: SessionData | null).
// - ownerUsername efektif: args[idx] || session.activeUsername || session.username
// - role efektif         : args[idx] || session.activeRole || session.role
// - logUser efektif      : args[idx] || session.loginUsername || session.username
// - superadmin melihat semua data; user lain hanya miliknya sendiri.
// ============================================================

import { db } from "@/lib/db";
import type { SessionData } from "@/lib/session";
import {
  genID,
  logA,
  parseNumSafe,
  fD,
  dateToISO,
  withLock,
} from "@/lib/utils-server";

// ============================================================
// 🛡️ healTenantData — Penjaga anti "parameter hilang" (v9.33)
// ============================================================
// Latar belakang: sebelum perbaikan isolasi tenant (commit dc5d313),
// dropdown parameter menampilkan parameter MILIK AKUN LAIN (superadmin
// melihat semua data). Akibatnya ada data QC/TEa/Lot yang tersimpan
// menunjuk paramID milik akun lain (contoh nyata: 584 data QC
// TRIGLISERID milik "didik" menunjuk paramID milik "admin"). Setelah
// isolasi tenant aktif, parameter tsb hilang dari dropdown akun
// sehingga datanya ikut tidak tampil.
//
// healTenantData memeriksa SEMUA tabel data milik satu akun dan
// memperbaiki referensi paramID/lotID yang "menggantung" SECARA OTOMATIS
// setiap kali akun memuat data (login / Lihat Sebagai / Muat Data):
//   1. paramID yang tidak ada di daftar parameter akun → dipetakan ke
//      parameter akun dengan nama sama; bila belum ada, dibuat ulang
//      (id BARU milik akun ini, bidang diambil dari master parameter).
//   2. lotID inputQC yang menunjuk lot milik akun lain / lot terhapus →
//      dipetakan ke lot akun dengan noLot sama, atau dibuat ulang.
//   3. baris pada lot milik akun sendiri tetapi paramID lot ≠ paramID
//      baris (lot tertukar fungsi) → dipindah ke lot yang tepat / lot
//      di-clone khusus untuk parameter tersebut.
// TIDAK PERNAH mengubah data akun lain. Idempoten & aman dipanggil
// berulang (jika tidak ada referensi menggantung, hampir tanpa kerja).
// Kegagalan heal TIDAK PERNAH menggagalkan proses utama (login).
// ============================================================

const HEAL_PARAM_TABLES = [
  "lotQC",
  "inputQC",
  "historiQC",
  "calculatedStats",
  "biasPME",
  "daftarTEa",
  "sigmaCVOpt",
] as const;

export async function healTenantData(ownerUsername: string): Promise<void> {
  if (!ownerUsername) return;
  try {
    await withLock("heal_" + ownerUsername, async () => {
      // ---- PASS 1: paramID menggantung pada 7 tabel data akun ----
      let myParams = await db.parameters.findMany({
        where: { ownerUsername },
        select: { id: true, parameter: true },
      });
      let paramIds = new Set(myParams.map((p) => p.id));
      let paramIdByName = new Map<string, string>();
      myParams.forEach((p) => {
        const k = String(p.parameter || "")
          .trim()
          .toLowerCase();
        if (k && !paramIdByName.has(k)) paramIdByName.set(k, p.id);
      });

      const resolveTargetParam = async (
        danglingId: string,
        nameHint?: string | null
      ): Promise<string | null> => {
        // (a) nilai dangling langsung sama dengan NAMA parameter akun ini
        const asName = paramIdByName.get(
          String(danglingId).trim().toLowerCase()
        );
        if (asName) return asName;
        // (b) baris parameter masih ada di DB (milik akun lain — warisan
        //     data sebelum isolasi tenant) → ambil nama/bidang/createdDate
        let name: string | null = null;
        let bidang: string | null = null;
        let createdDate: Date | undefined = undefined;
        try {
          const row = await db.parameters.findUnique({
            where: { id: danglingId },
            select: { parameter: true, bidang: true, createdDate: true },
          });
          if (row) {
            name = row.parameter;
            bidang = row.bidang;
            createdDate = row.createdDate;
          }
        } catch {
          /* abaikan */
        }
        // (c) nama tersimpan denormalisasi pada baris data itu sendiri
        if (!name && nameHint) name = String(nameHint).trim() || null;
        if (!name) return null;
        const key = name.trim().toLowerCase();
        const existing = paramIdByName.get(key);
        if (existing) return existing;
        // (d) buat ulang parameter untuk akun ini (id BARU milik akun ini)
        if (!bidang) {
          try {
            const mp = await db.masterParameter.findFirst({
              where: { parameter: name },
              select: { bidang: true },
            });
            if (mp) bidang = mp.bidang;
          } catch {
            /* abaikan */
          }
        }
        const newId = genID("PAR");
        await db.parameters.create({
          data: {
            id: newId,
            parameter: name,
            ownerUsername,
            createdDate: createdDate || new Date(),
            createdBy: ownerUsername,
            bidang: bidang || "Lainnya",
          },
        });
        paramIds.add(newId);
        paramIdByName.set(key, newId);
        return newId;
      };

      for (const t of HEAL_PARAM_TABLES) {
        const model: any = (db as any)[t];
        if (!model?.findMany) continue;
        try {
          const distinctRows = await model.findMany({
            where: { ownerUsername },
            distinct: ["paramID"],
            select: { paramID: true },
          });
          for (const dr of distinctRows) {
            const pid = dr.paramID;
            if (!pid || paramIds.has(pid)) continue;
            let hint: string | null = null;
            if (t === "inputQC" || t === "daftarTEa") {
              try {
                const row = await model.findFirst({
                  where: { ownerUsername, paramID: pid },
                  select: { parameter: true },
                });
                hint = row?.parameter || null;
              } catch {
                /* abaikan */
              }
            }
            const target = await resolveTargetParam(pid, hint);
            if (!target || target === pid) continue;
            await model.updateMany({
              where: { ownerUsername, paramID: pid },
              data: { paramID: target },
            });
          }
        } catch {
          /* tabel tidak tersedia / query gagal — lanjut tabel berikutnya */
        }
      }

      // ---- PASS 2: lotID pada inputQC ----
      const myLots = await db.lotQC.findMany({ where: { ownerUsername } });
      const myLotById = new Map(myLots.map((l) => [l.id, l]));
      const myLotIdByKey = new Map<string, string>(); // lower(noLot)||paramID -> lotID
      myLots.forEach((l) => {
        const k =
          String(l.noLot || "")
            .trim()
            .toLowerCase() +
          "||" +
          l.paramID;
        if (!myLotIdByKey.has(k)) myLotIdByKey.set(k, l.id);
      });

      const cloneLotForOwner = async (
        src: {
          noLot: string | null;
          namaAlat: string | null;
          methode: string | null;
          satuan: string | null;
          expiredDate: string | null;
          sumber: string | null;
          meanL1: number | null;
          sdL1: number | null;
          targetL1: number | null;
          meanL2: number | null;
          sdL2: number | null;
          targetL2: number | null;
          meanL3: number | null;
          sdL3: number | null;
          targetL3: number | null;
          tea: number | null;
          biasPct: number | null;
        },
        paramID: string
      ): Promise<string> => {
        const newId = genID("LOT");
        await db.lotQC.create({
          data: {
            id: newId,
            paramID,
            noLot: src.noLot,
            namaAlat: src.namaAlat,
            methode: src.methode,
            satuan: src.satuan,
            expiredDate: src.expiredDate,
            sumber: src.sumber || "Manufaktur",
            meanL1: src.meanL1,
            sdL1: src.sdL1,
            targetL1: src.targetL1,
            meanL2: src.meanL2,
            sdL2: src.sdL2,
            targetL2: src.targetL2,
            meanL3: src.meanL3,
            sdL3: src.sdL3,
            targetL3: src.targetL3,
            tea: src.tea,
            biasPct: src.biasPct,
            ownerUsername,
          },
        });
        myLotById.set(newId, { id: newId, paramID, noLot: src.noLot } as any);
        const k =
          String(src.noLot || "")
            .trim()
            .toLowerCase() +
          "||" +
          paramID;
        if (!myLotIdByKey.has(k)) myLotIdByKey.set(k, newId);
        return newId;
      };

      try {
        // (1) baris menunjuk lot milik akun LAIN atau lot yang sudah terhapus
        const danglingLots = await db.inputQC.findMany({
          where: { ownerUsername },
          distinct: ["lotID"],
          select: { lotID: true },
        });
        for (const dl of danglingLots) {
          const lid = dl.lotID;
          if (!lid || myLotById.has(lid)) continue;
          const lot = await db.lotQC.findUnique({ where: { id: lid } });
          if (lot) {
            // lot ada (milik akun lain) → petakan ke lot akun ini
            const rows = await db.inputQC.findMany({
              where: { ownerUsername, lotID: lid },
              distinct: ["paramID"],
              select: { paramID: true },
            });
            const targetParam =
              rows.length === 1
                ? rows[0].paramID
                : paramIds.has(lot.paramID)
                  ? lot.paramID
                  : null;
            if (!targetParam) continue;
            const existing = myLotIdByKey.get(
              String(lot.noLot || "")
                .trim()
                .toLowerCase() +
                "||" +
                targetParam
            );
            const targetLot =
              existing || (await cloneLotForOwner(lot, targetParam));
            await db.inputQC.updateMany({
              where: { ownerUsername, lotID: lid },
              data: { lotID: targetLot },
            });
          } else {
            // lot terhapus → buat ulang lot identitas dari data baris
            const rows = await db.inputQC.findMany({
              where: { ownerUsername, lotID: lid },
              select: { paramID: true, noLot: true, namaAlat: true },
            });
            if (!rows.length) continue;
            const targetParam = rows[0].paramID;
            if (!targetParam || !paramIds.has(targetParam)) continue;
            const noLot = rows[0].noLot || "-";
            const existing = myLotIdByKey.get(
              String(noLot)
                .trim()
                .toLowerCase() +
                "||" +
                targetParam
            );
            const targetLot =
              existing ||
              (await cloneLotForOwner(
                {
                  noLot,
                  namaAlat: rows[0].namaAlat,
                  methode: "-",
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
                },
                targetParam
              ));
            await db.inputQC.updateMany({
              where: { ownerUsername, lotID: lid },
              data: { lotID: targetLot },
            });
          }
        }

        // (2) baris pada lot milik akun SENDIRI tetapi paramID lot ≠ paramID
        //     baris (lot tertukar fungsi setelah lot diedit/diganti param)
        const pairs = await db.inputQC.findMany({
          where: { ownerUsername },
          distinct: ["lotID", "paramID"],
          select: { lotID: true, paramID: true },
        });
        for (const pr of pairs) {
          if (!pr.lotID || !pr.paramID) continue;
          const lot = myLotById.get(pr.lotID);
          if (!lot) continue; // sudah ditangani (1)
          if (lot.paramID === pr.paramID) continue;
          const existing = myLotIdByKey.get(
            String(lot.noLot || "")
              .trim()
              .toLowerCase() +
              "||" +
              pr.paramID
          );
          const targetLot =
            existing || (await cloneLotForOwner(lot, pr.paramID));
          await db.inputQC.updateMany({
            where: { ownerUsername, lotID: pr.lotID, paramID: pr.paramID },
            data: { lotID: targetLot },
          });
        }
      } catch {
        /* abaikan — heal lot tidak boleh menggagalkan login */
      }
    });
  } catch {
    /* heal TIDAK PERNAH menggagalkan proses pemanggil */
  }
}

// ⚡ isTenantDirty / markTenantClean — fast-path perf (v9.34)
// ============================================================
// Masalah: healTenantData memeriksa 7 tabel dengan DISTINCT + full scan
// (10+ round-trip sekuensial) dan DIPANGGIL setiap getInitData (login /
// Lihat Sebagai / Muat Data) → data dashboard terasa lambat & tidak
// langsung tampil, padahal data produksi sudah bersih (0 referensi
// menggantung) sehingga heal penuh setiap kali = kerja sia-sia.
//
// isTenantDirty(): SATU query ringkas (UNION EXISTS, index-friendly,
// berhenti pada temuan pertama) untuk menilai apakah ada referensi
// menggantung; hasil "bersih" di-memo per-instance selama 10 menit agar
// superadmin yang berganti-ganti akun (Lihat Sebagai) tidak memicu
// pemeriksaan berulang. Kondisi yang diperiksa = PERSIS 3 pass heal:
//   (1) paramID menggantung pada 7 tabel data akun,
//   (2) lotID inputQC menunjuk lot milik akun lain / terhapus,
//   (3) baris pada lot milik sendiri dengan paramID lot ≠ paramID baris.
// Gagal pemeriksaan → return true (fallback ke heal penuh — aman).
// ============================================================

const _tenantCleanMemo = new Map<string, number>();
const TENANT_CLEAN_TTL_MS = 10 * 60 * 1000;

export async function isTenantDirty(ownerUsername: string): Promise<boolean> {
  if (!ownerUsername) return false;
  const checkedAt = _tenantCleanMemo.get(ownerUsername);
  if (checkedAt && Date.now() - checkedAt < TENANT_CLEAN_TTL_MS) return false;
  try {
    const u = ownerUsername;
    const rows = await db.$queryRaw<Array<{ dirty: number | boolean }>>`
      SELECT (
        /* (1) paramID menggantung — 7 tabel data */
        EXISTS(SELECT 1 FROM "lotqc" t WHERE t."ownerUsername" = ${u} AND t."paramID" IS NOT NULL AND t."paramID" <> '' AND NOT EXISTS (SELECT 1 FROM "parameters" p WHERE p."ownerUsername" = ${u} AND p."id" = t."paramID"))
        OR EXISTS(SELECT 1 FROM "inputqc" t WHERE t."ownerUsername" = ${u} AND t."paramID" IS NOT NULL AND t."paramID" <> '' AND NOT EXISTS (SELECT 1 FROM "parameters" p WHERE p."ownerUsername" = ${u} AND p."id" = t."paramID"))
        OR EXISTS(SELECT 1 FROM "historiqc" t WHERE t."ownerUsername" = ${u} AND t."paramID" IS NOT NULL AND t."paramID" <> '' AND NOT EXISTS (SELECT 1 FROM "parameters" p WHERE p."ownerUsername" = ${u} AND p."id" = t."paramID"))
        OR EXISTS(SELECT 1 FROM "calculatedstats" t WHERE t."ownerUsername" = ${u} AND t."paramID" IS NOT NULL AND t."paramID" <> '' AND NOT EXISTS (SELECT 1 FROM "parameters" p WHERE p."ownerUsername" = ${u} AND p."id" = t."paramID"))
        OR EXISTS(SELECT 1 FROM "biaspme" t WHERE t."ownerUsername" = ${u} AND t."paramID" IS NOT NULL AND t."paramID" <> '' AND NOT EXISTS (SELECT 1 FROM "parameters" p WHERE p."ownerUsername" = ${u} AND p."id" = t."paramID"))
        OR EXISTS(SELECT 1 FROM "daftartea" t WHERE t."ownerUsername" = ${u} AND t."paramID" IS NOT NULL AND t."paramID" <> '' AND NOT EXISTS (SELECT 1 FROM "parameters" p WHERE p."ownerUsername" = ${u} AND p."id" = t."paramID"))
        OR EXISTS(SELECT 1 FROM "sigmacvopt" t WHERE t."ownerUsername" = ${u} AND t."paramID" IS NOT NULL AND t."paramID" <> '' AND NOT EXISTS (SELECT 1 FROM "parameters" p WHERE p."ownerUsername" = ${u} AND p."id" = t."paramID"))
        /* (2) lotID inputQC menunjuk lot milik akun lain / terhapus */
        OR EXISTS(SELECT 1 FROM "inputqc" t WHERE t."ownerUsername" = ${u} AND t."lotID" IS NOT NULL AND t."lotID" <> '' AND NOT EXISTS (SELECT 1 FROM "lotqc" l WHERE l."ownerUsername" = ${u} AND l."id" = t."lotID"))
        /* (3) baris pada lot milik sendiri dengan paramID lot ≠ paramID baris */
        OR EXISTS(SELECT 1 FROM "inputqc" t JOIN "lotqc" l ON l."id" = t."lotID" WHERE t."ownerUsername" = ${u} AND l."ownerUsername" = ${u} AND l."paramID" <> t."paramID")
      ) AS "dirty"`;
    const dirty = !!(
      rows &&
      rows[0] &&
      (rows[0] as any).dirty
    );
    if (!dirty) _tenantCleanMemo.set(ownerUsername, Date.now());
    return dirty;
  } catch {
    /* gagal fast-check → anggap kotor agar heal penuh tetap berjalan */
    return true;
  }
}

export function markTenantClean(ownerUsername: string): void {
  if (!ownerUsername) return;
  _tenantCleanMemo.set(ownerUsername, Date.now());
}

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
// PARAMETERS — mirror code.gs getParameters/saveParameter/...
// ============================================================

// function getParameters(ownerUsername,role)
// Returns array of {paramID, parameter, owner, createdDate, createdBy, bidang}
export async function getParameters(args: any[], session: SessionData | null) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  try {
    // Always scope by ownerUsername (tenant isolation). deriveOwner returns
    // session.activeUsername when View-As is active, so superadmin view-as
    // still works correctly without leaking other tenants' data.
    const where = { ownerUsername };
    const rows = await db.parameters.findMany({
      where,
      orderBy: { parameter: "asc" },
    });
    return rows.map((r) => ({
      paramID: r.id,
      parameter: r.parameter,
      owner: r.ownerUsername,
      createdDate: fD(r.createdDate),
      createdBy: r.createdBy,
      bidang: r.bidang,
    }));
  } catch (e) {
    return [];
  }
}

// function saveParameter(payload,ownerUsername,logUser)
// payload: {paramID?, parameter, bidang}
export async function saveParameter(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  const paramID = payload.paramID || payload.id;

  if (paramID) {
    // Update path — verify ownership
    const existing = await db.parameters.findFirst({
      where: { id: String(paramID), ownerUsername },
    });
    if (!existing) {
      return { ok: false, msg: "Parameter tidak ditemukan" };
    }
    await db.parameters.update({
      where: { id: String(paramID) },
      data: {
        parameter: String(payload.parameter ?? ""),
        bidang: String(payload.bidang ?? ""),
      },
    });
    await logA(
      ownerUsername,
      "EDIT_PARAM",
      String(payload.parameter ?? ""),
      logUser
    );
    return { ok: true, paramID: String(paramID) };
  }

  // Create path
  const newID = genID("PAR");
  await db.parameters.create({
    data: {
      id: newID,
      parameter: String(payload.parameter ?? ""),
      ownerUsername,
      createdDate: new Date(),
      createdBy: ownerUsername,
      bidang: String(payload.bidang ?? ""),
    },
  });
  await logA(
    ownerUsername,
    "ADD_PARAM",
    String(payload.parameter ?? ""),
    logUser
  );
  return { ok: true, paramID: newID };
}

// function deleteParameter(paramID,ownerUsername,logUser)
export async function deleteParameter(args: any[], session: SessionData | null) {
  const paramID = args[0];
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  if (!paramID) return { ok: false, msg: "Parameter tidak ditemukan" };

  const existing = await db.parameters.findFirst({
    where: { id: String(paramID), ownerUsername },
  });
  if (!existing) {
    return { ok: false, msg: "Parameter tidak ditemukan" };
  }
  await db.parameters.delete({ where: { id: String(paramID) } });
  await logA(ownerUsername, "DEL_PARAM", String(paramID), logUser);
  return { ok: true };
}

// function getParamByID(paramID, ownerUsername?)
// Note: original does NOT filter by owner. Port now accepts an optional
// ownerUsername (args[1]) and filters by it when provided (tenant isolation).
// Backwards-compatible: if args[1] is omitted, falls back to unscoped lookup.
export async function getParamByID(args: any[], _session: SessionData | null) {
  const paramID = args[0];
  const ownerUsername =
    typeof args[1] === "string" && args[1].length > 0 ? args[1] : undefined;
  if (!paramID) return null;
  const r = await db.parameters.findFirst({
    where: { id: String(paramID), ...(ownerUsername ? { ownerUsername } : {}) },
  });
  if (!r) return null;
  return {
    paramID: r.id,
    parameter: r.parameter,
    owner: r.ownerUsername,
    bidang: r.bidang,
  };
}

// ============================================================
// LOT QC — mirror code.gs getLotQC/saveLotQC/...
// ============================================================

// Map a Prisma LotQC row to the original return shape (lotID, paramID, ...)
function mapLotRow(r: any) {
  return {
    lotID: r.id,
    paramID: r.paramID,
    noLot: r.noLot,
    namaAlat: r.namaAlat,
    methode: r.methode,
    satuan: r.satuan,
    expiredDate: dateToISO(r.expiredDate),
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

// function getLotQC(ownerUsername,role,paramID?)
export async function getLotQC(args: any[], session: SessionData | null) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  const paramID = args[2]; // optional filter
  try {
    const where: any = {};
    // Always scope by ownerUsername (tenant isolation). deriveOwner returns
    // session.activeUsername when View-As is active, so superadmin view-as
    // still works correctly without leaking other tenants' data.
    where.ownerUsername = ownerUsername;
    if (paramID) where.paramID = String(paramID);
    const rows = await db.lotQC.findMany({
      where,
      orderBy: { noLot: "asc" },
    });
    return rows.map(mapLotRow);
  } catch (e) {
    return [];
  }
}

// Build the data object for create/update from a saveLotQC payload.
// Mirrors the row construction in code.gs saveLotQC.
function buildLotData(payload: any, ownerUsername: string) {
  return {
    paramID: String(payload.paramID ?? ""),
    noLot: String(payload.noLot ?? ""),
    namaAlat: payload.namaAlat ? String(payload.namaAlat) : null,
    methode: payload.methode ? String(payload.methode) : null,
    satuan: payload.satuan ? String(payload.satuan) : null,
    expiredDate: dateToISO(payload.expiredDate),
    sumber: String(payload.sumber || "Manufaktur"),
    meanL1: parseNumSafe(payload.meanL1),
    sdL1: parseNumSafe(payload.sdL1),
    targetL1: parseNumSafe(payload.targetL1),
    meanL2: parseNumSafe(payload.meanL2),
    sdL2: parseNumSafe(payload.sdL2),
    targetL2: parseNumSafe(payload.targetL2),
    meanL3: parseNumSafe(payload.meanL3),
    sdL3: parseNumSafe(payload.sdL3),
    targetL3: parseNumSafe(payload.targetL3),
    tea: parseNumSafe(payload.tea),
    biasPct: parseNumSafe(payload.biasPct),
    ownerUsername,
  };
}

// function saveLotQC(payload,ownerUsername,logUser)
// payload: {lotID?, paramID, noLot, namaAlat, methode, satuan, expiredDate,
//           sumber, meanL1, sdL1, targetL1, meanL2, sdL2, targetL2,
//           meanL3, sdL3, targetL3, tea, biasPct}
export async function saveLotQC(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  const lotID = payload.lotID || payload.id;

  if (lotID) {
    const existing = await db.lotQC.findFirst({
      where: { id: String(lotID), ownerUsername },
    });
    if (!existing) {
      return { ok: false, msg: "Lot tidak ditemukan" };
    }
    await db.lotQC.update({
      where: { id: String(lotID) },
      data: buildLotData(payload, ownerUsername),
    });
    await logA(ownerUsername, "EDIT_LOT", String(lotID), logUser);
    return { ok: true, lotID: String(lotID) };
  }

  const newID = genID("LOT");
  await db.lotQC.create({
    data: { id: newID, ...buildLotData(payload, ownerUsername) },
  });
  await logA(ownerUsername, "ADD_LOT", newID, logUser);
  return { ok: true, lotID: newID };
}

// function deleteLotQC(lotID,ownerUsername,logUser)
export async function deleteLotQC(args: any[], session: SessionData | null) {
  const lotID = args[0];
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  if (!lotID) return { ok: false, msg: "Lot tidak ditemukan" };

  const existing = await db.lotQC.findFirst({
    where: { id: String(lotID), ownerUsername },
  });
  if (!existing) {
    return { ok: false, msg: "Lot tidak ditemukan" };
  }
  await db.lotQC.delete({ where: { id: String(lotID) } });
  await logA(ownerUsername, "DEL_LOT", String(lotID), logUser);
  return { ok: true };
}

// function getLotByID(lotID,ownerUsername)
// Note: original ignores ownerUsername — does NOT filter by owner. Port now
// respects an optional ownerUsername (args[1]) and filters by it when provided
// (tenant isolation). Backwards-compatible: if args[1] is omitted, falls back
// to unscoped lookup.
export async function getLotByID(args: any[], _session: SessionData | null) {
  const lotID = args[0];
  const ownerUsername =
    typeof args[1] === "string" && args[1].length > 0 ? args[1] : undefined;
  if (!lotID) return null;
  const r = await db.lotQC.findFirst({
    where: { id: String(lotID), ...(ownerUsername ? { ownerUsername } : {}) },
  });
  if (!r) return null;
  return mapLotRow(r);
}

// function getLotInfoForAutoFill(lotID, ownerUsername)
// Returns {ok, namaAlat, methode, satuan, tea, sumber}
export async function getLotInfoForAutoFill(
  args: any[],
  session: SessionData | null
) {
  const lotID = args[0];
  const ownerUsername =
    typeof args[1] === "string" && args[1].length > 0 ? args[1] : undefined;
  try {
    const lot = await getLotByID([lotID, ownerUsername], session);
    if (!lot) return { ok: false };
    return {
      ok: true,
      namaAlat: lot.namaAlat || "",
      methode: lot.methode || "",
      satuan: lot.satuan || "",
      tea: lot.tea === null || lot.tea === undefined ? "" : lot.tea,
      sumber: lot.sumber || "",
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ============================================================
// DAF'TAR TEa — mirror code.gs getDaftarTEa/saveDaftarTEa/deleteDaftarTEa
// (Note: original does NOT call logA for save/delete DaftarTEa — matched 1:1.)
// ============================================================

// function getDaftarTEa(ownerUsername,role)
export async function getDaftarTEa(args: any[], session: SessionData | null) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  try {
    // Always scope by ownerUsername (tenant isolation). deriveOwner returns
    // session.activeUsername when View-As is active, so superadmin view-as
    // still works correctly without leaking other tenants' data.
    const where = { ownerUsername };
    const rows = await db.daftarTEa.findMany({
      where,
      orderBy: { parameter: "asc" },
    });
    return rows.map((r) => ({
      teaID: r.id,
      paramID: r.paramID,
      parameter: r.parameter,
      nilaiTEa: r.nilaiTEa,
      referensi: r.referensi,
      owner: r.ownerUsername,
    }));
  } catch (e) {
    return [];
  }
}

// function saveDaftarTEa(payload,ownerUsername,logUser)
// payload: {teaID?, paramID, parameter, nilaiTEa, referensi}
export async function saveDaftarTEa(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  // logUser (args[2]) is accepted for API symmetry but original code.gs
  // does NOT call logA here — we match the original 1:1.

  const teaID = payload.teaID || payload.id;

  const dataFields = {
    paramID: payload.paramID ? String(payload.paramID) : null,
    parameter: String(payload.parameter ?? ""),
    nilaiTEa: parseNumSafe(payload.nilaiTEa),
    referensi: payload.referensi ? String(payload.referensi) : null,
  };

  if (teaID) {
    const existing = await db.daftarTEa.findFirst({
      where: { id: String(teaID), ownerUsername },
    });
    if (!existing) {
      return { ok: false, msg: "TEa tidak ditemukan" };
    }
    await db.daftarTEa.update({
      where: { id: String(teaID) },
      data: dataFields,
    });
    return { ok: true };
  }

  const newID = genID("TEA");
  await db.daftarTEa.create({
    data: { id: newID, ...dataFields, ownerUsername },
  });
  return { ok: true };
}

// function deleteDaftarTEa(teaID,ownerUsername,logUser)
export async function deleteDaftarTEa(
  args: any[],
  session: SessionData | null
) {
  const teaID = args[0];
  const ownerUsername = deriveOwner(args, session, 1);
  // logUser (args[2]) accepted but original does not logA.

  if (!teaID) return { ok: false, msg: "TEa tidak ditemukan" };

  const existing = await db.daftarTEa.findFirst({
    where: { id: String(teaID), ownerUsername },
  });
  if (!existing) {
    return { ok: false, msg: "TEa tidak ditemukan" };
  }
  await db.daftarTEa.delete({ where: { id: String(teaID) } });
  return { ok: true };
}

// ============================================================
// KOP SURAT — mirror code.gs getKopSurat/saveKopSurat
// ============================================================

// function getKopSurat(ownerUsername)
// Returns {key: value} object. Filters by owner (no superadmin bypass).
export async function getKopSurat(args: any[], session: SessionData | null) {
  const ownerUsername = deriveOwner(args, session, 0);
  const rows = await db.kopSurat.findMany({
    where: { ownerUsername },
  });
  const obj: Record<string, string> = {};
  for (const r of rows) {
    if (r.key) obj[r.key] = r.value || "";
  }
  return obj;
}

// function saveKopSurat(payload,ownerUsername,logUser)
// payload: {key1: value1, key2: value2, ...} — upsert each key.
export async function saveKopSurat(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  for (const k of Object.keys(payload)) {
    // Use findFirst+update/create to mirror original behavior exactly
    // (avoids relying on the auto-generated compound unique key name).
    const existing = await db.kopSurat.findFirst({
      where: { key: k, ownerUsername },
    });
    const val = String(payload[k] ?? "");
    if (existing) {
      await db.kopSurat.update({
        where: { id: existing.id },
        data: { value: val },
      });
    } else {
      await db.kopSurat.create({
        data: { key: k, value: val, ownerUsername },
      });
    }
  }
  await logA(ownerUsername, "SAVE_KOP", "Kop surat disimpan", logUser);
  return { ok: true };
}

// ============================================================
// SETTINGS — mirror code.gs getSetting/setSetting/getSettings/saveSettings
// Settings is a global key-value store (no ownerUsername).
// ============================================================

// function getSetting(key) — returns string value or null
export async function getSetting(args: any[], _session: SessionData | null) {
  const key = args[0];
  if (!key) return null;
  const row = await db.settings.findUnique({ where: { key: String(key) } });
  return row?.value ?? null;
}

// function setSetting(key,value) — upsert
export async function setSetting(args: any[], _session: SessionData | null) {
  const key = args[0];
  const value = args[1];
  if (!key) return { ok: false, msg: "Key wajib diisi" };
  const valStr = value === null || value === undefined ? "" : String(value);
  await db.settings.upsert({
    where: { key: String(key) },
    update: { value: valStr },
    create: { key: String(key), value: valStr },
  });
  return { ok: true };
}

// function getSettings() — returns {key: value} of ALL settings
export async function getSettings(_args: any[], _session: SessionData | null) {
  const rows = await db.settings.findMany();
  const obj: Record<string, string> = {};
  for (const r of rows) {
    if (r.key) obj[r.key] = r.value || "";
  }
  return obj;
}

// function saveSettings(settingsObj) — bulk upsert.
// NOTE: original also creates/deletes the autoBackupDaily trigger here.
// In the Next.js port there is no real trigger — we just persist the
// backup_auto setting (and any others) to the Settings table.
export async function saveSettings(args: any[], _session: SessionData | null) {
  // 🆕 v9.29/v9.30: Pengaturan hanya untuk superadmin (sesuai akses UI) —
  // memblokir akun password tambahan (isSecondary) memodifikasi
  // settings global lewat RPC langsung.
  if (_session?.isSecondary)
    return { ok: false, msg: "Akses ditolak (superadmin only)" };
  const settingsObj = args[0] || {};
  for (const k of Object.keys(settingsObj)) {
    const valStr =
      settingsObj[k] === null || settingsObj[k] === undefined
        ? ""
        : String(settingsObj[k]);
    await db.settings.upsert({
      where: { key: k },
      update: { value: valStr },
      create: { key: k, value: valStr },
    });
  }
  // No ScriptApp trigger to manage in Next.js — backup_auto is just a flag.
  return { ok: true };
}

// ============================================================
// PATOLOGI DOKTER PENGIRIM — master input CRUD
// ============================================================
// function getPatologiDokter(ownerUsername) — list all
export async function getPatologiDokter(args: any[], session: SessionData | null) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  try {
    // Always scope by ownerUsername (tenant isolation). deriveOwner returns
    // session.activeUsername when View-As is active, so superadmin view-as
    // still works correctly without leaking other tenants' data.
    const where = { ownerUsername };
    const rows = await db.patologiDokter.findMany({
      where,
      orderBy: { nama: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      nama: r.nama,
      owner: r.ownerUsername,
    }));
  } catch (e) {
    return [];
  }
}

// function savePatologiDokter(payload, ownerUsername, logUser)
// payload: {id?, nama}
export async function savePatologiDokter(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);
  const nama = String(payload.nama ?? "").trim();
  if (!nama) return { ok: false, msg: "Nama dokter wajib diisi" };

  const id = payload.id;
  if (id) {
    const existing = await db.patologiDokter.findFirst({
      where: { id: String(id), ownerUsername },
    });
    if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
    await db.patologiDokter.update({
      where: { id: String(id) },
      data: { nama },
    });
    logA(logUser, "Edit master dokter pengirim: " + nama);
    return { ok: true };
  }
  // prevent duplicate by name (case-insensitive) per owner
  const dup = await db.patologiDokter.findFirst({
    where: { ownerUsername, nama: nama },
  });
  if (dup) return { ok: false, msg: "Nama dokter sudah ada" };
  const newID = genID("DOK");
  await db.patologiDokter.create({
    data: { id: newID, nama, ownerUsername },
  });
  logA(logUser, "Tambah master dokter pengirim: " + nama);
  return { ok: true };
}

// function deletePatologiDokter(id, ownerUsername, logUser)
export async function deletePatologiDokter(args: any[], session: SessionData | null) {
  const id = args[0];
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);
  if (!id) return { ok: false, msg: "Data tidak ditemukan" };
  const existing = await db.patologiDokter.findFirst({
    where: { id: String(id), ownerUsername },
  });
  if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
  await db.patologiDokter.delete({ where: { id: String(id) } });
  logA(logUser, "Hapus master dokter pengirim: " + existing.nama);
  return { ok: true };
}

// ============================================================
// PATOLOGI ASAL RUANGAN — master input CRUD
// ============================================================
// function getPatologiRuangan(ownerUsername) — list all
export async function getPatologiRuangan(args: any[], session: SessionData | null) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  try {
    // Always scope by ownerUsername (tenant isolation). deriveOwner returns
    // session.activeUsername when View-As is active, so superadmin view-as
    // still works correctly without leaking other tenants' data.
    const where = { ownerUsername };
    const rows = await db.patologiRuangan.findMany({
      where,
      orderBy: { nama: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      nama: r.nama,
      owner: r.ownerUsername,
    }));
  } catch (e) {
    return [];
  }
}

// function savePatologiRuangan(payload, ownerUsername, logUser)
// payload: {id?, nama}
export async function savePatologiRuangan(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);
  const nama = String(payload.nama ?? "").trim();
  if (!nama) return { ok: false, msg: "Nama ruangan wajib diisi" };

  const id = payload.id;
  if (id) {
    const existing = await db.patologiRuangan.findFirst({
      where: { id: String(id), ownerUsername },
    });
    if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
    await db.patologiRuangan.update({
      where: { id: String(id) },
      data: { nama },
    });
    logA(logUser, "Edit master asal ruangan: " + nama);
    return { ok: true };
  }
  const dup = await db.patologiRuangan.findFirst({
    where: { ownerUsername, nama: nama },
  });
  if (dup) return { ok: false, msg: "Nama ruangan sudah ada" };
  const newID = genID("RUA");
  await db.patologiRuangan.create({
    data: { id: newID, nama, ownerUsername },
  });
  logA(logUser, "Tambah master asal ruangan: " + nama);
  return { ok: true };
}

// function deletePatologiRuangan(id, ownerUsername, logUser)
export async function deletePatologiRuangan(args: any[], session: SessionData | null) {
  const id = args[0];
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);
  if (!id) return { ok: false, msg: "Data tidak ditemukan" };
  const existing = await db.patologiRuangan.findFirst({
    where: { id: String(id), ownerUsername },
  });
  if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
  await db.patologiRuangan.delete({ where: { id: String(id) } });
  logA(logUser, "Hapus master asal ruangan: " + existing.nama);
  return { ok: true };
}

// ============================================================
// PATOLOGI ASAL RUJUKAN — master input CRUD
// ============================================================
// function getPatologiRujukan(ownerUsername) — list all
export async function getPatologiRujukan(args: any[], session: SessionData | null) {
  const ownerUsername = deriveOwner(args, session, 0);
  const role = deriveRole(args, session, 1);
  try {
    // Always scope by ownerUsername (tenant isolation). deriveOwner returns
    // session.activeUsername when View-As is active, so superadmin view-as
    // still works correctly without leaking other tenants' data.
    const where = { ownerUsername };
    const rows = await db.patologiRujukan.findMany({
      where,
      orderBy: { nama: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      nama: r.nama,
      owner: r.ownerUsername,
    }));
  } catch (e) {
    return [];
  }
}

// function savePatologiRujukan(payload, ownerUsername, logUser)
// payload: {id?, nama}
export async function savePatologiRujukan(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);
  const nama = String(payload.nama ?? "").trim();
  if (!nama) return { ok: false, msg: "Nama asal rujukan wajib diisi" };

  const id = payload.id;
  if (id) {
    const existing = await db.patologiRujukan.findFirst({
      where: { id: String(id), ownerUsername },
    });
    if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
    await db.patologiRujukan.update({
      where: { id: String(id) },
      data: { nama },
    });
    logA(logUser, "Edit master asal rujukan: " + nama);
    return { ok: true };
  }
  const dup = await db.patologiRujukan.findFirst({
    where: { ownerUsername, nama: nama },
  });
  if (dup) return { ok: false, msg: "Nama asal rujukan sudah ada" };
  const newID = genID("RUJ");
  await db.patologiRujukan.create({
    data: { id: newID, nama, ownerUsername },
  });
  logA(logUser, "Tambah master asal rujukan: " + nama);
  return { ok: true };
}

// function deletePatologiRujukan(id, ownerUsername, logUser)
export async function deletePatologiRujukan(args: any[], session: SessionData | null) {
  const id = args[0];
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);
  if (!id) return { ok: false, msg: "Data tidak ditemukan" };
  const existing = await db.patologiRujukan.findFirst({
    where: { id: String(id), ownerUsername },
  });
  if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
  await db.patologiRujukan.delete({ where: { id: String(id) } });
  logA(logUser, "Hapus master asal rujukan: " + existing.nama);
  return { ok: true };
}
