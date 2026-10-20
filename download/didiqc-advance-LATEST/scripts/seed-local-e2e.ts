// Seed lengkap utk E2E lokal: admin + param KimiaKlinik + lot + QC data
// Tujuan: memverifikasi chart "Sigma perLevel per Bidang" memakai CV aktual
// Lot dirancang: mean=100, sdL=5 (CV assigned 5%), TEa=10; QC aktual CV ~0.3% →
//   sigma BARU (CV aktual) ≈ 33  |  sigma LAMA (CV lot) = 2.0
import { db } from "../src/lib/db";

const rid = (p: string) => `${p}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

async function main() {
  const count = await db.users.count();
  if (count === 0) {
    await db.users.create({
      data: {
        username: "admin",
        password: "didikqc123",
        fullName: "Administrator",
        email: "admin@didiqc.local",
        role: "superadmin",
        status: "active",
        approvedBy: "system",
        approvedDate: new Date(),
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        imgAnalAccess: true,
      },
    });
    console.log("✓ admin/didikqc123");
  }

  const owner = "admin";
  let param = await db.parameters.findFirst({ where: { ownerUsername: owner, parameter: "GLUKOSA" } });
  if (!param) {
    param = await db.parameters.create({
      data: { id: rid("PAR"), ownerUsername: owner, parameter: "GLUKOSA", createdBy: "seed", bidang: "KimiaKlinik" },
    });
    console.log("✓ param GLUKOSA");
  }
  let lot = await db.lotQC.findFirst({ where: { ownerUsername: owner, paramID: param.id } });
  if (!lot) {
    lot = await db.lotQC.create({
      data: {
        id: rid("LOT"), ownerUsername: owner, paramID: param.id, noLot: "LOT1", namaAlat: "COBAS E311",
        methode: "GOD-PAP", satuan: "mg/dL", expiredDate: "2027-12-31", sumber: "Manufaktur",
        tea: 10, meanL1: 100, sdL1: 5, targetL1: 100,
        meanL2: 200, sdL2: 8, targetL2: 200,
      },
    });
    console.log("✓ lot LOT1");
  }
  const qcCount = await db.inputQC.count({ where: { ownerUsername: owner, lotID: lot.id } });
  if (qcCount === 0) {
    const vals = [99.4, 100.2, 100.8, 99.6, 100.4, 99.8, 100.1, 100.3, 99.5, 100.0];
    for (let i = 0; i < vals.length; i++) {
      const d = new Date(Date.now() - (vals.length - i) * 86400000);
      const tanggal = d.toISOString().slice(0, 10);
      await db.inputQC.create({
        data: {
          id: rid("QC"), ownerUsername: owner, paramID: param.id, lotID: lot.id, parameter: "GLUKOSA",
          noLot: lot.noLot, namaAlat: lot.namaAlat, tanggal, level1: vals[i], level2: 200,
          inputBy: "seed", validated: true, validatedBy: "seed", validatedDate: new Date(),
        },
      });
    }
    console.log("✓ 10 baris QC GLUKOSA L1 (CV aktual rendah)");
  }
  console.log("SEED DONE");
}
main().catch((e) => { console.error("SEED ERROR:", e); process.exit(1); }).finally(async () => { await db.$disconnect(); });
