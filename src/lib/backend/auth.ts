// ============================================================
// Auth & bootstrap module — port dari code.gs fungsi auth/login
//
// Fungsi yang dipublikasikan:
// - getLoginSettings (PUBLIC, pre-login)
// - getAppLogo (PUBLIC)
// - loginUser (PUBLIC)
// - registerUser (PUBLIC)
// - initializeSheets (PUBLIC, auto-called on DOMContentLoaded)
// - getInitData (auth required)
// ============================================================

import { db } from "@/lib/db";
import { setSession, clearSession } from "@/lib/session";
import {
  genID,
  nowISO,
  logA,
  APP_LOGO_URL,
  APP_NAME,
} from "@/lib/utils-server";
import type { SessionData } from "@/lib/session";

const DEFAULT_SETTINGS: Record<string, string> = {
  theme_primary: "#2563eb",
  sidebar_bg: "#0f172a",
  auto_logout: "180",
  sb_font_size: "14",
  sb_font_weight: "500",
  sb_font_color: "#f1f5f9",
  backup_auto: "false",
  archive_auto: "true",
};

const DEFAULT_LOGIN_SETTINGS: Record<string, string> = {
  login_font_size: "16",
  login_font_color: "#ffffff",
  login_font_weight: "400",
  login_brightness: "0.8",
  login_bg_color: "#1e293b",
};

// In-memory lock for first-user registration race
let registerLock = false;

// ============================================================
// getLoginSettings — pre-login, returns saved login page styling
// ============================================================
export async function getLoginSettings() {
  const rows = await db.settings.findMany();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value || "";
  return {
    ...DEFAULT_LOGIN_SETTINGS,
    login_font_size: map.login_font_size || DEFAULT_LOGIN_SETTINGS.login_font_size,
    login_font_color: map.login_font_color || DEFAULT_LOGIN_SETTINGS.login_font_color,
    login_font_weight: map.login_font_weight || DEFAULT_LOGIN_SETTINGS.login_font_weight,
    login_brightness: map.login_brightness || DEFAULT_LOGIN_SETTINGS.login_brightness,
    login_bg_color: map.login_bg_color || DEFAULT_LOGIN_SETTINGS.login_bg_color,
  };
}

// ============================================================
// getAppLogo — returns the app logo URL
// ============================================================
export async function getAppLogo() {
  return APP_LOGO_URL;
}

// ============================================================
// initializeSheets — creates default settings rows if missing
// (In Apps Script this created sheets; here we just seed Settings)
// ============================================================
export async function initializeSheets() {
  // Seed default settings
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = await db.settings.findUnique({ where: { key: k } });
    if (!existing) {
      await db.settings.upsert({
        where: { key: k },
        update: {},
        create: { key: k, value: v },
      });
    }
  }
  return { ok: true, message: "Database initialized" };
}

// ============================================================
// loginUser — port dari code.gs loginUser
// Cek password utama dulu, lalu password tambahan di UserPasswords
// ============================================================
export async function loginUser(args: any[], _session: any) {
  const [username, password] = args;
  if (!username || !password) {
    return { ok: false, msg: "Username dan password wajib diisi" };
  }

  const user = await db.users.findUnique({
    where: { username: String(username).toLowerCase() },
  });

  if (!user) {
    return { ok: false, msg: "Username atau password salah" };
  }

  if (user.status === "pending") {
    return { ok: false, msg: "Akun belum disetujui admin" };
  }
  if (user.status === "rejected") {
    return { ok: false, msg: "Akun ditolak admin" };
  }
  if (user.status !== "active") {
    return { ok: false, msg: "Akun nonaktif" };
  }

  // Check expiry
  if (user.expiryDate) {
    const exp = new Date(user.expiryDate);
    if (exp.getTime() < Date.now()) {
      return {
        ok: false,
        msg: "EXPIRED",
        expiryDate: exp.toISOString(),
      };
    }
  }

  // Check primary password
  let authenticated = false;
  let loginAsName = "";
  let loginUsername = "";

  if (user.password === password) {
    authenticated = true;
    loginAsName = user.fullName;
    loginUsername = user.username;
  } else {
    // Check secondary passwords in UserPasswords
    const pwdRows = await db.userPasswords.findMany({
      where: { username: user.username, status: "active" },
    });
    for (const p of pwdRows) {
      if (p.password === password) {
        authenticated = true;
        loginAsName = p.nama || user.fullName;
        loginUsername = p.loginUsername || p.username;
        break;
      }
    }
  }

  if (!authenticated) {
    return { ok: false, msg: "Username atau password salah" };
  }

  // Update lastLogin
  await db.users.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  // Create session
  const sessionData: SessionData = {
    username: user.username,
    role: user.role,
    fullName: user.fullName,
    email: user.email,
    expiryDate: user.expiryDate?.toISOString() || null,
    imgAnalAccess: user.imgAnalAccess,
    loginAsName,
    loginUsername,
    createdAt: new Date().toISOString(),
  };
  await setSession(sessionData);

  await logA(user.username, "LOGIN", `Login sebagai ${loginAsName}`, loginUsername);

  return {
    ok: true,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    email: user.email,
    expiryDate: user.expiryDate?.toISOString() || null,
    imgAnalAccess: user.imgAnalAccess,
    loginAsName,
    loginUsername,
  };
}

// ============================================================
// registerUser — port dari code.gs registerUser
// Hanya boleh user pertama yang register (menjadi superadmin)
// ============================================================
export async function registerUser(args: any[], _session: any) {
  const data = args[0] || {};
  const { username, fullName, email, password } = data;

  if (!username || !fullName || !password) {
    return { ok: false, msg: "Username, nama, dan password wajib diisi" };
  }
  if (String(password).length < 6) {
    return { ok: false, msg: "Password minimal 6 karakter" };
  }

  // Lock to prevent race
  while (registerLock) {
    await new Promise((r) => setTimeout(r, 50));
  }
  registerLock = true;

  try {
    const userCount = await db.users.count();
    if (userCount > 0) {
      return { ok: false, msg: "Registrasi ditutup. Hubungi superadmin." };
    }

    const existing = await db.users.findUnique({
      where: { username: String(username).toLowerCase() },
    });
    if (existing) {
      return { ok: false, msg: "Username sudah dipakai" };
    }

    // First user becomes superadmin
    const user = await db.users.create({
      data: {
        username: String(username).toLowerCase(),
        password: String(password),
        fullName: String(fullName),
        email: email || null,
        role: "superadmin",
        status: "active",
        approvedBy: "system",
        approvedDate: new Date(),
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        imgAnalAccess: false,
      },
    });

    await logA(user.username, "REGISTER", "Pendaftaran user pertama (superadmin)");

    return {
      ok: true,
      msg: "Registrasi berhasil. Silakan login.",
      username: user.username,
    };
  } finally {
    registerLock = false;
  }
}

// ============================================================
// getInitData — bootstrap payload untuk frontend setelah login
// Uses the same mappers as the RPC handlers for consistent field shapes
// ============================================================
export async function getInitData(args: any[], session: any) {
  if (!session) return { ok: false, msg: "Unauthorized" };
  const [ownerUsername, role, actualRole] = args;
  const effectiveUsername = ownerUsername || session.username;
  const effectiveRole = role || session.role;
  // actualRole = the real role of the logged-in user (e.g. "superadmin" when
  // using View-As). This is used to decide whether to fetch the full user list
  // (allUsers), so that superadmin can still see & switch accounts even while
  // viewing-as a regular user. Without this, allUsers would be empty when
  // viewing-as a non-superadmin, breaking the View-As dropdown.
  const realRole = actualRole || session.role;

  // Use the master-data handlers so field shapes match exactly
  const [params, lots, teaList, settingsObj, kopObj, allUsers] =
    await Promise.all([
      // getParameters returns mapped shape {paramID, parameter, owner, createdDate, createdBy, bidang}
      import("@/lib/backend/master-data").then((m) =>
        m.getParameters([effectiveUsername, effectiveRole], session)
      ),
      // getLotQC returns mapped shape {lotID, paramID, noLot, ...}
      import("@/lib/backend/master-data").then((m) =>
        m.getLotQC([effectiveUsername, effectiveRole, undefined], session)
      ),
      // getDaftarTEa returns mapped shape
      import("@/lib/backend/master-data").then((m) =>
        m.getDaftarTEa([effectiveUsername, effectiveRole], session)
      ),
      // getSettings returns {key: value}
      import("@/lib/backend/master-data").then((m) =>
        m.getSettings([], session)
      ),
      // getKopSurat returns {key: value}
      import("@/lib/backend/master-data").then((m) =>
        m.getKopSurat([effectiveUsername], session)
      ),
      // getUsers returns {ok, data} — fetch when the REAL logged-in user is a
      // superadmin (not just when effectiveRole is superadmin), so the View-As
      // dropdown stays populated even while viewing-as a regular user.
      realRole === "superadmin"
        ? import("@/lib/backend/users")
            .then((m) =>
              m.getUsers([session.username, session.role], session)
            )
            .then((r: any) =>
              r && Array.isArray(r.data) ? r.data : []
            )
        : Promise.resolve([]),
    ]);

  const userInfo = {
    username: session.username,
    fullName: session.fullName,
    role: session.role,
    email: session.email,
    expiryDate: session.expiryDate,
    imgAnalAccess: session.imgAnalAccess,
    loginAsName: session.loginAsName || "",
    loginUsername: session.loginUsername || "",
  };

  // Check backup trigger status
  const backupTriggerActive = false;

  return {
    ok: true,
    params,
    lots,
    teaList,
    settings: { ...DEFAULT_SETTINGS, ...settingsObj },
    kop: kopObj,
    archiveYears: [] as string[],
    allUsers,
    appLogo: APP_LOGO_URL,
    appName: APP_NAME,
    userInfo,
    backupTriggerActive,
  };
}

// ============================================================
// logout — clears session (called from frontend doLogout)
// ============================================================
export async function logout(_args: any[], _session: any) {
  await clearSession();
  return { ok: true };
}
