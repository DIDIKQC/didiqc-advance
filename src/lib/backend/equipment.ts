// ============================================================
// equipment.ts — Equipment 360 (Laboratory Equipment Management System)
//
// Backend CRUD handlers untuk modul Manajemen Alat Lab.
// Entities:
//   - Equipment (master)
//   - EquipmentDocument
//   - EquipmentMaintenance
//   - EquipmentCalibration
//   - EquipmentBreakdown
//   - EquipmentContract
//   - EquipmentTraining
//   - EquipmentVendor
//   - EquipmentReagent
//   - EquipmentHistory (audit)
//
// Setiap fungsi menerima (args: any[], session: SessionData | null).
// - superadmin melihat semua data; user lain hanya miliknya sendiri.
// ============================================================

import { db } from "@/lib/db";
import type { SessionData } from "@/lib/session";
import { genID, logA, parseNumSafe } from "@/lib/utils-server";

// ============================================================
// Helpers
// ============================================================

function deriveOwner(args: any[], session: SessionData | null, idx: number): string {
  const fromArgs = args[idx];
  if (typeof fromArgs === "string" && fromArgs.length > 0) return fromArgs;
  if (session) {
    if ((session as any).activeUsername) return (session as any).activeUsername;
    return session.username;
  }
  return "unknown";
}

function deriveRole(args: any[], session: SessionData | null, idx: number): string {
  const fromArgs = args[idx];
  if (typeof fromArgs === "string" && fromArgs.length > 0) return fromArgs;
  if (session) {
    if ((session as any).activeRole) return (session as any).activeRole;
    return session.role;
  }
  return "user";
}

function deriveLogUser(args: any[], session: SessionData | null, idx: number): string {
  const fromArgs = args[idx];
  if (typeof fromArgs === "string" && fromArgs.length > 0) return fromArgs;
  if (session) {
    if (session.loginUsername) return session.loginUsername;
    return session.username;
  }
  return "unknown";
}

function ownerWhere(args: any[], session: SessionData | null, ownerIdx: number, roleIdx: number) {
  const owner = deriveOwner(args, session, ownerIdx);
  const role = deriveRole(args, session, roleIdx);
  return role === "superadmin" ? {} : { ownerUsername: owner };
}

// Helper: generate human-readable equipment ID
async function nextEquipmentId(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `EQ-${year}-`;
  // Count existing this year (rough; uses equipmentId startsWith)
  const rows = await db.equipment.findMany({
    where: { equipmentId: { startsWith: prefix } },
    select: { equipmentId: true },
  });
  let max = 0;
  for (const r of rows) {
    const m = r.equipmentId?.match(/EQ-\d{4}-(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

// ============================================================
// EQUIPMENT — Master
// ============================================================

export async function getEquipment(args: any[], session: SessionData | null) {
  const where = ownerWhere(args, session, 0, 1);
  const rows = await db.equipment.findMany({
    where,
    orderBy: { createdDate: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    equipmentId: r.equipmentId,
    assetNumber: r.assetNumber || "",
    nama: r.nama || "",
    brand: r.brand || "",
    model: r.model || "",
    serialNumber: r.serialNumber || "",
    tahun: r.tahun || "",
    lokasi: r.lokasi || "",
    pic: r.pic || "",
    status: r.status || "active",
    fotoURL: r.fotoURL || "",
    qrCode: r.qrCode || "",
    power: r.power || "",
    voltage: r.voltage || "",
    throughput: r.throughput || "",
    parameter: r.parameter || "",
    sampleVolume: r.sampleVolume || "",
    communication: r.communication || "",
    temperature: r.temperature || "",
    humidity: r.humidity || "",
    warrantyStart: r.warrantyStart || "",
    warrantyEnd: r.warrantyEnd || "",
    notes: r.notes || "",
    linkedParameters: r.linkedParameters || "",
    ownerUsername: r.ownerUsername,
    createdDate: r.createdDate ? r.createdDate.toISOString() : null,
    updatedDate: r.updatedDate ? r.updatedDate.toISOString() : null,
  }));
}

export async function getEquipmentByID(args: any[], session: SessionData | null) {
  const [id, ownerFromArgs, roleFromArgs] = args;
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const r = await db.equipment.findUnique({ where: { id: String(id) } });
  if (!r) return { ok: false, msg: "Alat tidak ditemukan" };
  if (role !== "superadmin" && r.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }
  return { ok: true, equipment: r };
}

export async function saveEquipment(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  const nama = String(payload.nama || "").trim();
  if (!nama) return { ok: false, msg: "Nama alat wajib diisi" };

  const data: any = {
    assetNumber: payload.assetNumber || null,
    nama,
    brand: payload.brand || null,
    model: payload.model || null,
    serialNumber: payload.serialNumber || null,
    tahun: payload.tahun || null,
    lokasi: payload.lokasi || null,
    pic: payload.pic || null,
    status: payload.status || "active",
    fotoURL: payload.fotoURL || null,
    qrCode: payload.qrCode || null,
    power: payload.power || null,
    voltage: payload.voltage || null,
    throughput: payload.throughput || null,
    parameter: payload.parameter || null,
    sampleVolume: payload.sampleVolume || null,
    communication: payload.communication || null,
    temperature: payload.temperature || null,
    humidity: payload.humidity || null,
    warrantyStart: payload.warrantyStart || null,
    warrantyEnd: payload.warrantyEnd || null,
    notes: payload.notes || null,
    linkedParameters: payload.linkedParameters || null,
    ownerUsername: owner,
  };

  if (payload.id) {
    // Update
    const existing = await db.equipment.findUnique({ where: { id: String(payload.id) } });
    if (!existing) return { ok: false, msg: "Alat tidak ditemukan" };
    if (role !== "superadmin" && existing.ownerUsername !== owner) {
      return { ok: false, msg: "Akses ditolak" };
    }
    const updated = await db.equipment.update({
      where: { id: String(payload.id) },
      data,
    });
    await db.equipmentHistory.create({
      data: {
        id: genID("EQHIS"),
        equipmentId: updated.id,
        action: "updated",
        detail: "Equipment updated",
        by: logUser,
      },
    });
    await logA(logUser, "EQUIPMENT_UPDATE", `Update alat: ${nama} (${updated.equipmentId})`);
    return { ok: true, equipment: updated };
  }

  // Create
  const equipmentId = await nextEquipmentId();
  const newId = genID("EQ");
  // Auto-generate QR token (use equipmentId as content)
  const qrToken = payload.qrCode || `EQID:${equipmentId}`;
  const created = await db.equipment.create({
    data: {
      ...data,
      id: newId,
      equipmentId,
      qrCode: qrToken,
    },
  });
  await db.equipmentHistory.create({
    data: {
      id: genID("EQHIS"),
      equipmentId: newId,
      action: "created",
      detail: "Equipment created",
      by: logUser,
    },
  });
  await logA(logUser, "EQUIPMENT_CREATE", `Tambah alat: ${nama} (${equipmentId})`);
  return { ok: true, equipment: created };
}

export async function deleteEquipment(args: any[], session: SessionData | null) {
  const [id, , ] = args;
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  const existing = await db.equipment.findUnique({ where: { id: String(id) } });
  if (!existing) return { ok: false, msg: "Alat tidak ditemukan" };
  if (role !== "superadmin" && existing.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }

  // Cascade delete related records
  await db.equipmentDocument.deleteMany({ where: { equipmentId: String(id) } });
  await db.equipmentMaintenance.deleteMany({ where: { equipmentId: String(id) } });
  await db.equipmentCalibration.deleteMany({ where: { equipmentId: String(id) } });
  await db.equipmentBreakdown.deleteMany({ where: { equipmentId: String(id) } });
  await db.equipmentContract.deleteMany({ where: { equipmentId: String(id) } });
  await db.equipmentTraining.deleteMany({ where: { equipmentId: String(id) } });
  await db.equipmentReagent.deleteMany({ where: { equipmentId: String(id) } });
  await db.equipmentHistory.deleteMany({ where: { equipmentId: String(id) } });
  await db.equipment.delete({ where: { id: String(id) } });

  await logA(logUser, "EQUIPMENT_DELETE", `Hapus alat: ${existing.nama} (${existing.equipmentId})`);
  return { ok: true };
}

export async function getEquipmentPassport(args: any[], session: SessionData | null) {
  const [id] = args;
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const eq = await db.equipment.findUnique({ where: { id: String(id) } });
  if (!eq) return { ok: false, msg: "Alat tidak ditemukan" };
  if (role !== "superadmin" && eq.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }
  const [documents, maintenance, calibration, breakdown, contracts, training, reagents, history] =
    await Promise.all([
      db.equipmentDocument.findMany({ where: { equipmentId: String(id) }, orderBy: { uploadDate: "desc" } }),
      db.equipmentMaintenance.findMany({ where: { equipmentId: String(id) }, orderBy: { date: "desc" } }),
      db.equipmentCalibration.findMany({ where: { equipmentId: String(id) }, orderBy: { date: "desc" } }),
      db.equipmentBreakdown.findMany({ where: { equipmentId: String(id) }, orderBy: { reportDate: "desc" } }),
      db.equipmentContract.findMany({ where: { equipmentId: String(id) }, orderBy: { endDate: "desc" } }),
      db.equipmentTraining.findMany({ where: { equipmentId: String(id) }, orderBy: { date: "desc" } }),
      db.equipmentReagent.findMany({ where: { equipmentId: String(id) }, orderBy: { expiryDate: "asc" } }),
      db.equipmentHistory.findMany({ where: { equipmentId: String(id) }, orderBy: { date: "desc" }, take: 50 }),
    ]);
  // Compute linked QC stats (Sigma L1/L2/L3)
  const linkedParamIDs = eq.linkedParameters
    ? eq.linkedParameters.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const qcStats = await computeLinkedQCStats(linkedParamIDs);
  return {
    ok: true,
    equipment: eq,
    documents,
    maintenance,
    calibration,
    breakdown,
    contracts,
    training,
    reagents,
    history,
    qcStats,
  };
}

// ============================================================
// PUBLIC Equipment Passport — no auth required (for QR code scanning)
// Returns limited public info (no sensitive cost/history data)
// ============================================================
export async function getEquipmentPassportPublic(args: any[], _session: SessionData | null) {
  const [id] = args;
  const eq = await db.equipment.findUnique({ where: { id: String(id) } });
  if (!eq) return { ok: false, msg: "Alat tidak ditemukan" };
  const [documents, maintenance, calibration, breakdown, reagents] =
    await Promise.all([
      db.equipmentDocument.findMany({
        where: { equipmentId: String(id), category: { in: ["SOP", "Manual", "IFU", "Sertifikat", "Kalibrasi"] } },
        orderBy: { uploadDate: "desc" },
        select: { category: true, title: true, fileName: true, fileURL: true, uploadDate: true },
      }),
      db.equipmentMaintenance.findMany({
        where: { equipmentId: String(id) },
        orderBy: { date: "desc" },
        select: { type: true, date: true, engineer: true, description: true, status: true, nextDate: true },
      }),
      db.equipmentCalibration.findMany({
        where: { equipmentId: String(id) },
        orderBy: { date: "desc" },
        select: { date: true, vendor: true, result: true, nextDate: true },
      }),
      db.equipmentBreakdown.findMany({
        where: { equipmentId: String(id) },
        orderBy: { reportDate: "desc" },
        select: { reportDate: true, problem: true, solution: true, status: true },
      }),
      db.equipmentReagent.findMany({
        where: { equipmentId: String(id) },
        orderBy: { expiryDate: "asc" },
        select: { name: true, lotNo: true, expiryDate: true, quantity: true, unit: true },
      }),
    ]);
  // Compute linked QC stats (Sigma L1/L2/L3)
  const linkedParamIDs = eq.linkedParameters
    ? eq.linkedParameters.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const qcStats = await computeLinkedQCStats(linkedParamIDs);
  return {
    ok: true,
    equipment: {
      id: eq.id,
      equipmentId: eq.equipmentId,
      assetNumber: eq.assetNumber,
      nama: eq.nama,
      brand: eq.brand,
      model: eq.model,
      serialNumber: eq.serialNumber,
      tahun: eq.tahun,
      lokasi: eq.lokasi,
      pic: eq.pic,
      status: eq.status,
      fotoURL: eq.fotoURL,
      qrCode: eq.qrCode,
      power: eq.power,
      voltage: eq.voltage,
      throughput: eq.throughput,
      parameter: eq.parameter,
      sampleVolume: eq.sampleVolume,
      communication: eq.communication,
      temperature: eq.temperature,
      humidity: eq.humidity,
      warrantyStart: eq.warrantyStart,
      warrantyEnd: eq.warrantyEnd,
      linkedParameters: eq.linkedParameters,
    },
    documents,
    maintenance,
    calibration,
    breakdown,
    reagents,
    qcStats,
  };
}

// ============================================================
// Helper: compute QC stats (Sigma L1/L2/L3) for linked parameters
// Reuses logic from calculations.ts getCalcStats
// ============================================================
async function computeLinkedQCStats(paramIDs: string[]): Promise<any[]> {
  if (!paramIDs.length) return [];
  try {
    const paramRows = await db.parameters.findMany({
      where: { id: { in: paramIDs } },
    });
    const paramMap: Record<string, string> = {};
    for (const p of paramRows) paramMap[p.id] = p.parameter;

    const lotRows = await db.lotQC.findMany({
      where: { paramID: { in: paramIDs } },
    });
    const lotMap: Record<string, any> = {};
    for (const l of lotRows) lotMap[l.id] = l;

    const statRows = await db.calculatedStats.findMany({
      where: { paramID: { in: paramIDs } },
      orderBy: [{ paramID: "asc" }, { lotID: "asc" }, { level: "asc" }],
    });

    // Group by paramID, pick latest stat per level
    const byParam: Record<string, Record<number, any>> = {};
    for (const r of statRows) {
      const lv = typeof r.level === "number" ? r.level : parseInt(String(r.level), 10) || 0;
      if (lv < 1 || lv > 3) continue;
      if (!byParam[r.paramID]) byParam[r.paramID] = {};
      // Keep the latest (last in array since ordered by nothing specific, but take first found)
      if (!byParam[r.paramID][lv]) {
        byParam[r.paramID][lv] = r;
      }
    }

    const result: any[] = [];
    for (const pid of paramIDs) {
      const lot = lotRows.find((l) => l.paramID === pid);
      const tea = lot ? parseNumSafe(lot.tea) : null;
      const levels = byParam[pid] || {};
      const item: any = {
        paramID: pid,
        parameter: paramMap[pid] || "(unknown)",
        noLot: lot ? lot.noLot : "",
        tea,
        L1: null as any,
        L2: null as any,
        L3: null as any,
      };
      for (const lv of [1, 2, 3]) {
        const s = levels[lv];
        if (!s) continue;
        const calcCV = s.calcCV;
        const calcMean = s.calcMean;
        const lotMean = lot
          ? lv === 1
            ? lot.meanL1
            : lv === 2
            ? lot.meanL2
            : lot.meanL3
          : null;
        let bias: number | null = null;
        if (calcMean && lotMean) {
          bias = parseFloat(
            (((calcMean - lotMean) / lotMean) * 100).toFixed(2)
          );
        }
        let sigma: number | null = null;
        if (tea !== null && calcCV) {
          // If bias is unknown, assume bias=0 (sigma = TEa / CV)
          const biasAbs = bias !== null ? Math.abs(bias) : 0;
          sigma = parseFloat(((tea - biasAbs) / calcCV).toFixed(2));
        }
        item["L" + lv] = {
          mean: calcMean,
          sd: s.calcSD,
          cv: calcCV,
          n: s.n,
          bias,
          sigma,
          startDate: s.startDate,
          endDate: s.endDate,
        };
      }
      result.push(item);
    }
    return result;
  } catch (e) {
    console.error("computeLinkedQCStats error:", e);
    return [];
  }
}

// ============================================================
// EQUIPMENT DASHBOARD
// ============================================================

export async function getEquipmentDashboard(args: any[], session: SessionData | null) {
  const where = ownerWhere(args, session, 0, 1);
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [total, active, breakdown, maintenanceDue, calibrationDue, contracts, warranty] =
    await Promise.all([
      db.equipment.count({ where }),
      db.equipment.count({ where: { ...where, status: "active" } }),
      db.equipment.count({ where: { ...where, status: "breakdown" } }),
      db.equipmentMaintenance.count({
        where: { ...where, nextDate: { gte: today, lte: in30 } },
      }),
      db.equipmentCalibration.count({
        where: { ...where, nextDate: { gte: today, lte: in30 } },
      }),
      db.equipmentContract.findMany({ where, select: { endDate: true, status: true } }),
      db.equipment.findMany({ where, select: { warrantyEnd: true } }),
    ]);

  const contractExpired = contracts.filter(
    (c) => c.endDate && c.endDate < today && c.status === "active"
  ).length;
  const warrantyExpired = warranty.filter(
    (w) => w.warrantyEnd && w.warrantyEnd < today
  ).length;

  // Status distribution
  const byStatus = await db.equipment.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });

  // By location
  const byLocation = await db.equipment.groupBy({
    by: ["lokasi"],
    where,
    _count: { _all: true },
  });

  // Maintenance trend (last 6 months)
  const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const maintRows = await db.equipmentMaintenance.findMany({
    where: { ...where, date: { gte: sixMonthsAgo } },
    select: { date: true, type: true },
  });
  const maintByMonth: Record<string, number> = {};
  for (const m of maintRows) {
    if (!m.date) continue;
    const k = m.date.slice(0, 7);
    maintByMonth[k] = (maintByMonth[k] || 0) + 1;
  }

  // Breakdown trend (last 6 months)
  const brkRows = await db.equipmentBreakdown.findMany({
    where: { ...where, reportDate: { gte: sixMonthsAgo } },
    select: { reportDate: true },
  });
  const brkByMonth: Record<string, number> = {};
  for (const b of brkRows) {
    if (!b.reportDate) continue;
    const k = b.reportDate.slice(0, 7);
    brkByMonth[k] = (brkByMonth[k] || 0) + 1;
  }

  return {
    ok: true,
    stats: {
      total,
      active,
      breakdown,
      maintenanceDue,
      calibrationDue,
      contractExpired,
      warrantyExpired,
      healthScore: total > 0 ? Math.round((active / total) * 100) : 100,
    },
    byStatus: byStatus.map((s) => ({ label: s.status || "unknown", count: s._count._all })),
    byLocation: byLocation.map((l) => ({ label: l.lokasi || "Tidak diketahui", count: l._count._all })),
    maintTrend: Object.entries(maintByMonth)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ month: k, count: v })),
    brkTrend: Object.entries(brkByMonth)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ month: k, count: v })),
  };
}

// ============================================================
// EQUIPMENT DOCUMENTS
// ============================================================

export async function getEquipmentDocuments(args: any[], session: SessionData | null) {
  const [equipmentId] = args;
  const where = ownerWhere(args, session, 1, 2);
  const filter: any = { ...where };
  if (equipmentId) filter.equipmentId = String(equipmentId);
  const rows = await db.equipmentDocument.findMany({
    where: filter,
    orderBy: { uploadDate: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    equipmentId: r.equipmentId,
    category: r.category || "",
    title: r.title || "",
    fileName: r.fileName || "",
    fileURL: r.fileURL || "",
    uploadedBy: r.uploadedBy || "",
    uploadDate: r.uploadDate ? r.uploadDate.toISOString() : null,
  }));
}

export async function saveEquipmentDocument(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  const title = String(payload.title || "").trim();
  if (!title) return { ok: false, msg: "Judul dokumen wajib diisi" };
  if (!payload.equipmentId) return { ok: false, msg: "Equipment ID wajib diisi" };

  // Verify ownership of parent equipment
  const eq = await db.equipment.findUnique({ where: { id: String(payload.equipmentId) } });
  if (!eq) return { ok: false, msg: "Alat tidak ditemukan" };
  if (role !== "superadmin" && eq.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }

  const data: any = {
    equipmentId: String(payload.equipmentId),
    category: payload.category || "Lainnya",
    title,
    fileName: payload.fileName || null,
    fileURL: payload.fileURL || null,
    uploadedBy: logUser,
    ownerUsername: owner,
  };

  if (payload.id) {
    const updated = await db.equipmentDocument.update({
      where: { id: String(payload.id) },
      data,
    });
    await logA(logUser, "EQDOC_UPDATE", `Update dokumen alat: ${title}`);
    return { ok: true, document: updated };
  }

  const created = await db.equipmentDocument.create({
    data: { ...data, id: genID("EQDOC") },
  });
  await db.equipmentHistory.create({
    data: {
      id: genID("EQHIS"),
      equipmentId: String(payload.equipmentId),
      action: "document_added",
      detail: `Document added: ${title} (${data.category})`,
      by: logUser,
    },
  });
  await logA(logUser, "EQDOC_CREATE", `Tambah dokumen alat: ${title}`);
  return { ok: true, document: created };
}

export async function deleteEquipmentDocument(args: any[], session: SessionData | null) {
  const [id] = args;
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  const existing = await db.equipmentDocument.findUnique({ where: { id: String(id) } });
  if (!existing) return { ok: false, msg: "Dokumen tidak ditemukan" };
  if (role !== "superadmin" && existing.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }
  await db.equipmentDocument.delete({ where: { id: String(id) } });
  await logA(logUser, "EQDOC_DELETE", `Hapus dokumen alat: ${existing.title}`);
  return { ok: true };
}

// ============================================================
// EQUIPMENT MAINTENANCE
// ============================================================

export async function getEquipmentMaintenance(args: any[], session: SessionData | null) {
  const [equipmentId] = args;
  const where = ownerWhere(args, session, 1, 2);
  const filter: any = { ...where };
  if (equipmentId) filter.equipmentId = String(equipmentId);
  const rows = await db.equipmentMaintenance.findMany({
    where: filter,
    orderBy: { date: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    equipmentId: r.equipmentId,
    type: r.type || "preventive",
    date: r.date || "",
    engineer: r.engineer || "",
    description: r.description || "",
    cost: r.cost ?? null,
    fotoURL: r.fotoURL || "",
    signatureURL: r.signatureURL || "",
    status: r.status || "done",
    nextDate: r.nextDate || "",
    ownerUsername: r.ownerUsername,
    createdDate: r.createdDate ? r.createdDate.toISOString() : null,
  }));
}

export async function saveEquipmentMaintenance(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  if (!payload.equipmentId) return { ok: false, msg: "Equipment ID wajib diisi" };

  const eq = await db.equipment.findUnique({ where: { id: String(payload.equipmentId) } });
  if (!eq) return { ok: false, msg: "Alat tidak ditemukan" };
  if (role !== "superadmin" && eq.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }

  const data: any = {
    equipmentId: String(payload.equipmentId),
    type: payload.type || "preventive",
    date: payload.date || null,
    engineer: payload.engineer || null,
    description: payload.description || null,
    cost: payload.cost != null && payload.cost !== "" ? parseNumSafe(payload.cost) : null,
    fotoURL: payload.fotoURL || null,
    signatureURL: payload.signatureURL || null,
    status: payload.status || "done",
    nextDate: payload.nextDate || null,
    ownerUsername: owner,
  };

  if (payload.id) {
    const updated = await db.equipmentMaintenance.update({
      where: { id: String(payload.id) },
      data,
    });
    await logA(logUser, "EQMNT_UPDATE", `Update maintenance alat: ${eq.nama}`);
    return { ok: true, maintenance: updated };
  }

  const created = await db.equipmentMaintenance.create({
    data: { ...data, id: genID("EQMNT") },
  });
  await db.equipmentHistory.create({
    data: {
      id: genID("EQHIS"),
      equipmentId: String(payload.equipmentId),
      action: "maintenance",
      detail: `Maintenance ${data.type}: ${data.description || "-"}`,
      by: logUser,
    },
  });
  await logA(logUser, "EQMNT_CREATE", `Tambah maintenance alat: ${eq.nama}`);
  return { ok: true, maintenance: created };
}

export async function deleteEquipmentMaintenance(args: any[], session: SessionData | null) {
  const [id] = args;
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  const existing = await db.equipmentMaintenance.findUnique({ where: { id: String(id) } });
  if (!existing) return { ok: false, msg: "Record tidak ditemukan" };
  if (role !== "superadmin" && existing.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }
  await db.equipmentMaintenance.delete({ where: { id: String(id) } });
  await logA(logUser, "EQMNT_DELETE", `Hapus maintenance record`);
  return { ok: true };
}

// ============================================================
// EQUIPMENT CALIBRATION
// ============================================================

export async function getEquipmentCalibration(args: any[], session: SessionData | null) {
  const [equipmentId] = args;
  const where = ownerWhere(args, session, 1, 2);
  const filter: any = { ...where };
  if (equipmentId) filter.equipmentId = String(equipmentId);
  const rows = await db.equipmentCalibration.findMany({
    where: filter,
    orderBy: { date: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    equipmentId: r.equipmentId,
    date: r.date || "",
    vendor: r.vendor || "",
    result: r.result || "",
    certificateURL: r.certificateURL || "",
    nextDate: r.nextDate || "",
    reminder: r.reminder || "",
    notes: r.notes || "",
    ownerUsername: r.ownerUsername,
    createdDate: r.createdDate ? r.createdDate.toISOString() : null,
  }));
}

export async function saveEquipmentCalibration(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  if (!payload.equipmentId) return { ok: false, msg: "Equipment ID wajib diisi" };

  const eq = await db.equipment.findUnique({ where: { id: String(payload.equipmentId) } });
  if (!eq) return { ok: false, msg: "Alat tidak ditemukan" };
  if (role !== "superadmin" && eq.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }

  const data: any = {
    equipmentId: String(payload.equipmentId),
    date: payload.date || null,
    vendor: payload.vendor || null,
    result: payload.result || null,
    certificateURL: payload.certificateURL || null,
    nextDate: payload.nextDate || null,
    reminder: payload.reminder || null,
    notes: payload.notes || null,
    ownerUsername: owner,
  };

  if (payload.id) {
    const updated = await db.equipmentCalibration.update({
      where: { id: String(payload.id) },
      data,
    });
    await logA(logUser, "EQCAL_UPDATE", `Update kalibrasi alat: ${eq.nama}`);
    return { ok: true, calibration: updated };
  }

  const created = await db.equipmentCalibration.create({
    data: { ...data, id: genID("EQCAL") },
  });
  await db.equipmentHistory.create({
    data: {
      id: genID("EQHIS"),
      equipmentId: String(payload.equipmentId),
      action: "calibration",
      detail: `Calibration on ${data.date || "-"}`,
      by: logUser,
    },
  });
  await logA(logUser, "EQCAL_CREATE", `Tambah kalibrasi alat: ${eq.nama}`);
  return { ok: true, calibration: created };
}

export async function deleteEquipmentCalibration(args: any[], session: SessionData | null) {
  const [id] = args;
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  const existing = await db.equipmentCalibration.findUnique({ where: { id: String(id) } });
  if (!existing) return { ok: false, msg: "Record tidak ditemukan" };
  if (role !== "superadmin" && existing.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }
  await db.equipmentCalibration.delete({ where: { id: String(id) } });
  await logA(logUser, "EQCAL_DELETE", `Hapus kalibrasi record`);
  return { ok: true };
}

// ============================================================
// EQUIPMENT BREAKDOWN
// ============================================================

export async function getEquipmentBreakdown(args: any[], session: SessionData | null) {
  const [equipmentId] = args;
  const where = ownerWhere(args, session, 1, 2);
  const filter: any = { ...where };
  if (equipmentId) filter.equipmentId = String(equipmentId);
  const rows = await db.equipmentBreakdown.findMany({
    where: filter,
    orderBy: { reportDate: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    equipmentId: r.equipmentId,
    reportDate: r.reportDate || "",
    technician: r.technician || "",
    problem: r.problem || "",
    solution: r.solution || "",
    startDate: r.startDate || "",
    endDate: r.endDate || "",
    status: r.status || "open",
    cost: r.cost ?? null,
    ownerUsername: r.ownerUsername,
    createdDate: r.createdDate ? r.createdDate.toISOString() : null,
  }));
}

export async function saveEquipmentBreakdown(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  if (!payload.equipmentId) return { ok: false, msg: "Equipment ID wajib diisi" };

  const eq = await db.equipment.findUnique({ where: { id: String(payload.equipmentId) } });
  if (!eq) return { ok: false, msg: "Alat tidak ditemukan" };
  if (role !== "superadmin" && eq.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }

  const data: any = {
    equipmentId: String(payload.equipmentId),
    reportDate: payload.reportDate || null,
    technician: payload.technician || null,
    problem: payload.problem || null,
    solution: payload.solution || null,
    startDate: payload.startDate || null,
    endDate: payload.endDate || null,
    status: payload.status || "open",
    cost: payload.cost != null && payload.cost !== "" ? parseNumSafe(payload.cost) : null,
    ownerUsername: owner,
  };

  if (payload.id) {
    const updated = await db.equipmentBreakdown.update({
      where: { id: String(payload.id) },
      data,
    });
    // If status changed to resolved, also update equipment status back to active
    if (data.status === "resolved" && eq.status === "breakdown") {
      await db.equipment.update({ where: { id: eq.id }, data: { status: "active" } });
    }
    await logA(logUser, "EQBRK_UPDATE", `Update breakdown alat: ${eq.nama}`);
    return { ok: true, breakdown: updated };
  }

  const created = await db.equipmentBreakdown.create({
    data: { ...data, id: genID("EQBRK") },
  });
  // Auto-set equipment status to breakdown if status=open or in-progress
  if (data.status !== "resolved") {
    await db.equipment.update({ where: { id: eq.id }, data: { status: "breakdown" } });
  }
  await db.equipmentHistory.create({
    data: {
      id: genID("EQHIS"),
      equipmentId: String(payload.equipmentId),
      action: "breakdown",
      detail: `Breakdown reported: ${data.problem || "-"}`,
      by: logUser,
    },
  });
  await logA(logUser, "EQBRK_CREATE", `Report breakdown alat: ${eq.nama}`);
  return { ok: true, breakdown: created };
}

export async function deleteEquipmentBreakdown(args: any[], session: SessionData | null) {
  const [id] = args;
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  const existing = await db.equipmentBreakdown.findUnique({ where: { id: String(id) } });
  if (!existing) return { ok: false, msg: "Record tidak ditemukan" };
  if (role !== "superadmin" && existing.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }
  await db.equipmentBreakdown.delete({ where: { id: String(id) } });
  await logA(logUser, "EQBRK_DELETE", `Hapus breakdown record`);
  return { ok: true };
}

// ============================================================
// EQUIPMENT CONTRACT
// ============================================================

export async function getEquipmentContracts(args: any[], session: SessionData | null) {
  const [equipmentId] = args;
  const where = ownerWhere(args, session, 1, 2);
  const filter: any = { ...where };
  if (equipmentId) filter.equipmentId = String(equipmentId);
  const rows = await db.equipmentContract.findMany({
    where: filter,
    orderBy: { endDate: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    equipmentId: r.equipmentId,
    vendor: r.vendor || "",
    startDate: r.startDate || "",
    endDate: r.endDate || "",
    value: r.value ?? null,
    contractURL: r.contractURL || "",
    status: r.status || "active",
    notes: r.notes || "",
    ownerUsername: r.ownerUsername,
    createdDate: r.createdDate ? r.createdDate.toISOString() : null,
  }));
}

export async function saveEquipmentContract(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  if (!payload.equipmentId) return { ok: false, msg: "Equipment ID wajib diisi" };

  const eq = await db.equipment.findUnique({ where: { id: String(payload.equipmentId) } });
  if (!eq) return { ok: false, msg: "Alat tidak ditemukan" };
  if (role !== "superadmin" && eq.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }

  const data: any = {
    equipmentId: String(payload.equipmentId),
    vendor: payload.vendor || null,
    startDate: payload.startDate || null,
    endDate: payload.endDate || null,
    value: payload.value != null && payload.value !== "" ? parseNumSafe(payload.value) : null,
    contractURL: payload.contractURL || null,
    status: payload.status || "active",
    notes: payload.notes || null,
    ownerUsername: owner,
  };

  if (payload.id) {
    const updated = await db.equipmentContract.update({
      where: { id: String(payload.id) },
      data,
    });
    await logA(logUser, "EQCTC_UPDATE", `Update kontrak alat: ${eq.nama}`);
    return { ok: true, contract: updated };
  }

  const created = await db.equipmentContract.create({
    data: { ...data, id: genID("EQCTC") },
  });
  await db.equipmentHistory.create({
    data: {
      id: genID("EQHIS"),
      equipmentId: String(payload.equipmentId),
      action: "contract",
      detail: `Contract added with ${data.vendor || "-"}`,
      by: logUser,
    },
  });
  await logA(logUser, "EQCTC_CREATE", `Tambah kontrak alat: ${eq.nama}`);
  return { ok: true, contract: created };
}

export async function deleteEquipmentContract(args: any[], session: SessionData | null) {
  const [id] = args;
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  const existing = await db.equipmentContract.findUnique({ where: { id: String(id) } });
  if (!existing) return { ok: false, msg: "Record tidak ditemukan" };
  if (role !== "superadmin" && existing.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }
  await db.equipmentContract.delete({ where: { id: String(id) } });
  await logA(logUser, "EQCTC_DELETE", `Hapus kontrak record`);
  return { ok: true };
}

// ============================================================
// EQUIPMENT TRAINING
// ============================================================

export async function getEquipmentTraining(args: any[], session: SessionData | null) {
  const [equipmentId] = args;
  const where = ownerWhere(args, session, 1, 2);
  const filter: any = { ...where };
  if (equipmentId) filter.equipmentId = String(equipmentId);
  const rows = await db.equipmentTraining.findMany({
    where: filter,
    orderBy: { date: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    equipmentId: r.equipmentId,
    trainer: r.trainer || "",
    trainees: r.trainees || "",
    date: r.date || "",
    topic: r.topic || "",
    documentURL: r.documentURL || "",
    notes: r.notes || "",
    ownerUsername: r.ownerUsername,
    createdDate: r.createdDate ? r.createdDate.toISOString() : null,
  }));
}

export async function saveEquipmentTraining(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  if (!payload.equipmentId) return { ok: false, msg: "Equipment ID wajib diisi" };

  const eq = await db.equipment.findUnique({ where: { id: String(payload.equipmentId) } });
  if (!eq) return { ok: false, msg: "Alat tidak ditemukan" };
  if (role !== "superadmin" && eq.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }

  const data: any = {
    equipmentId: String(payload.equipmentId),
    trainer: payload.trainer || null,
    trainees: payload.trainees || null,
    date: payload.date || null,
    topic: payload.topic || null,
    documentURL: payload.documentURL || null,
    notes: payload.notes || null,
    ownerUsername: owner,
  };

  if (payload.id) {
    const updated = await db.equipmentTraining.update({
      where: { id: String(payload.id) },
      data,
    });
    await logA(logUser, "EQTRN_UPDATE", `Update training alat: ${eq.nama}`);
    return { ok: true, training: updated };
  }

  const created = await db.equipmentTraining.create({
    data: { ...data, id: genID("EQTRN") },
  });
  await db.equipmentHistory.create({
    data: {
      id: genID("EQHIS"),
      equipmentId: String(payload.equipmentId),
      action: "training",
      detail: `Training: ${data.topic || "-"}`,
      by: logUser,
    },
  });
  await logA(logUser, "EQTRN_CREATE", `Tambah training alat: ${eq.nama}`);
  return { ok: true, training: created };
}

export async function deleteEquipmentTraining(args: any[], session: SessionData | null) {
  const [id] = args;
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  const existing = await db.equipmentTraining.findUnique({ where: { id: String(id) } });
  if (!existing) return { ok: false, msg: "Record tidak ditemukan" };
  if (role !== "superadmin" && existing.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }
  await db.equipmentTraining.delete({ where: { id: String(id) } });
  await logA(logUser, "EQTRN_DELETE", `Hapus training record`);
  return { ok: true };
}

// ============================================================
// EQUIPMENT VENDOR
// ============================================================

export async function getEquipmentVendors(args: any[], session: SessionData | null) {
  const where = ownerWhere(args, session, 0, 1);
  const rows = await db.equipmentVendor.findMany({
    where,
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name || "",
    category: r.category || "",
    contact: r.contact || "",
    phone: r.phone || "",
    email: r.email || "",
    address: r.address || "",
    pic: r.pic || "",
    notes: r.notes || "",
    ownerUsername: r.ownerUsername,
    createdDate: r.createdDate ? r.createdDate.toISOString() : null,
  }));
}

export async function saveEquipmentVendor(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  const name = String(payload.name || "").trim();
  if (!name) return { ok: false, msg: "Nama vendor wajib diisi" };

  const data: any = {
    name,
    category: payload.category || null,
    contact: payload.contact || null,
    phone: payload.phone || null,
    email: payload.email || null,
    address: payload.address || null,
    pic: payload.pic || null,
    notes: payload.notes || null,
    ownerUsername: owner,
  };

  if (payload.id) {
    // Verify ownership
    const existing = await db.equipmentVendor.findUnique({ where: { id: String(payload.id) } });
    if (!existing) return { ok: false, msg: "Vendor tidak ditemukan" };
    if (role !== "superadmin" && existing.ownerUsername !== owner) {
      return { ok: false, msg: "Akses ditolak" };
    }
    const updated = await db.equipmentVendor.update({
      where: { id: String(payload.id) },
      data,
    });
    await logA(logUser, "EQVND_UPDATE", `Update vendor: ${name}`);
    return { ok: true, vendor: updated };
  }

  const created = await db.equipmentVendor.create({
    data: { ...data, id: genID("EQVND") },
  });
  await logA(logUser, "EQVND_CREATE", `Tambah vendor: ${name}`);
  return { ok: true, vendor: created };
}

export async function deleteEquipmentVendor(args: any[], session: SessionData | null) {
  const [id] = args;
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  const existing = await db.equipmentVendor.findUnique({ where: { id: String(id) } });
  if (!existing) return { ok: false, msg: "Vendor tidak ditemukan" };
  if (role !== "superadmin" && existing.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }
  await db.equipmentVendor.delete({ where: { id: String(id) } });
  await logA(logUser, "EQVND_DELETE", `Hapus vendor: ${existing.name}`);
  return { ok: true };
}

// ============================================================
// EQUIPMENT REAGENT
// ============================================================

export async function getEquipmentReagents(args: any[], session: SessionData | null) {
  const [equipmentId] = args;
  const where = ownerWhere(args, session, 1, 2);
  const filter: any = { ...where };
  if (equipmentId) filter.equipmentId = String(equipmentId);
  const rows = await db.equipmentReagent.findMany({
    where: filter,
    orderBy: { expiryDate: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    equipmentId: r.equipmentId,
    name: r.name || "",
    lotNo: r.lotNo || "",
    expiryDate: r.expiryDate || "",
    quantity: r.quantity || "",
    unit: r.unit || "",
    notes: r.notes || "",
    ownerUsername: r.ownerUsername,
    createdDate: r.createdDate ? r.createdDate.toISOString() : null,
  }));
}

export async function saveEquipmentReagent(args: any[], session: SessionData | null) {
  const payload = args[0] || {};
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  if (!payload.equipmentId) return { ok: false, msg: "Equipment ID wajib diisi" };
  const name = String(payload.name || "").trim();
  if (!name) return { ok: false, msg: "Nama reagen wajib diisi" };

  const eq = await db.equipment.findUnique({ where: { id: String(payload.equipmentId) } });
  if (!eq) return { ok: false, msg: "Alat tidak ditemukan" };
  if (role !== "superadmin" && eq.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }

  const data: any = {
    equipmentId: String(payload.equipmentId),
    name,
    lotNo: payload.lotNo || null,
    expiryDate: payload.expiryDate || null,
    quantity: payload.quantity || null,
    unit: payload.unit || null,
    notes: payload.notes || null,
    ownerUsername: owner,
  };

  if (payload.id) {
    const updated = await db.equipmentReagent.update({
      where: { id: String(payload.id) },
      data,
    });
    await logA(logUser, "EQRGT_UPDATE", `Update reagen alat: ${name}`);
    return { ok: true, reagent: updated };
  }

  const created = await db.equipmentReagent.create({
    data: { ...data, id: genID("EQRGT") },
  });
  await logA(logUser, "EQRGT_CREATE", `Tambah reagen alat: ${name}`);
  return { ok: true, reagent: created };
}

export async function deleteEquipmentReagent(args: any[], session: SessionData | null) {
  const [id] = args;
  const owner = deriveOwner(args, session, 1);
  const role = deriveRole(args, session, 2);
  const logUser = deriveLogUser(args, session, 3);

  const existing = await db.equipmentReagent.findUnique({ where: { id: String(id) } });
  if (!existing) return { ok: false, msg: "Reagen tidak ditemukan" };
  if (role !== "superadmin" && existing.ownerUsername !== owner) {
    return { ok: false, msg: "Akses ditolak" };
  }
  await db.equipmentReagent.delete({ where: { id: String(id) } });
  await logA(logUser, "EQRGT_DELETE", `Hapus reagen: ${existing.name}`);
  return { ok: true };
}

// ============================================================
// EQUIPMENT REPORTS
// ============================================================

export async function getEquipmentReports(args: any[], session: SessionData | null) {
  const where = ownerWhere(args, session, 0, 1);
  const today = new Date().toISOString().slice(0, 10);

  const [equipment, vendors, contracts, maintenance, calibration, breakdown] =
    await Promise.all([
      db.equipment.findMany({ where, select: { id: true, nama: true, status: true, lokasi: true, brand: true, pic: true, warrantyEnd: true } }),
      db.equipmentVendor.count({ where }),
      db.equipmentContract.findMany({ where, select: { endDate: true, status: true, value: true } }),
      db.equipmentMaintenance.findMany({ where, select: { date: true, cost: true, type: true } }),
      db.equipmentCalibration.findMany({ where, select: { date: true, nextDate: true } }),
      db.equipmentBreakdown.findMany({ where, select: { status: true, cost: true, reportDate: true } }),
    ]);

  const totalMaintCost = maintenance.reduce((s, m) => s + (m.cost || 0), 0);
  const totalBrkCost = breakdown.reduce((s, b) => s + (b.cost || 0), 0);
  const totalContractValue = contracts.reduce((s, c) => s + (c.value || 0), 0);

  return {
    ok: true,
    summary: {
      totalEquipment: equipment.length,
      totalVendors: vendors,
      totalContracts: contracts.length,
      activeContracts: contracts.filter((c) => c.status === "active").length,
      expiredContracts: contracts.filter((c) => c.endDate && c.endDate < today).length,
      warrantyExpired: equipment.filter((e) => e.warrantyEnd && e.warrantyEnd < today).length,
      totalMaintCost,
      totalBrkCost,
      totalContractValue,
      openBreakdowns: breakdown.filter((b) => b.status !== "resolved").length,
    },
    byBrand: aggregateBy(equipment, (e) => e.brand || "Tidak diketahui"),
    byLocation: aggregateBy(equipment, (e) => e.lokasi || "Tidak diketahui"),
    byPIC: aggregateBy(equipment, (e) => e.pic || "Belum ditentukan"),
    maintByType: aggregateBy(maintenance, (m) => m.type || "preventive"),
  };
}

function aggregateBy<T>(arr: T[], keyFn: (item: T) => string) {
  const map: Record<string, number> = {};
  for (const item of arr) {
    const k = keyFn(item);
    map[k] = (map[k] || 0) + 1;
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
}
