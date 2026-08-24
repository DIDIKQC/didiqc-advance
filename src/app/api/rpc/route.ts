// ============================================================
// /api/rpc — RPC dispatcher
// Menerima { fn: string, args: any[] } dan dispatch ke fungsi backend
// yang dipublikasikan di src/lib/backend-handlers.ts
//
// FIX: Tambah retry logic untuk transient PostgreSQL connection errors
// di Vercel Serverless environment.
// Error umum: "Server has closed the connection", "Connection terminated",
// "Connection timed out", "Can't reach database server"
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { sanitizeReturn } from "@/lib/utils-server";
import { handlers, PUBLIC_HANDLERS } from "@/lib/backend-handlers";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ------------------------------------------------------------
// Deteksi apakah error adalah transient connection error
// yang bisa di-retry (PostgreSQL/Prisma di serverless)
// ------------------------------------------------------------
function isTransientConnectionError(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  const transientPatterns = [
    "server has closed the connection",
    "connection terminated",
    "connection timed out",
    "can't reach database server",
    "database connection error",
    "the server closed the connection unexpectedly",
    "terminating connection due to connection timeout",
    "no such host",
    "fetch failed",
    "econnreset",
    "econnrefused",
    "etimedout",
    "socket hang up",
    "prismaclientknownrequesterror",
    // Connection pool exhaustion
    "too many clients already",
    "too many database connections opened",
    "sorry, too many clients",
    "remaining connection slots are reserved",
    "connection pool exhausted",
    "fatal: sorry, too many clients already",
  ];
  return transientPatterns.some((p) => msg.includes(p));
}

// ------------------------------------------------------------
// Retry wrapper dengan exponential backoff
// FIX v9.20: Saat transient connection error (e.g. "Server has closed the
// connection"), Prisma client cache masih memegang koneksi stale. Sebelum
// retry, panggil db.$disconnect() untuk membersihkan connection pool, supaya
// Prisma membuka koneksi baru pada attempt berikutnya.
// ------------------------------------------------------------
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 300
): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt === maxRetries) break;
      if (!isTransientConnectionError(err)) break;

      // FIX v9.20: Drop stale connection pool sebelum retry.
      // Prisma akan reconnect fresh pada attempt berikutnya.
      try {
        await db.$disconnect();
      } catch (dcErr: any) {
        // disconnect error jangan block retry
        console.warn("[rpc] db.$disconnect() failed (ignored):", dcErr?.message);
      }

      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
      console.warn(
        `[rpc] Transient DB error (attempt ${attempt + 1}/${maxRetries + 1}), ` +
          `reconnecting in ${Math.round(delay)}ms: ${err?.message}`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function POST(req: NextRequest) {
  let body: { fn?: string; args?: any[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fn = body.fn;
  const args = Array.isArray(body.args) ? body.args : [];

  if (!fn) {
    return NextResponse.json({ error: "Missing fn" }, { status: 400 });
  }

  // Ping endpoint for health check
  if (fn === "__ping") {
    return NextResponse.json({ ok: true, t: Date.now() });
  }

  const handler = handlers[fn];
  if (!handler) {
    return NextResponse.json(
      { error: `Function "${fn}" not implemented yet`, code: "NOT_IMPLEMENTED" },
      { status: 501 }
    );
  }

  // Auth check — public functions skip auth
  const isPublic = PUBLIC_HANDLERS.has(fn);
  let session = null;
  if (!isPublic) {
    try {
      session = await withRetry(() => getSession(), 2, 200);
    } catch (err: any) {
      console.error(`[rpc] Session error in ${fn}:`, err?.message);
      return NextResponse.json(
        {
          error: "Session validation failed (database connection issue)",
          code: "DB_CONNECTION_ERROR",
          fn,
        },
        { status: 503 }
      );
    }
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
  }

  try {
    const result = await withRetry(() => handler(args, session), 3, 300);
    const sanitized = sanitizeReturn(result);
    return NextResponse.json(sanitized);
  } catch (err: any) {
    console.error(`RPC error in ${fn}:`, err);

    // Return helpful error code untuk transient connection errors
    const isConnErr = isTransientConnectionError(err);
    return NextResponse.json(
      {
        error: err?.message || "Internal server error",
        code: isConnErr ? "DB_CONNECTION_ERROR" : "INTERNAL",
        fn,
        retryable: isConnErr,
      },
      { status: isConnErr ? 503 : 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    app: "didiQCsys v9.12",
    backend: "Next.js RPC",
    endpoints: Object.keys(handlers).length,
  });
}
