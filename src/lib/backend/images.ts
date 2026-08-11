// ============================================================
// Image Analysis module — port dari code.gs fungsi image analysis
//
// Mencakup 6 tipe: hemato, urin, malaria, bta, lain, patologi
// Setiap tipe punya Prisma model sendiri (ImgHemato, ImgUrin, dst.)
//
// Fungsi yang dipublikasikan:
// - getImgData, saveImgData, deleteImgData (generic dispatcher)
// - getImg/saveImg/deleteImg × {Hemato, Urin, Malaria, BTA, Lain, Patologi}
// - uploadImgToDrive (simpan base64 → /public/uploads/<type>/<file>)
// - analyzePatologiImage (canned text generator — port 1:1)
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
import fs from "fs";
import path from "path";

type ImgType = "hemato" | "urin" | "malaria" | "bta" | "lain" | "patologi";

// ============================================================
// Map tipe → Prisma model delegate
// ============================================================
function getImgModel(type: string): any | null {
  switch (type) {
    case "hemato":
      return db.imgHemato;
    case "urin":
      return db.imgUrin;
    case "malaria":
      return db.imgMalaria;
    case "bta":
      return db.imgBTA;
    case "lain":
      return db.imgLain;
    case "patologi":
      return db.imgPatologi;
    default:
      return null;
  }
}

// ============================================================
// Generic PascalCase ↔ camelCase field name converter
// (sheet headers pakai PascalCase; Prisma field pakai camelCase)
// Special-cases: ID↔id, JK↔jk, NIK↔nik
// ============================================================
function pascalToCamel(s: string): string {
  if (s === "ID") return "id";
  if (s === "JK") return "jk";
  if (s === "NIK") return "nik";
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function camelToPascal(s: string): string {
  if (s === "id") return "ID";
  if (s === "jk") return "JK";
  if (s === "nik") return "NIK";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Date fields yang harus dinormalisasi ke YYYY-MM-DD saat dibaca
// (mirror code.gs: TglLahir, TglPeriksa, TglHasil, TglTerima, TglJawab, CreatedDate)
const IMG_DATE_FIELDS_PASCAL = new Set([
  "TglLahir",
  "TglPeriksa",
  "TglHasil",
  "TglTerima",
  "TglJawab",
  "CreatedDate",
]);

// Date fields yang disimpan sebagai string YYYY-MM-DD di Prisma
const IMG_DATE_INPUT_PASCAL = new Set([
  "TglLahir",
  "TglPeriksa",
  "TglHasil",
  "TglTerima",
  "TglJawab",
]);

// ============================================================
// Convert Prisma row → PascalCase API object (dengan normalisasi tanggal)
// ============================================================
function imgRowToObj(row: any): any {
  if (!row) return null;
  const out: any = {};
  for (const k of Object.keys(row)) {
    const pascalKey = camelToPascal(k);
    let v = row[k];
    if (IMG_DATE_FIELDS_PASCAL.has(pascalKey)) {
      if (v instanceof Date) {
        v = dateToISO(v);
      } else if (v) {
        v = dateToISO(parseDateStr(String(v)));
      } else {
        v = null;
      }
    }
    out[pascalKey] = v;
  }
  return out;
}

// ============================================================
// Convert PascalCase payload → camelCase Prisma data object
// (tanggal di-parse & diformat ke YYYY-MM-DD)
// ============================================================
function payloadToImgData(payload: any): any {
  const out: any = {};
  for (const k of Object.keys(payload)) {
    if (k === "ID") continue; // ID ditangani terpisah
    const camelKey = pascalToCamel(k);
    let v = payload[k];
    if (IMG_DATE_INPUT_PASCAL.has(k)) {
      if (v) {
        const d = parseDateStr(String(v));
        v = d ? dateToISO(d) : null;
      } else {
        v = null;
      }
    }
    out[camelKey] = v;
  }
  return out;
}

// ============================================================
// getImgData — ambil rows image by type/owner/filter
// args[0]=type, args[1]=ownerUsername, args[2]=filter {noRM, nama, noPA, startDate, endDate}
// ============================================================
export async function getImgData(args: any[], session: SessionData | null) {
  try {
    const [type, ownerUsernameArg, filterArg] = args;
    const owner = ownerUsernameArg || getActiveUsername(session);
    const filter = filterArg || {};
    const model = getImgModel(type);
    if (!model) return { ok: false, msg: "Tipe tidak valid" };

    // Build Prisma where clause
    const where: any = { ownerUsername: owner };

    // NoRM (substring match, case-insensitive — SQLite default)
    if (filter.noRM) {
      where.noRM = { contains: String(filter.noRM) };
    }

    // NoPA (patologi only)
    if (filter.noPA && type === "patologi") {
      where.noPA = { contains: String(filter.noPA) };
    }

    // Nama — patologi pakai field namaPasien, lainnya pakai nama
    if (filter.nama) {
      if (type === "patologi") {
        where.namaPasien = { contains: String(filter.nama) };
      } else {
        where.nama = { contains: String(filter.nama) };
      }
    }

    // Date range — patologi pakai tglTerima, lainnya pakai tglPeriksa
    if (filter.startDate || filter.endDate) {
      const dateField = type === "patologi" ? "tglTerima" : "tglPeriksa";
      const dateFilter: any = {};
      if (filter.startDate) {
        const sd = parseDateStr(String(filter.startDate));
        if (sd) dateFilter.gte = dateToISO(sd);
      }
      if (filter.endDate) {
        const ed = parseDateStr(String(filter.endDate));
        if (ed) dateFilter.lte = dateToISO(ed);
      }
      where[dateField] = dateFilter;
    }

    const rows = await model.findMany({
      where,
      orderBy: { createdDate: "desc" },
    });

    return { ok: true, data: rows.map(imgRowToObj) };
  } catch (e: any) {
    return { ok: false, msg: e.message };
  }
}

// ============================================================
// saveImgData — create (genID 'IMG_') atau update image row
// args[0]=type, args[1]=payload, args[2]=ownerUsername
// ============================================================
export async function saveImgData(args: any[], session: SessionData | null) {
  const type = args[0];
  return withLock(`img_${type}`, async () => {
    try {
      const [_, payload, ownerUsernameArg] = args;
      const owner = ownerUsernameArg || getActiveUsername(session);
      const model = getImgModel(type);
      if (!model) return { ok: false, msg: "Tipe tidak valid" };

      const data = payloadToImgData(payload);
      data.ownerUsername = owner;

      if (payload.ID) {
        // Update existing — verifikasi kepemilikan
        const existing = await model.findUnique({
          where: { id: payload.ID },
        });
        if (
          !existing ||
          String(existing.ownerUsername).toLowerCase() !==
            String(owner).toLowerCase()
        ) {
          return { ok: false, msg: "Data tidak ditemukan" };
        }
        // createdDate tidak diubah (dikecualikan dari data update)
        delete data.createdDate;
        delete data.id;
        await model.update({
          where: { id: payload.ID },
          data,
        });
        return { ok: true, id: payload.ID };
      } else {
        // Create new
        const newId = genID("IMG");
        data.id = newId;
        await model.create({ data });
        return { ok: true, id: newId };
      }
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}

// ============================================================
// deleteImgData — hapus image row by id+owner
// args[0]=type, args[1]=id, args[2]=ownerUsername
// ============================================================
export async function deleteImgData(args: any[], session: SessionData | null) {
  const type = args[0];
  return withLock(`img_${type}`, async () => {
    try {
      const [_, id, ownerUsernameArg] = args;
      const owner = ownerUsernameArg || getActiveUsername(session);
      const model = getImgModel(type);
      if (!model) return { ok: false, msg: "Tipe tidak valid" };

      const existing = await model.findUnique({ where: { id } });
      if (
        !existing ||
        String(existing.ownerUsername).toLowerCase() !==
          String(owner).toLowerCase()
      ) {
        return { ok: false, msg: "Data tidak ditemukan" };
      }
      await model.delete({ where: { id } });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, msg: e.message };
    }
  });
}

// ============================================================
// Wrapper functions per type — frontend memanggil dengan args
// langsung (tanpa type); wrapper menambahkan type sebagai args[0]
// ============================================================

// --- Hemato ---
export async function getImgHemato(args: any[], session: SessionData | null) {
  return getImgData(["hemato", args[0], args[1]], session);
}
export async function saveImgHemato(args: any[], session: SessionData | null) {
  return saveImgData(["hemato", args[0], args[1]], session);
}
export async function deleteImgHemato(args: any[], session: SessionData | null) {
  return deleteImgData(["hemato", args[0], args[1]], session);
}

// --- Urin ---
export async function getImgUrin(args: any[], session: SessionData | null) {
  return getImgData(["urin", args[0], args[1]], session);
}
export async function saveImgUrin(args: any[], session: SessionData | null) {
  return saveImgData(["urin", args[0], args[1]], session);
}
export async function deleteImgUrin(args: any[], session: SessionData | null) {
  return deleteImgData(["urin", args[0], args[1]], session);
}

// --- Malaria ---
export async function getImgMalaria(args: any[], session: SessionData | null) {
  return getImgData(["malaria", args[0], args[1]], session);
}
export async function saveImgMalaria(args: any[], session: SessionData | null) {
  return saveImgData(["malaria", args[0], args[1]], session);
}
export async function deleteImgMalaria(args: any[], session: SessionData | null) {
  return deleteImgData(["malaria", args[0], args[1]], session);
}

// --- BTA ---
export async function getImgBTA(args: any[], session: SessionData | null) {
  return getImgData(["bta", args[0], args[1]], session);
}
export async function saveImgBTA(args: any[], session: SessionData | null) {
  return saveImgData(["bta", args[0], args[1]], session);
}
export async function deleteImgBTA(args: any[], session: SessionData | null) {
  return deleteImgData(["bta", args[0], args[1]], session);
}

// --- Lain ---
export async function getImgLain(args: any[], session: SessionData | null) {
  return getImgData(["lain", args[0], args[1]], session);
}
export async function saveImgLain(args: any[], session: SessionData | null) {
  return saveImgData(["lain", args[0], args[1]], session);
}
export async function deleteImgLain(args: any[], session: SessionData | null) {
  return deleteImgData(["lain", args[0], args[1]], session);
}

// --- Patologi (5 image slots) ---
export async function getImgPatologi(args: any[], session: SessionData | null) {
  try {
    return await getImgData(["patologi", args[0], args[1]], session);
  } catch (e: any) {
    return { ok: false, msg: e.message };
  }
}
export async function saveImgPatologi(args: any[], session: SessionData | null) {
  try {
    return await saveImgData(["patologi", args[0], args[1]], session);
  } catch (e: any) {
    return { ok: false, msg: e.message };
  }
}
export async function deleteImgPatologi(
  args: any[],
  session: SessionData | null
) {
  try {
    return await deleteImgData(["patologi", args[0], args[1]], session);
  } catch (e: any) {
    return { ok: false, msg: e.message };
  }
}

// ============================================================
// uploadImgToDrive — simpan base64 image ke public/uploads/<type>/<fileName>
// args[0]=base64Data, args[1]=fileName, args[2]=type
// Return: public URL string ("/uploads/<type>/<fileName>")
//
// Port note: GAS aslinya upload ke DriveApp & set sharing anyone-with-link.
// Di Next.js, kita simpan file di /public/uploads/<type>/ dan expose via URL.
// ============================================================
export async function uploadImgToDrive(
  args: any[],
  _session: SessionData | null
): Promise<string | null> {
  try {
    const [base64Data, fileNameArg, typeArg] = args;
    const type = String(typeArg || "lain");
    const fileName = fileNameArg || `img_${Date.now()}.jpg`;

    const uploadDir = path.join(
      process.cwd(),
      "public",
      "uploads",
      type
    );
    // Ensure directory exists (recursive)
    fs.mkdirSync(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, fileName);

    // Strip data URL prefix if present ("data:image/jpeg;base64,...")
    const raw = String(base64Data || "");
    const b64 = raw.includes(",") ? raw.split(",")[1] : raw;

    // Decode base64 → Buffer → write to disk
    const buf = Buffer.from(b64, "base64");
    fs.writeFileSync(filePath, buf);

    return `/uploads/${type}/${fileName}`;
  } catch (e) {
    // Mirror original: return null on error
    return null;
  }
}

// ============================================================
// analyzePatologiImage — canned text generator
// args[0]=imageUrls (array, unused), args[1]=jenisPemeriksaan, args[2]=patientData
//
// Port note: GAS aslinya mengembalikan template text blocks berdasarkan
// keyword di jenisPemeriksaan (histologi/sitologi/papsmear/fnab). Tidak
// ada panggilan AI sesungguhnya — hanya canned text.
// ============================================================
export async function analyzePatologiImage(
  args: any[],
  _session: SessionData | null
) {
  try {
    const [_imageUrls, jenisPemeriksaan, patientData] = args;
    const result = {
      makroskopisDesk: "",
      mikroskopisDesk: "",
      kesanDesk: "",
      saranDesk: "",
      topografiDesk: "",
      morfologiDesk: "",
    };
    const jp = (jenisPemeriksaan || "").toLowerCase();
    const nama =
      patientData && patientData.NamaPasien ? patientData.NamaPasien : "";
    const jk = patientData && patientData.JK ? patientData.JK : "";
    const umur = patientData && patientData.Umur ? patientData.Umur : "";
    const dx =
      patientData && patientData.Diagnosis ? patientData.Diagnosis : "";

    if (jp.indexOf("histologi") >= 0) {
      result.makroskopisDesk =
        "Diterima spesimen jaringan berupa potongan jaringan yang difiksasi dalam formalin 10% berwarna coklat keabu-abuan, berukuran bervariasi. Jaringan tampak padat, konsistensi cukup keras, dengan permukaan potongan agak kasar. " +
        (dx ? "Klinis: " + dx + "." : "");
      result.mikroskopisDesk =
        "Potongan histologis menunjukkan arsitektur jaringan yang dipreservasi dengan baik. Evaluasi terhadap struktur seluler, pola pertumbuhan, dan karakteristik nukleus perlu dilakukan lebih lanjut oleh patologis anatomi.\n\nCatatan: Analisis AI ini merupakan pendukung awal. Diagnosis definitif harus ditetapkan oleh dokter patologi anatomi yang kompeten sesuai standar WHO Classification of Tumors.";
      result.kesanDesk =
        "Spesimen memerlukan evaluasi mikroskopis lengkap oleh patologis anatomi. Diagnosis definitif belum dapat ditetapkan berdasarkan gambar saja dan memerlukan pemeriksaan imunohistokimia apabila diperlukan.";
      result.saranDesk =
        "1. Disarankan pemeriksaan imunohistokimia untuk menegakkan diagnosis\n2. Konsultasi dengan patologis anatomi senior apabila diperlukan\n3. Korelasi dengan data klinis, hasil pemeriksaan penunjang, dan temuan radiologis\n4. Pertimbangkan pemeriksaan molekuler apabila indikasi terpenuhi";
      result.topografiDesk =
        "Topografi spesimen perlu dikonfirmasi oleh klinisi. Klasifikasi ICD-O topografi dan morfologi sesuai standar WHO.";
      result.morfologiDesk =
        "Morfologi tumor/jaringan perlu ditentukan melalui evaluasi histopatologis lengkap sesuai klasifikasi WHO terbaru.";
    } else if (jp.indexOf("sitologi") >= 0) {
      result.makroskopisDesk =
        "Diterima spesimen sitologi berupa smear/ preparat apus yang diwarnai dengan pewarnaan yang sesuai. Evaluasi seluler dilakukan secara menyeluruh.";
      result.mikroskopisDesk =
        "Preparat sitologi menunjukkan kecukupan seluler. Evaluasi morfologi sel, nukleus, sitoplasma, dan latar belakang perlu dilakukan lebih detail oleh patologis anatomi.\n\nCatatan: Hasil sitologi merupakan screening awal dan diagnosis definitif memerlukan konfirmasi histopatologi.";
      result.kesanDesk =
        "Spesimen sitologi memerlukan evaluasi lengkap oleh patologis anatomi. Hasil bersifat preliminer dan memerlukan korelasi klinis.";
      result.saranDesk =
        "1. Korelasi dengan data klinis\n2. Pertimbangkan biopsi untuk konfirmasi histopatologi\n3. Follow-up dan evaluasi berkala\n4. Konsultasi patologis anatomi apabila temuan tidak khas";
      result.topografiDesk =
        "Topografi sesuai lokasi pengambilan spesimen oleh klinisi.";
      result.morfologiDesk =
        "Morfologi sel perlu dievaluasi lebih lanjut sesuai klasifikasi WHO.";
    } else if (jp.indexOf("papsmear") >= 0 || jp.indexOf("pap") >= 0) {
      result.makroskopisDesk =
        "Diterima preparat Pap Smear. Evaluasi dilakukan sesuai sistem pelaporan Bethesda 2014.";
      result.mikroskopisDesk =
        "Evaluasi preparat Pap Smear menunjukkan:\n- Kejelasan dan kecukupan seluler perlu dinilai\n- Komponen sel epitel skuamosa dan/atau glandular perlu dievaluasi\n- Latar belakang inflamasi dan flora bakteri perlu dinilai\n\nCatatan: Interpretasi akhir harus dilakukan oleh patologis anatomi sesuai The Bethesda System for Reporting Cervical Cytology (TBS 2014).";
      result.kesanDesk =
        "Preparat memerlukan evaluasi lengkap oleh patologis anatomi untuk klasifikasi Bethesda (NILM, ASC-US, ASC-H, LSIL, HSIL, atau karsinoma invasif).";
      result.saranDesk =
        "1. Pap Smear berulang apabila preparat tidak memadai\n2. Kolposkopi apabila terdapat abnormitas sel epitel\n3. HPV DNA testing apabila indikasi\n4. Follow-up sesuai protokol screening serviks";
      result.topografiDesk = "Serviks uteri - Transformation zone.";
      result.morfologiDesk =
        "Morfologi sel epitel serviks sesuai klasifikasi Bethesda 2014.";
    } else if (jp.indexOf("fnab") >= 0 || jp.indexOf("fnac") >= 0) {
      result.makroskopisDesk =
        "Diterima spesimen FNAB/FNAC berupa preparat smear dari aspirasi jarum halus. Jumlah dan kecukupan materi seluler perlu dievaluasi.";
      result.mikroskopisDesk =
        "Evaluasi FNAB menunjukkan kecukupan materi seluler. Pola seluler, karakteristik nukleus, dan arsitektur sel perlu dinilai oleh patologis anatomi.\n\nCatatan: Diagnosis FNAB bersifat preliminer. Konfirmasi histopatologi melalui biopsi eksisi/insisional diperlukan untuk diagnosis definitif.";
      result.kesanDesk =
        "Spesimen FNAB memerlukan evaluasi lengkap oleh patologis anatomi. Kecukupan materi dan diagnosis banding perlu ditetapkan.";
      result.saranDesk =
        "1. Korelasi dengan pemeriksaan klinis dan pencitraan\n2. Pertimbangkan biopsi untuk konfirmasi histopatologi\n3. Pemeriksaan imunositokimia pada cell block apabila diperlukan\n4. Konsultasi patologis anatomi untuk kasus yang sulit";
      result.topografiDesk =
        "Topografi sesuai lokasi aspirasi oleh klinisi.";
      result.morfologiDesk =
        "Morfologi sel aspirasi perlu diklasifikasikan sesuai standar WHO.";
    } else {
      // Default fallback
      result.makroskopisDesk =
        "Diterima spesimen patologi anatomi. Evaluasi makroskopis dilakukan terhadap ukuran, bentuk, warna, dan konsistensi spesimen.";
      result.mikroskopisDesk =
        "Evaluasi mikroskopis diperlukan oleh patologis anatomi untuk menentukan diagnosis.";
      result.kesanDesk =
        "Spesimen memerlukan evaluasi lengkap oleh patologis anatomi.";
      result.saranDesk =
        "Konsultasi dengan patologis anatomi untuk evaluasi dan diagnosis definitif.";
      result.topografiDesk = "Topografi sesuai data klinis.";
      result.morfologiDesk = "Morfologi perlu dievaluasi lebih lanjut.";
    }

    // Prefix makroskopis dengan info pasien jika ada
    if (nama) {
      result.makroskopisDesk =
        "Pasien: " +
        nama +
        (jk ? " (" + jk + ")" : "") +
        (umur ? ", " + umur : "") +
        ". " +
        result.makroskopisDesk;
    }

    return { ok: true, data: result };
  } catch (e: any) {
    return { ok: false, msg: e.message };
  }
}
