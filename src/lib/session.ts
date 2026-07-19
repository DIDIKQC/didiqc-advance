// ============================================================
// Session management — replaces Google Apps Script's implicit auth
// Uses a signed cookie (HMAC) to identify the logged-in user
// ============================================================

import { cookies } from "next/headers";
import { db } from "./db";
import crypto from "crypto";

const SESSION_COOKIE = "didiqc_session";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "didiQCsys-v9.12-secret-key-change-in-prod";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SessionData {
  username: string;
  role: string;
  fullName: string;
  email?: string | null;
  expiryDate?: string | null;
  imgAnalAccess: boolean;
  loginAsName?: string;
  loginUsername?: string;
  activeUsername?: string; // for View-As
  activeRole?: string; // for View-As
  createdAt: string;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
}

function createToken(data: SessionData): string {
  const payload = JSON.stringify(data);
  const b64 = Buffer.from(payload).toString("base64url");
  const sig = sign(b64);
  return `${b64}.${sig}`;
}

function verifyToken(token: string): SessionData | null {
  try {
    const [b64, sig] = token.split(".");
    if (!b64 || !sig) return null;
    const expected = sign(b64);
    if (sig !== expected) return null;
    const payload = Buffer.from(b64, "base64url").toString("utf8");
    const data: SessionData = JSON.parse(payload);
    // Check expiry
    if (Date.now() - new Date(data.createdAt).getTime() > SESSION_TTL_MS) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function setSession(data: SessionData): Promise<void> {
  const cookieStore = await cookies();
  const token = createToken(data);
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function updateSession(
  patch: Partial<SessionData>
): Promise<SessionData | null> {
  const cur = await getSession();
  if (!cur) return null;
  const next: SessionData = { ...cur, ...patch };
  await setSession(next);
  return next;
}

// Get the user record from DB to validate session freshness
export async function getSessionUser(): Promise<{
  session: SessionData;
  user: any;
} | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await db.users.findUnique({
    where: { username: session.username },
  });
  if (!user) return null;
  if (user.status !== "active") return null;
  return { session, user };
}
