// ============================================================
// didiQCsys v9.12 — Shared utilities (port dari code.gs)
// Semua fungsi di sini adalah port 1:1 dari helpers di code.gs
// ============================================================

import { db } from "./db";

// Konstanta (mirror code.gs)
export const APP_NAME = "didiQCsys v9.12";
export const APP_LOGO_URL =
  "https://drive.google.com/uc?id=1pNQRaZmXb-BnsXEvJ3CG36eCRi_Kx3yH";
export const SMART_PWD = "didikqc";
export const LOCK_TIMEOUT = 30000;
export const BACKUP_FOLDER_NAME = "didiQCsys_Backups";
export const MAX_BACKUP_FILES = 10;

// ---- Date formatting (mirror fD, fDT, tN, nowISO) ----
export function fD(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return null;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function fDT(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return null;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

export function tN(): Date {
  return new Date();
}

export function nowISO(): string {
  return new Date().toISOString();
}

// ---- Date parsing ----
export function parseDateStr(s: string | null | undefined): Date | null {
  if (!s) return null;
  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s + "T00:00:00");
    if (!isNaN(d.getTime())) return d;
  }
  // Try DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const [dd, mm, yyyy] = s.split(/[\/\s]/);
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!isNaN(d.getTime())) return d;
  }
  // Try Date constructor
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

export function dateToISO(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return null;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---- Numeric ----
export function parseNumSafe(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  const s = String(v).replace(",", ".").trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ---- ID generation ----
export function genID(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
}

// ---- sanitizeReturn: recursively convert Date → ISO string, drop functions ----
export function sanitizeReturn(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj === "function") return null;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeReturn);
  const out: Record<string, any> = {};
  for (const k of Object.keys(obj)) {
    out[k] = sanitizeReturn(obj[k]);
  }
  return out;
}

// ---- isSameDay ----
export function isSameDay(d1: Date | string, d2: Date | string): boolean {
  const a = typeof d1 === "string" ? new Date(d1) : d1;
  const b = typeof d2 === "string" ? new Date(d2) : d2;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ---- Owner filter (mirror ownerMatch) ----
export function ownerMatch(
  rowOwner: string | null | undefined,
  username: string,
  role: string
): boolean {
  if (role === "superadmin") return true;
  return rowOwner === username;
}

// ---- withLock — SQLite transactions don't have LockService, use a simple mutex ----
const locks: Record<string, Promise<any>> = {};
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks[key] || Promise.resolve();
  let resolve: () => void;
  locks[key] = new Promise<void>((r) => {
    resolve = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    resolve!();
    delete locks[key];
  }
}

// ---- logA — append to LogActivity, auto-trim ----
export async function logA(
  username: string,
  action: string,
  detail: string | null = null,
  overrideUser?: string
): Promise<void> {
  try {
    const u = overrideUser || username;
    await db.logActivity.create({
      data: {
        username: u,
        action,
        detail: detail || null,
      },
    });
    // Trim to 2000 rows
    const count = await db.logActivity.count();
    if (count > 2000) {
      const old = await db.logActivity.findMany({
        orderBy: { timestamp: "asc" },
        take: count - 2000,
        select: { id: true },
      });
      if (old.length > 0) {
        await db.logActivity.deleteMany({
          where: { id: { in: old.map((r) => r.id) } },
        });
      }
    }
  } catch (e) {
    console.error("logA error:", e);
  }
}

// ---- getActiveUsername / getActiveRole / getLogUser helpers ----
// In Next.js, these come from the session
export interface SessionUser {
  username: string;
  role: string;
  actualRole?: string;
  loginAsName?: string;
  loginUsername?: string;
  activeUsername?: string; // for View-As
  activeRole?: string; // for View-As
}

export function getActiveUsername(s: SessionUser | null): string {
  if (!s) return "";
  return s.activeUsername || s.username;
}

export function getActiveRole(s: SessionUser | null): string {
  if (!s) return "user";
  return s.activeRole || s.role;
}

export function getLogUser(s: SessionUser | null): string {
  if (!s) return "";
  return s.loginUsername || s.username;
}
