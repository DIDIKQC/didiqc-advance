// ============================================================
// /api/db-test — Diagnostic endpoint untuk test koneksi DB
// ============================================================

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url.substring(0, 80) + "...";
  }
}

function buildUrl(baseUrl: string, extraParams: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(extraParams)) {
    if (!url.searchParams.has(k)) url.searchParams.set(k, v);
  }
  return url.toString();
}

async function testConnection(label: string, url: string) {
  const result: Record<string, any> = { label, url: maskUrl(url), ok: false, error: null };
  const client = new PrismaClient({
    datasources: { db: { url } },
    log: [],
  });
  try {
    await client.$connect();
    const count = await client.settings.count();
    result.ok = true;
    result.settingsCount = count;
  } catch (err: any) {
    result.error = err?.message || String(err);
    // Extract useful info from error
    if (err?.code) result.errorCode = err.code;
    if (err?.meta) result.meta = JSON.stringify(err.meta);
  } finally {
    try { await client.$disconnect(); } catch {}
  }
  return result;
}

export async function GET() {
  const rawUrl = process.env.DATABASE_URL || "NOT SET";
  const tests: any[] = [];

  if (!rawUrl.startsWith("file:")) {
    // Test 1: Raw URL (tanpa modifikasi)
    tests.push(await testConnection("1. Raw URL", rawUrl));

    // Test 2: + sslmode=require
    tests.push(await testConnection("2. +sslmode=require", buildUrl(rawUrl, { sslmode: "require" })));

    // Test 3: + sslmode=require + pgbouncer=true
    tests.push(await testConnection("3. +sslmode+pgbouncer", buildUrl(rawUrl, { sslmode: "require", pgbouncer: "true" })));

    // Test 4: + sslmode=require + connect_timeout=60
    tests.push(await testConnection("4. +sslmode+timeout60", buildUrl(rawUrl, { sslmode: "require", connect_timeout: "60" })));
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    rawUrl: maskUrl(rawUrl),
    nodeEnv: process.env.NODE_ENV,
    tests,
  });
}
