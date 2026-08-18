// ============================================================
// Users CRUD + Multi-Password management — port dari code.gs
//
// Fungsi yang dipublikasikan:
// - getUsers, saveUser, deleteUser, approveUser, getUserByUsername
// - getUserPasswords, addUserPassword, deleteUserPassword,
//   editUserPassword, toggleUserPasswordStatus
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
} from "@/lib/utils-server";
import type { SessionData } from "@/lib/session";

const DEFAULT_PASSWORD = "didikqc123";

// ============================================================
// getUsers — superadmin only. Mirror code.gs getUsers(cu,cr)
// Returns array of user objects (matching original GAS shape).
// ============================================================
export async function getUsers(args: any[], _session: SessionData | null) {
  const [_cu, cr] = args;
  try {
    if (cr !== "superadmin")
      return { ok: false, msg: "Akses ditolak" };
    const rows = await db.users.findMany({ orderBy: { username: "asc" } });
    const data = rows.map((u) => ({
      username: u.username,
      password: u.password,
      fullName: u.fullName,
      role: u.role,
      email: u.email || "",
      status: u.status,
      expiryDate: u.expiryDate ? dateToISO(u.expiryDate) : "",
      approvedBy: u.approvedBy || "",
      approvedDate: u.approvedDate ? dateToISO(u.approvedDate) : "",
      createdDate: fD(u.createdDate),
      lastLogin: u.lastLogin ? fDT(u.lastLogin) : "",
      imgAnalAccess: u.imgAnalAccess,
    }));
    return { ok: true, data };
  } catch (e: any) {
    console.error("getUsers error:", e);
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// saveUser — superadmin only. Create or update by username.
// payload: {isNew, username, fullName, email, password, role, status,
//           expiryDate, imgAnalAccess}
// ============================================================
export async function saveUser(args: any[], _session: SessionData | null) {
  const [payload, callerRole] = args as [any, string];
  if (callerRole !== "superadmin") return { ok: false, msg: "Akses ditolak" };
  if (!payload || !payload.username)
    return { ok: false, msg: "Username wajib diisi" };

  const username = String(payload.username).toLowerCase();

  try {
    if (payload.isNew) {
      // Create
      const existing = await db.users.findUnique({ where: { username } });
      if (existing) return { ok: false, msg: "Username sudah ada" };

      const expiry = payload.expiryDate
        ? new Date(payload.expiryDate)
        : (() => {
            const d = new Date();
            d.setFullYear(d.getFullYear() + 1);
            return d;
          })();

      await db.users.create({
        data: {
          username,
          password: String(payload.password || DEFAULT_PASSWORD),
          fullName: String(payload.fullName || ""),
          role: payload.role || "user",
          email: payload.email || null,
          status: payload.status || "active",
          otp: null,
          otpExpiry: null,
          expiryDate: isNaN(expiry.getTime()) ? null : expiry,
          approvedBy: "",
          approvedDate: null,
          lastLogin: null,
          imgAnalAccess: !!payload.imgAnalAccess,
        },
      });
      await logA(
        username,
        "CREATE_USER",
        `Buat user baru: ${username} (role: ${payload.role || "user"})`
      );
      return { ok: true };
    }

    // Update — find by username (case-insensitive match)
    const target = await db.users.findUnique({ where: { username } });
    if (!target) return { ok: false, msg: "User tidak ditemukan" };

    const data: any = {};
    if (payload.fullName) data.fullName = String(payload.fullName);
    if (payload.role) data.role = payload.role;
    if (payload.email !== undefined) data.email = payload.email || null;
    if (payload.status) data.status = payload.status;
    if (payload.password) data.password = String(payload.password);
    if (payload.expiryDate) {
      const d = new Date(payload.expiryDate);
      if (!isNaN(d.getTime())) data.expiryDate = d;
    }
    // imgAnalAccess always updated (matches original behavior)
    data.imgAnalAccess = !!payload.imgAnalAccess;

    await db.users.update({ where: { id: target.id }, data });
    await logA(username, "EDIT_USER", `Update user: ${username}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// deleteUser — superadmin only. Delete by username.
// ============================================================
export async function deleteUser(args: any[], _session: SessionData | null) {
  const [tu, cr] = args as [string, string];
  if (cr !== "superadmin") return { ok: false, msg: "Akses ditolak" };
  try {
    const target = await db.users.findUnique({
      where: { username: String(tu).toLowerCase() },
    });
    if (!target) return { ok: false, msg: "User tidak ditemukan" };
    await db.users.delete({ where: { id: target.id } });
    // Also delete any secondary passwords
    await db.userPasswords.deleteMany({
      where: { username: target.username },
    });
    await logA(target.username, "DELETE_USER", `Hapus user: ${target.username}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// approveUser — set status active/rejected, ApprovedBy, ApprovedDate.
// args: [targetUsername, action, approverUsername, expiryDate]
// NOTE (Task 34): The role is NOT passed in args (args[2] is the approver
// username, not role). Gate on session.role instead — the original code
// had NO role check at all, allowing any authenticated user to approve/
// reject pending users via direct RPC. Frontend already hides the
// approve/reject buttons for non-superadmin via loadUsers() guard, but
// the backend must enforce the same rule independently.
// ============================================================
export async function approveUser(args: any[], _session: SessionData | null) {
  // Role gate — only superadmin may approve/reject users.
  if (_session?.role !== "superadmin")
    return { ok: false, msg: "Akses ditolak (superadmin only)" };
  const [tu, action, au, ed] = args as [string, string, string, string?];
  try {
    const target = await db.users.findUnique({
      where: { username: String(tu).toLowerCase() },
    });
    if (!target) return { ok: false, msg: "User tidak ditemukan" };

    const newStatus = action === "approve" ? "active" : "rejected";
    const data: any = {
      status: newStatus,
      approvedBy: au || "",
      approvedDate: new Date(),
    };
    if (action === "approve" && ed) {
      const d = new Date(ed);
      if (!isNaN(d.getTime())) data.expiryDate = d;
    }

    await db.users.update({ where: { id: target.id }, data });
    await logA(au || "system", String(action).toUpperCase() + "_USER", tu);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// ============================================================
// getUserByUsername — returns user record (with id as _row equiv)
// NOTE (Task 34): Privilege-escalation fix. Original returned the FULL
// record (password hash + OTP + OTP expiry) to ANY authenticated caller
// with no role/identity gate. Now gated: only superadmin OR self
// (caller === target username, case-insensitive) may fetch. Sensitive
// fields (password, otp, otpExpiry) are stripped from the returned
// object — they are never needed by the frontend; if a code path needs
// to verify a password, it must do so via auth.ts loginUser, not here.
// ============================================================
export async function getUserByUsername(args: any[], _session: SessionData | null) {
  const username = args[0];
  if (!username) return null;

  // Identity gate — superadmin OR self (caller is the target user).
  // Use activeUsername (View-As target) when set, else session.username.
  const callerRole = _session?.role;
  const callerUsername =
    _session?.activeUsername || _session?.username || "";
  if (
    callerRole !== "superadmin" &&
    callerUsername.toLowerCase() !== String(username).toLowerCase()
  ) {
    return null;
  }

  try {
    const u = await db.users.findUnique({
      where: { username: String(username).toLowerCase() },
    });
    if (!u) return null;
    return {
      id: u.id,
      _row: u.id,
      username: u.username,
      // Sensitive fields stripped (password, otp, otpExpiry).
      fullName: u.fullName,
      role: u.role,
      email: u.email,
      status: u.status,
      expiryDate: u.expiryDate ? u.expiryDate.toISOString() : null,
      approvedBy: u.approvedBy,
      approvedDate: u.approvedDate ? u.approvedDate.toISOString() : null,
      createdDate: u.createdDate ? u.createdDate.toISOString() : null,
      lastLogin: u.lastLogin ? u.lastLogin.toISOString() : null,
      imgAnalAccess: u.imgAnalAccess,
    };
  } catch (e) {
    return null;
  }
}

// ============================================================
// MULTI-PASSWORD MANAGEMENT
// ============================================================

// getUserPasswords — superadmin only. Returns all secondary passwords
// for the given target username.
export async function getUserPasswords(
  args: any[],
  _session: SessionData | null
) {
  const [targetUsername, callerRole] = args as [string, string];
  try {
    if (callerRole !== "superadmin") return { ok: false, msg: "Akses ditolak" };
    const rows = await db.userPasswords.findMany({
      where: { username: String(targetUsername).toLowerCase() },
      orderBy: { id: "asc" },
    });
    const data = rows.map((p) => ({
      id: p.id,
      _row: p.id,
      username: p.username,
      password: p.password,
      nama: p.nama || "",
      createdBy: p.createdBy || "",
      createdDate: fD(p.createdDate),
      note: p.note || "",
      loginUsername: p.loginUsername || "",
      status: p.status || "active",
    }));
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// addUserPassword — superadmin only.
// payload: {targetUsername, newPassword, nama, note, loginUsername}
export async function addUserPassword(
  args: any[],
  _session: SessionData | null
) {
  const [payload, callerRole, callerUsername] = args as [any, string, string];
  try {
    if (callerRole !== "superadmin") return { ok: false, msg: "Akses ditolak" };
    if (!payload || !payload.targetUsername || !payload.newPassword)
      return { ok: false, msg: "Username dan password wajib" };
    if (String(payload.newPassword).length < 6)
      return { ok: false, msg: "Password min 6 karakter" };

    const username = String(payload.targetUsername).toLowerCase();
    const user = await db.users.findUnique({ where: { username } });
    if (!user) return { ok: false, msg: "User tidak ditemukan" };

    await db.userPasswords.create({
      data: {
        username: user.username,
        password: String(payload.newPassword),
        nama: payload.nama || "",
        createdBy: callerUsername || "",
        note: payload.note || "",
        loginUsername: payload.loginUsername || "",
        status: "active",
      },
    });
    await logA(
      callerUsername || "system",
      "ADD_USERPWD",
      "Tambah password untuk: " + payload.targetUsername
    );
    return { ok: true, msg: "Password tambahan berhasil ditambahkan" };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// deleteUserPassword — superadmin only.
export async function deleteUserPassword(
  args: any[],
  _session: SessionData | null
) {
  const [targetUsername, targetPwd, callerRole, callerUsername] = args as [
    string,
    string,
    string,
    string
  ];
  try {
    if (callerRole !== "superadmin") return { ok: false, msg: "Akses ditolak" };
    const username = String(targetUsername).toLowerCase();
    const rows = await db.userPasswords.findMany({
      where: { username, password: String(targetPwd) },
    });
    if (rows.length === 0)
      return { ok: false, msg: "Password tidak ditemukan" };
    await db.userPasswords.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    await logA(
      callerUsername || "system",
      "DEL_USERPWD",
      "Hapus password untuk: " + targetUsername
    );
    return { ok: true, msg: "Password dihapus" };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// editUserPassword — superadmin only.
// payload: {targetUsername, oldPassword, newPassword, nama, note, loginUsername}
export async function editUserPassword(
  args: any[],
  _session: SessionData | null
) {
  const [payload, callerRole, callerUsername] = args as [any, string, string];
  try {
    if (callerRole !== "superadmin") return { ok: false, msg: "Akses ditolak" };
    if (!payload || !payload.targetUsername || !payload.oldPassword)
      return { ok: false, msg: "Data tidak lengkap" };

    const username = String(payload.targetUsername).toLowerCase();
    const rows = await db.userPasswords.findMany({
      where: { username, password: String(payload.oldPassword) },
    });
    if (rows.length === 0)
      return { ok: false, msg: "Password tidak ditemukan" };

    const data: any = {};
    if (payload.newPassword) data.password = String(payload.newPassword);
    if (payload.nama !== undefined) data.nama = payload.nama;
    if (payload.note !== undefined) data.note = payload.note;
    if (payload.loginUsername !== undefined)
      data.loginUsername = payload.loginUsername;

    if (Object.keys(data).length > 0) {
      await db.userPasswords.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data,
      });
    }
    await logA(
      callerUsername || "system",
      "EDIT_USERPWD",
      "Edit password untuk: " + payload.targetUsername
    );
    return { ok: true, msg: "Password berhasil diperbarui" };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}

// toggleUserPasswordStatus — superadmin only.
// args: [targetUsername, targetPwd, newStatus, callerRole, callerUsername]
export async function toggleUserPasswordStatus(
  args: any[],
  _session: SessionData | null
) {
  const [targetUsername, targetPwd, newStatus, callerRole, callerUsername] =
    args as [string, string, string, string, string];
  try {
    if (callerRole !== "superadmin") return { ok: false, msg: "Akses ditolak" };
    if (newStatus !== "active" && newStatus !== "inactive")
      return { ok: false, msg: "Status tidak valid" };

    const username = String(targetUsername).toLowerCase();
    const rows = await db.userPasswords.findMany({
      where: { username, password: String(targetPwd) },
    });
    if (rows.length === 0)
      return { ok: false, msg: "Password tidak ditemukan" };

    await db.userPasswords.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: newStatus },
    });
    await logA(
      callerUsername || "system",
      "STATUS_USERPWD",
      newStatus + " password untuk: " + targetUsername
    );
    return { ok: true, msg: "Status diubah ke " + newStatus };
  } catch (e: any) {
    return { ok: false, msg: e.message || String(e) };
  }
}
