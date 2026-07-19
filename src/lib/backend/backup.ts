// ============================================================
// Backup & Restore module — port dari code.gs
//
// Fungsi yang dipublikasikan:
// - backupAllSheets, backupAppProject, backupDatabase
// - listBackups, restoreSheetFromBackup
// - setupAutoBackupTrigger, removeAutoBackupTrigger,
//   isBackupTriggerActive, autoBackupDaily
// - exportSheet, getEmailQuota, testEmail
// - resetDatabase, autoArchiveYearly, setupArchiveTrigger
//
// Catatan: Di Apps Script, backup disimpan ke Google Drive.
// Di Next.js port, backup disimpan ke /home/z/my-project/backups/.
// ScriptApp triggers tidak ada — diganti flag Settings.backup_auto.
// ============================================================

import { db } from "@/lib/db";
import {
  genID,
  logA,
  ownerMatch,
  fD,
  fDT,
  nowISO,
  dateToISO,
  APP_NAME,
  MAX_BACKUP_FILES,
  BACKUP_FOLDER_NAME,
} from "@/lib/utils-server";
import type { SessionData } from "@/lib/session";
import fs from "fs";
import path from "path";

// ============================================================
// CONSTANTS & MAPPINGS
// ============================================================
const BACKUP_ROOT = path.join(process.cwd(), "backups");

// Map sheet name (Apps Script) → Prisma model key
const SHEET_TO_PRISMA: Record<string, string> = {
  Users: "users",
  Parameters: "parameters",
  LotQC: "lotQC",
  InputQC: "inputQC",
  HistoriQC: "historiQC",
  CalculatedStats: "calculatedStats",
  BiasPME: "biasPME",
  DaftarTEa: "daftarTEa",
  SigmaCVOpt: "sigmaCVOpt",
  LaporanCatatan: "laporanCatatan",
  TabulasiCatatan: "tabulasiCatatan",
  KopSurat: "kopSurat",
  Settings: "settings",
  LogActivity: "logActivity",
  ImgHemato: "imgHemato",
  ImgUrin: "imgUrin",
  ImgMalaria: "imgMalaria",
  ImgBTA: "imgBTA",
  ImgLain: "imgLain",
  ImgPatologi: "imgPatologi",
  CatatanDokter: "catatanDokter",
  UserPasswords: "userPasswords",
};

const ALL_SHEET_NAMES = Object.keys(SHEET_TO_PRISMA);

function getPrismaModel(sheetName: string): any | null {
  const key = SHEET_TO_PRISMA[sheetName];
  if (!key) return null;
  return (db as any)[key];
}

// Convert Prisma row → plain object with Date → ISO string
function rowToPlain(row: any): any {
  const out: any = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === "boolean") out[k] = v;
    else if (v === null) out[k] = null;
    else out[k] = v;
  }
  return out;
}

// Timestamp string for filename: yyyy-MM-dd_HH-mm-ss
function tsString(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours()
  )}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// Ensure directory exists
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Clean old backups in folder, keep newest N files
async function cleanOldBackups(folder: string, maxFiles: number): Promise<void> {
  try {
    const files = await fs.promises.readdir(folder);
    const stats = await Promise.all(
      files.map(async (name) => {
        const fp = path.join(folder, name);
        const st = await fs.promises.stat(fp);
        return { name, path: fp, mtime: st.mtime };
      })
    );
    stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    if (stats.length > maxFiles) {
      for (let i = maxFiles; i < stats.length; i++) {
        try {
          await fs.promises.unlink(stats[i].path);
        } catch (e) {
          // ignore
        }
      }
    }
  } catch (e) {
    // ignore
  }
}

// Convert rows to CSV string (mirror sheetToCSV)
function rowsToCSV(rows: any[]): string {
  if (!rows || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines: string[] = [];
  lines.push(headers.join(","));
  for (const row of rows) {
    const cells = headers.map((h) => {
      const v = row[h];
      let s: string;
      if (v instanceof Date) s = v.toISOString();
      else if (v === null || v === undefined) s = "";
      else if (typeof v === "boolean") s = v ? "true" : "false";
      else s = String(v);
      if (s.indexOf(",") > -1 || s.indexOf('"') > -1 || s.indexOf("\n") > -1) {
        s = '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    });
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

// ============================================================
// backupAllSheets — export each table as JSON, keep newest 10
// ============================================================
export async function backupAllSheets(
  args: any[],
  _session: SessionData | null
) {
  const username = args[0] || "system";
  try {
    ensureDir(BACKUP_ROOT);
    const ts = tsString();
    let count = 0;

    for (const sheetName of ALL_SHEET_NAMES) {
      const model = getPrismaModel(sheetName);
      if (!model) continue;
      const rows = await model.findMany();
      const plainRows = rows.map(rowToPlain);
      const json = JSON.stringify(plainRows, null, 2);

      const sheetFolder = path.join(BACKUP_ROOT, sheetName);
      ensureDir(sheetFolder);

      const filename = `${sheetName}_${ts}.json`;
      const filepath = path.join(sheetFolder, filename);
      await fs.promises.writeFile(filepath, json, "utf8");

      await cleanOldBackups(sheetFolder, MAX_BACKUP_FILES);
      count++;
    }

    await logA(username, "BACKUP_SHEETS", count + " sheets");
    return {
      ok: true,
      count,
      folder: BACKUP_ROOT,
      msg: count + " sheet ter-backup",
    };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// backupAppProject — write metadata JSON
// ============================================================
export async function backupAppProject(
  args: any[],
  _session: SessionData | null
) {
  const username = args[0] || "system";
  try {
    ensureDir(BACKUP_ROOT);
    const appFolder = path.join(BACKUP_ROOT, "_AppProject");
    ensureDir(appFolder);

    const ts = tsString();
    const info = {
      timestamp: new Date().toISOString(),
      creator: username,
      appName: APP_NAME,
      tableList: ALL_SHEET_NAMES,
      sheetCount: ALL_SHEET_NAMES.length,
      note: "Next.js port — no ScriptApp triggers or spreadsheet ID",
    };
    const filename = `AppProject_${ts}.json`;
    const filepath = path.join(appFolder, filename);
    await fs.promises.writeFile(
      filepath,
      JSON.stringify(info, null, 2),
      "utf8"
    );

    await cleanOldBackups(appFolder, MAX_BACKUP_FILES);
    return { ok: true, file: filepath, msg: "Backup aplikasi berhasil" };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// backupDatabase — superadmin only. Calls both backup functions.
// ============================================================
export async function backupDatabase(
  args: any[],
  _session: SessionData | null
) {
  const [username, role] = args as [string, string];
  if (role !== "superadmin") return { ok: false, msg: "Akses ditolak" };
  try {
    const r1 = await backupAllSheets([username], _session);
    const r2 = await backupAppProject([username], _session);
    return {
      ok: true,
      msg: (r1.msg || "") + " | " + (r2.msg || ""),
    };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// listBackups — scan /home/z/my-project/backups/
// Returns {folderName: [file metadata]} map
// ============================================================
export async function listBackups(_args: any[], _session: SessionData | null) {
  try {
    ensureDir(BACKUP_ROOT);
    const subFolders = await fs.promises.readdir(BACKUP_ROOT, {
      withFileTypes: true,
    });
    const result: Record<string, any[]> = {};

    for (const entry of subFolders) {
      if (!entry.isDirectory()) continue;
      const folderPath = path.join(BACKUP_ROOT, entry.name);
      const files = await fs.promises.readdir(folderPath);
      const list: any[] = [];
      for (const fname of files) {
        const fp = path.join(folderPath, fname);
        try {
          const st = await fs.promises.stat(fp);
          list.push({
            id: fp, // file path used as ID
            name: fname,
            date: st.mtime.toISOString(),
            size: st.size,
            mimeType: fname.toLowerCase().endsWith(".json")
              ? "application/json"
              : fname.toLowerCase().endsWith(".csv")
              ? "text/csv"
              : "application/octet-stream",
          });
        } catch (e) {
          // skip
        }
      }
      list.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      result[entry.name] = list;
    }
    return { ok: true, data: result };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// restoreSheetFromBackup — superadmin only.
// args: [fileId (=file path), sheetName, callerRole]
// Reads JSON file, replaces table data.
// ============================================================
export async function restoreSheetFromBackup(
  args: any[],
  _session: SessionData | null
) {
  const [fileId, sheetName, callerRole] = args as [string, string, string];
  if (callerRole !== "superadmin") return { ok: false, msg: "Akses ditolak" };
  try {
    const filepath = fileId;
    if (!fs.existsSync(filepath)) {
      return { ok: false, msg: "File backup tidak ditemukan" };
    }
    const model = getPrismaModel(sheetName);
    if (!model) return { ok: false, msg: "Sheet tidak dikenal" };

    const content = await fs.promises.readFile(filepath, "utf8");
    let arr: any[];
    try {
      arr = JSON.parse(content);
    } catch (e) {
      return { ok: false, msg: "File JSON tidak valid" };
    }
    if (!Array.isArray(arr)) {
      return { ok: false, msg: "File JSON kosong atau format salah" };
    }

    // Replace table data: delete all, then insert all
    await model.deleteMany({});
    if (arr.length > 0) {
      // Normalize rows: convert ISO strings back to Date for DateTime fields
      // Prisma accepts ISO strings for DateTime fields automatically.
      await model.createMany({ data: arr });
    }
    return {
      ok: true,
      msg: `Sheet ${sheetName} di-restore (${arr.length} rows)`,
    };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// setupAutoBackupTrigger — set Settings.backup_auto='true'
// ============================================================
export async function setupAutoBackupTrigger(
  _args: any[],
  _session: SessionData | null
) {
  try {
    await db.settings.upsert({
      where: { key: "backup_auto" },
      update: { value: "true" },
      create: { key: "backup_auto", value: "true" },
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// removeAutoBackupTrigger — set Settings.backup_auto='false'
// ============================================================
export async function removeAutoBackupTrigger(
  _args: any[],
  _session: SessionData | null
) {
  try {
    await db.settings.upsert({
      where: { key: "backup_auto" },
      update: { value: "false" },
      create: { key: "backup_auto", value: "false" },
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// isBackupTriggerActive — read Settings.backup_auto
// ============================================================
export async function isBackupTriggerActive(
  _args: any[],
  _session: SessionData | null
) {
  try {
    const row = await db.settings.findUnique({ where: { key: "backup_auto" } });
    return row?.value === "true";
  } catch (e) {
    return false;
  }
}

// ============================================================
// autoBackupDaily — if backup_auto, call backupAllSheets('system')
// ============================================================
export async function autoBackupDaily(_args: any[], session: SessionData | null) {
  try {
    const active = await isBackupTriggerActive([], session);
    if (active) {
      await backupAllSheets(["system"], session);
      await backupAppProject(["system"], session);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// exportSheet — args: [sheetName, format ('json'|'csv')]
// Returns {content, filename, mime}
// ============================================================
export async function exportSheet(args: any[], _session: SessionData | null) {
  const [sheetName, format] = args as [string, string];
  try {
    const model = getPrismaModel(sheetName);
    if (!model) return { ok: false, msg: "Sheet tidak ditemukan" };
    const rows = await model.findMany();
    const plainRows = rows.map(rowToPlain);

    if (format === "json") {
      return {
        ok: true,
        content: JSON.stringify(plainRows, null, 2),
        filename: `${sheetName}.json`,
        mime: "application/json",
      };
    }
    // default CSV
    return {
      ok: true,
      content: rowsToCSV(plainRows),
      filename: `${sheetName}.csv`,
      mime: "text/csv",
    };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// getEmailQuota — fixed number (no real email in Next.js port)
// ============================================================
export async function getEmailQuota(_args: any[], _session: SessionData | null) {
  return { ok: true, remaining: 100 };
}

// ============================================================
// testEmail — disabled in Next.js port
// ============================================================
export async function testEmail(args: any[], _session: SessionData | null) {
  const [toEmail, username] = args as [string, string?];
  console.log(
    `[testEmail] Email feature disabled in Next.js port. Would send to: ${toEmail}, user: ${username}`
  );
  return { ok: true, message: "Email feature disabled in Next.js port" };
}

// ============================================================
// resetDatabase — superadmin only, confirm must === 'RESET CONFIRM'
// Clears: InputQC, HistoriQC, CalculatedStats, BiasPME,
//         LaporanCatatan, TabulasiCatatan, LogActivity
// Preserves: Users, Parameters, LotQC, etc.
// ============================================================
export async function resetDatabase(args: any[], _session: SessionData | null) {
  const [username, role, confirm] = args as [string, string, string];
  if (role !== "superadmin") return { ok: false, msg: "Akses ditolak" };
  if (confirm !== "RESET CONFIRM")
    return { ok: false, msg: "Konfirmasi tidak valid" };
  try {
    await Promise.all([
      db.inputQC.deleteMany({}),
      db.historiQC.deleteMany({}),
      db.calculatedStats.deleteMany({}),
      db.biasPME.deleteMany({}),
      db.laporanCatatan.deleteMany({}),
      db.tabulasiCatatan.deleteMany({}),
      db.logActivity.deleteMany({}),
    ]);
    await logA(
      username || "system",
      "RESET_DATABASE",
      "Reset InputQC, HistoriQC, CalcStats, BiasPME, Catatan, LogActivity"
    );
    return { ok: true, msg: "Database direset" };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// autoArchiveYearly — not needed in Next.js port
// ============================================================
export async function autoArchiveYearly(_args: any[], _session: SessionData | null) {
  return {
    ok: true,
    message:
      "Archive not needed in Next.js port — all data stays in InputQC with date filtering",
  };
}

// ============================================================
// setupArchiveTrigger — no-op in Next.js port
// ============================================================
export async function setupArchiveTrigger(
  _args: any[],
  _session: SessionData | null
) {
  return { ok: true };
}
