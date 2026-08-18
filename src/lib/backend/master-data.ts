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
