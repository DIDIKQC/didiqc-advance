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
    // URL tidak bisa diparse: scrub password lalu potong, agar endpoint
    // publik tetap aman sekaligus tetap informatif untuk diagnosa.
    const scrub = url.replace(/(\/\/[^:/@]+:)([^@]*)@/, "$1***@");
    return scrub.substring(0, 80) + "...";
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
  let client: PrismaClient;
  try {
    client = new PrismaClient({
      datasources: { db: { url } },
      log: [],
    });
  } catch (err: any) {
    result.error = err?.message || String(err);
    return result;
  }
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

// Bangun URL uji tanpa pernah melempar — nilai env yang tidak valid
// tidak boleh membuat endpoint diagnostik ini 500.
function safeBuildUrl(baseUrl: string, extraParams: Record<string, string>): string | null {
  try {
    return buildUrl(baseUrl, extraParams);
  } catch {
    return null;
  }
}

export async function GET() {
  const rawUrl = process.env.DATABASE_URL || "NOT SET";
  const tests: any[] = [];

  if (!rawUrl.startsWith("file:")) {
    // Test 1: Raw URL (tanpa modifikasi)
    tests.push(await testConnection("1. Raw URL", rawUrl));

    const variants: Array<[string, Record<string, string>]> = [
      ["2. +sslmode=require", { sslmode: "require" }],
      ["3. +sslmode+pgbouncer", { sslmode: "require", pgbouncer: "true" }],
      ["4. +sslmode+timeout60", { sslmode: "require", connect_timeout: "60" }],
    ];
    for (const [label, extra] of variants) {
      const u = safeBuildUrl(rawUrl, extra);
      if (u) {
        tests.push(await testConnection(label, u));
      } else {
        tests.push({
          label,
          url: null,
          ok: false,
          error: `DATABASE_URL tidak bisa diparse sebagai URL — periksa nilai env (head: ${maskUrl(rawUrl)})`,
        });
      }
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    rawUrl: maskUrl(rawUrl),
    rawUrlLength: rawUrl.length,
    nodeEnv: process.env.NODE_ENV,
    tests,
  });
}
