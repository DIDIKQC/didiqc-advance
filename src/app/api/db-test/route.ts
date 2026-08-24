// ============================================================
// /api/db-test — Diagnostic endpoint untuk test koneksi DB
// Hanya untuk debugging, bisa dihapus setelah masalah teratasi.
// ============================================================

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result: Record<string, any> = {
    timestamp: new Date().toISOString(),
    dbUrlPrefix: "",
    sslmode: false,
    pgbouncer: false,
    connectionOk: false,
    queryOk: false,
    error: null,
    settingsCount: null,
  };

  try {
    // Cek DATABASE_URL prefix (tanpa password)
    const rawUrl = process.env.DATABASE_URL || "NOT SET";
    try {
      const u = new URL(rawUrl);
      result.dbUrlPrefix = `${u.protocol}//${u.username}:***@${u.hostname}:${u.port}${u.pathname}`;
      result.sslmode = u.searchParams.has("sslmode");
      result.pgbouncer = u.searchParams.has("pgbouncer");
    } catch {
      result.dbUrlPrefix = rawUrl.startsWith("file:") ? "file:... (SQLite)" : rawUrl.substring(0, 50) + "...";
    }

    // Test 1: Connect
    await db.$connect();
    result.connectionOk = true;

    // Test 2: Simple query
    const count = await db.settings.count();
    result.queryOk = true;
    result.settingsCount = count;

    await db.$disconnect();
  } catch (err: any) {
    result.error = {
      message: err?.message || String(err),
      code: err?.code,
      meta: err?.meta,
    };
    try {
      await db.$disconnect();
    } catch {}
  }

  return NextResponse.json(result);
}
