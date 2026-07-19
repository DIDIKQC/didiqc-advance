// ============================================================
// /api/rpc — RPC dispatcher
// Menerima { fn: string, args: any[] } dan dispatch ke fungsi backend
// yang dipublikasikan di src/lib/backend-handlers.ts
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { sanitizeReturn } from "@/lib/utils-server";
import { handlers, PUBLIC_HANDLERS } from "@/lib/backend-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
  }

  try {
    const result = await handler(args, session);
    const sanitized = sanitizeReturn(result);
    return NextResponse.json(sanitized);
  } catch (err: any) {
    console.error(`RPC error in ${fn}:`, err);
    return NextResponse.json(
      {
        error: err?.message || "Internal server error",
        code: "INTERNAL",
        fn,
      },
      { status: 500 }
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
