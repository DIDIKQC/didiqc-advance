// ============================================================
// Multi Master module — daftar master global
// Dibuat oleh superadmin, dilihat oleh semua user (global, tidak per-owner)
//
// 5 master tables:
// - MasterParameter (daftar parameter)
// - MasterAlat (daftar alat/instrumen)
// - MasterMetode (daftar metode)
// - MasterSatuan (daftar satuan)
// - MasterTEa (daftar referensi TEa)
//
// Get handlers: authenticated (any user can read)
// Save/Delete handlers: superadmin only
// ============================================================

import { db } from "@/lib/db";
import {
  genID,
  logA,
  fD,
  nowISO,
} from "@/lib/utils-server";
import type { SessionData } from "@/lib/session";

function requireSuperadmin(session: SessionData | null): boolean {
  return !!session && session.role === "superadmin";
}

function deriveOwner(args: any[], session: SessionData | null, idx: number): string {
  return (args[idx] as string) || session?.username || "";
}

function deriveLogUser(args: any[], session: SessionData | null, idx: number): string {
  return (args[idx] as string) || session?.loginUsername || session?.username || "";
}

// ============================================================
// MASTER PARAMETER
// ============================================================
export async function getMasterParameters(_args: any[], _session: SessionData | null) {
  try {
    const rows = await db.masterParameter.findMany({ orderBy: { parameter: "asc" } });
    return rows.map((r) => ({
      id: r.id,
      parameter: r.parameter,
      bidang: r.bidang || "",
      ownerUsername: r.ownerUsername,
      createdDate: fD(r.createdDate),
      createdBy: r.createdBy,
    }));
  } catch (e: any) {
    console.error("getMasterParameters error:", e);
    return [];
  }
}

export async function saveMasterParameter(args: any[], session: SessionData | null) {
  if (!requireSuperadmin(session)) return { ok: false, msg: "Akses ditolak (superadmin only)" };
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  if (!payload.parameter) return { ok: false, msg: "Parameter wajib diisi" };

  try {
    if (payload.id) {
      const existing = await db.masterParameter.findUnique({ where: { id: payload.id } });
      if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
      await db.masterParameter.update({
        where: { id: payload.id },
        data: {
          parameter: String(payload.parameter).trim(),
          bidang: payload.bidang ? String(payload.bidang).trim() : null,
        },
      });
      await logA(ownerUsername, "EDIT_MASTER_PARAM", "Edit master parameter: " + payload.parameter, logUser);
      return { ok: true };
    }

    // Check duplicate
    const dup = await db.masterParameter.findFirst({
      where: { parameter: { equals: String(payload.parameter).trim() } },
    });
    if (dup) return { ok: false, msg: "Parameter sudah ada di daftar master" };

    await db.masterParameter.create({
      data: {
        id: genID("MPAR"),
        parameter: String(payload.parameter).trim(),
        bidang: payload.bidang ? String(payload.bidang).trim() : null,
        ownerUsername,
        createdBy: ownerUsername,
      },
    });
    await logA(ownerUsername, "ADD_MASTER_PARAM", "Tambah master parameter: " + payload.parameter, logUser);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

export async function deleteMasterParameter(args: any[], session: SessionData | null) {
  if (!requireSuperadmin(session)) return { ok: false, msg: "Akses ditolak (superadmin only)" };
  const id = args[0];
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  try {
    const existing = await db.masterParameter.findUnique({ where: { id } });
    if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
    await db.masterParameter.delete({ where: { id } });
    await logA(ownerUsername, "DEL_MASTER_PARAM", "Hapus master parameter: " + existing.parameter, logUser);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// MASTER ALAT
// ============================================================
export async function getMasterAlat(_args: any[], _session: SessionData | null) {
  try {
    const rows = await db.masterAlat.findMany({ orderBy: { namaAlat: "asc" } });
    return rows.map((r) => ({
      id: r.id,
      namaAlat: r.namaAlat,
      ownerUsername: r.ownerUsername,
      createdDate: fD(r.createdDate),
      createdBy: r.createdBy,
    }));
  } catch (e: any) {
    console.error("getMasterAlat error:", e);
    return [];
  }
}

export async function saveMasterAlat(args: any[], session: SessionData | null) {
  if (!requireSuperadmin(session)) return { ok: false, msg: "Akses ditolak (superadmin only)" };
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  if (!payload.namaAlat) return { ok: false, msg: "Nama Alat wajib diisi" };

  try {
    if (payload.id) {
      const existing = await db.masterAlat.findUnique({ where: { id: payload.id } });
      if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
      await db.masterAlat.update({
        where: { id: payload.id },
        data: { namaAlat: String(payload.namaAlat).trim() },
      });
      await logA(ownerUsername, "EDIT_MASTER_ALAT", "Edit master alat: " + payload.namaAlat, logUser);
      return { ok: true };
    }

    const dup = await db.masterAlat.findFirst({
      where: { namaAlat: { equals: String(payload.namaAlat).trim() } },
    });
    if (dup) return { ok: false, msg: "Alat sudah ada di daftar master" };

    await db.masterAlat.create({
      data: {
        id: genID("MAL"),
        namaAlat: String(payload.namaAlat).trim(),
        ownerUsername,
        createdBy: ownerUsername,
      },
    });
    await logA(ownerUsername, "ADD_MASTER_ALAT", "Tambah master alat: " + payload.namaAlat, logUser);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

export async function deleteMasterAlat(args: any[], session: SessionData | null) {
  if (!requireSuperadmin(session)) return { ok: false, msg: "Akses ditolak (superadmin only)" };
  const id = args[0];
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  try {
    const existing = await db.masterAlat.findUnique({ where: { id } });
    if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
    await db.masterAlat.delete({ where: { id } });
    await logA(ownerUsername, "DEL_MASTER_ALAT", "Hapus master alat: " + existing.namaAlat, logUser);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// MASTER METODE
// ============================================================
export async function getMasterMetode(_args: any[], _session: SessionData | null) {
  try {
    const rows = await db.masterMetode.findMany({ orderBy: { namaMetode: "asc" } });
    return rows.map((r) => ({
      id: r.id,
      namaMetode: r.namaMetode,
      ownerUsername: r.ownerUsername,
      createdDate: fD(r.createdDate),
      createdBy: r.createdBy,
    }));
  } catch (e: any) {
    console.error("getMasterMetode error:", e);
    return [];
  }
}

export async function saveMasterMetode(args: any[], session: SessionData | null) {
  if (!requireSuperadmin(session)) return { ok: false, msg: "Akses ditolak (superadmin only)" };
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  if (!payload.namaMetode) return { ok: false, msg: "Nama Metode wajib diisi" };

  try {
    if (payload.id) {
      const existing = await db.masterMetode.findUnique({ where: { id: payload.id } });
      if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
      await db.masterMetode.update({
        where: { id: payload.id },
        data: { namaMetode: String(payload.namaMetode).trim() },
      });
      await logA(ownerUsername, "EDIT_MASTER_METODE", "Edit master metode: " + payload.namaMetode, logUser);
      return { ok: true };
    }

    const dup = await db.masterMetode.findFirst({
      where: { namaMetode: { equals: String(payload.namaMetode).trim() } },
    });
    if (dup) return { ok: false, msg: "Metode sudah ada di daftar master" };

    await db.masterMetode.create({
      data: {
        id: genID("MMT"),
        namaMetode: String(payload.namaMetode).trim(),
        ownerUsername,
        createdBy: ownerUsername,
      },
    });
    await logA(ownerUsername, "ADD_MASTER_METODE", "Tambah master metode: " + payload.namaMetode, logUser);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

export async function deleteMasterMetode(args: any[], session: SessionData | null) {
  if (!requireSuperadmin(session)) return { ok: false, msg: "Akses ditolak (superadmin only)" };
  const id = args[0];
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  try {
    const existing = await db.masterMetode.findUnique({ where: { id } });
    if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
    await db.masterMetode.delete({ where: { id } });
    await logA(ownerUsername, "DEL_MASTER_METODE", "Hapus master metode: " + existing.namaMetode, logUser);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// MASTER SATUAN
// ============================================================
export async function getMasterSatuan(_args: any[], _session: SessionData | null) {
  try {
    const rows = await db.masterSatuan.findMany({ orderBy: { namaSatuan: "asc" } });
    return rows.map((r) => ({
      id: r.id,
      namaSatuan: r.namaSatuan,
      ownerUsername: r.ownerUsername,
      createdDate: fD(r.createdDate),
      createdBy: r.createdBy,
    }));
  } catch (e: any) {
    console.error("getMasterSatuan error:", e);
    return [];
  }
}

export async function saveMasterSatuan(args: any[], session: SessionData | null) {
  if (!requireSuperadmin(session)) return { ok: false, msg: "Akses ditolak (superadmin only)" };
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  if (!payload.namaSatuan) return { ok: false, msg: "Nama Satuan wajib diisi" };

  try {
    if (payload.id) {
      const existing = await db.masterSatuan.findUnique({ where: { id: payload.id } });
      if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
      await db.masterSatuan.update({
        where: { id: payload.id },
        data: { namaSatuan: String(payload.namaSatuan).trim() },
      });
      await logA(ownerUsername, "EDIT_MASTER_SATUAN", "Edit master satuan: " + payload.namaSatuan, logUser);
      return { ok: true };
    }

    const dup = await db.masterSatuan.findFirst({
      where: { namaSatuan: { equals: String(payload.namaSatuan).trim() } },
    });
    if (dup) return { ok: false, msg: "Satuan sudah ada di daftar master" };

    await db.masterSatuan.create({
      data: {
        id: genID("MST"),
        namaSatuan: String(payload.namaSatuan).trim(),
        ownerUsername,
        createdBy: ownerUsername,
      },
    });
    await logA(ownerUsername, "ADD_MASTER_SATUAN", "Tambah master satuan: " + payload.namaSatuan, logUser);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

export async function deleteMasterSatuan(args: any[], session: SessionData | null) {
  if (!requireSuperadmin(session)) return { ok: false, msg: "Akses ditolak (superadmin only)" };
  const id = args[0];
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  try {
    const existing = await db.masterSatuan.findUnique({ where: { id } });
    if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
    await db.masterSatuan.delete({ where: { id } });
    await logA(ownerUsername, "DEL_MASTER_SATUAN", "Hapus master satuan: " + existing.namaSatuan, logUser);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// MASTER TEa
// ============================================================
export async function getMasterTEa(_args: any[], _session: SessionData | null) {
  try {
    const rows = await db.masterTEa.findMany({ orderBy: { referensi: "asc" } });
    return rows.map((r) => ({
      id: r.id,
      referensi: r.referensi,
      ownerUsername: r.ownerUsername,
      createdDate: fD(r.createdDate),
      createdBy: r.createdBy,
    }));
  } catch (e: any) {
    console.error("getMasterTEa error:", e);
    return [];
  }
}

export async function saveMasterTEa(args: any[], session: SessionData | null) {
  if (!requireSuperadmin(session)) return { ok: false, msg: "Akses ditolak (superadmin only)" };
  const payload = args[0] || {};
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  if (!payload.referensi) return { ok: false, msg: "Referensi wajib diisi" };

  try {
    if (payload.id) {
      const existing = await db.masterTEa.findUnique({ where: { id: payload.id } });
      if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
      await db.masterTEa.update({
        where: { id: payload.id },
        data: { referensi: String(payload.referensi).trim() },
      });
      await logA(ownerUsername, "EDIT_MASTER_TEA", "Edit master TEa referensi: " + payload.referensi, logUser);
      return { ok: true };
    }

    const dup = await db.masterTEa.findFirst({
      where: { referensi: { equals: String(payload.referensi).trim() } },
    });
    if (dup) return { ok: false, msg: "Referensi sudah ada di daftar master" };

    await db.masterTEa.create({
      data: {
        id: genID("MTEA"),
        referensi: String(payload.referensi).trim(),
        ownerUsername,
        createdBy: ownerUsername,
      },
    });
    await logA(ownerUsername, "ADD_MASTER_TEA", "Tambah master TEa referensi: " + payload.referensi, logUser);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

export async function deleteMasterTEa(args: any[], session: SessionData | null) {
  if (!requireSuperadmin(session)) return { ok: false, msg: "Akses ditolak (superadmin only)" };
  const id = args[0];
  const ownerUsername = deriveOwner(args, session, 1);
  const logUser = deriveLogUser(args, session, 2);

  try {
    const existing = await db.masterTEa.findUnique({ where: { id } });
    if (!existing) return { ok: false, msg: "Data tidak ditemukan" };
    await db.masterTEa.delete({ where: { id } });
    await logA(ownerUsername, "DEL_MASTER_TEA", "Hapus master TEa referensi: " + existing.referensi, logUser);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// getAllMaster — returns all 5 master lists in one call (for app init)
// ============================================================
export async function getAllMaster(_args: any[], _session: SessionData | null) {
  try {
    const [params, alat, metode, satuan, tea] = await Promise.all([
      db.masterParameter.findMany({ orderBy: { parameter: "asc" } }),
      db.masterAlat.findMany({ orderBy: { namaAlat: "asc" } }),
      db.masterMetode.findMany({ orderBy: { namaMetode: "asc" } }),
      db.masterSatuan.findMany({ orderBy: { namaSatuan: "asc" } }),
      db.masterTEa.findMany({ orderBy: { referensi: "asc" } }),
    ]);
    return {
      ok: true,
      parameters: params.map((r) => ({ id: r.id, parameter: r.parameter, bidang: r.bidang || "" })),
      alat: alat.map((r) => ({ id: r.id, namaAlat: r.namaAlat })),
      metode: metode.map((r) => ({ id: r.id, namaMetode: r.namaMetode })),
      satuan: satuan.map((r) => ({ id: r.id, namaSatuan: r.namaSatuan })),
      tea: tea.map((r) => ({ id: r.id, referensi: r.referensi })),
    };
  } catch (e: any) {
    console.error("getAllMaster error:", e);
    return {
      ok: false,
      parameters: [],
      alat: [],
      metode: [],
      satuan: [],
      tea: [],
      error: e.message,
    };
  }
}
