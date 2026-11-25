// ============================================================
// db.ts — Prisma Client (Serverless-optimized for Vercel)
// ============================================================
// FIX: "Server has closed the connection" & "Too many clients already"
// errors di Vercel Serverless + InsForge PostgreSQL.
//
// Root cause:
//   1. Cloud PostgreSQL (InsForge, Neon, Supabase) wajib SSL.
//      Tanpa sslmode, koneksi TCP diterima lalu langsung ditutup.
//   2. Prisma Client tidak di-cache ke globalThis di production
//      → setiap warm lambda invocation membuat instance baru
//   3. Default connection_limit=10 per instance terlalu banyak
//      → InsForge PostgreSQL punya connection limit rendah
//   4. Provider pakai PgBouncer (transaction mode) yang menutup
//      koneksi antar transaksi — perlu pgbouncer=true di URL.
//
// Solusi:
//   - Force sslmode=require (kebanyakan cloud PG wajib SSL)
//   - Force connection_limit=1 di runtime
//   - Selalu cache Prisma Client ke globalThis
//   - Retry logic di RPC handler level
//   - Auto-reconnect pada first query (lazy connect with retry)
// ============================================================

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// ------------------------------------------------------------
// Sanitasi DATABASE_URL dari kesalahan umum saat paste di Vercel:
// whitespace/newline di awal-akhir dan satu pasang pembungkus
// kutip ("..."/'...'/`...`) dibersihkan sebelum dipakai.
// ------------------------------------------------------------
function sanitizeDatabaseUrl(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  const quotes = ['"', "'", "`"];
  for (let i = 0; i < 2 && s.length >= 2; i++) {
    if (quotes.includes(s[0]) && quotes.includes(s[s.length - 1])) {
      s = s.slice(1, -1).trim();
    }
  }
  return s;
}

// Placeholder netral: PrismaClient tetap bisa dibuat sehingga BUILD
// tidak pernah gagal karena DATABASE_URL (throw di top-level module
// membuat `next build` exit 1 pada "Collecting page data").
// Query tetap akan gagal jelas saat runtime sampai env diperbaiki.
const PLACEHOLDER_URL =
  "postgresql://db_url_not_set:db_url_not_set@localhost:5432/db_url_not_set";

// ------------------------------------------------------------
// Force connection pooling params untuk serverless safety.
// Append ke DATABASE_URL jika belum ada param-nya.
// ------------------------------------------------------------
function getOptimizedDatabaseUrl(): string {
  const baseUrl = sanitizeDatabaseUrl(process.env.DATABASE_URL);
  if (!baseUrl) {
    console.warn(
      "[db.ts] DATABASE_URL tidak terbaca (kosong/tidak diset) — dipakai placeholder agar build tidak gagal. Perbaiki DATABASE_URL di environment variables."
    );
    return PLACEHOLDER_URL;
  }

  // SQLite (file:) URLs don't support connection pool params
  if (baseUrl.startsWith("file:")) {
    return baseUrl;
  }

  // Parse URL untuk check existing query params (PostgreSQL only)
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    console.warn(
      "[db.ts] DATABASE_URL tidak valid sebagai URL — dipakai placeholder agar build tidak gagal. Perbaiki nilai DATABASE_URL (tanpa kutip/spasi)."
    );
    return PLACEHOLDER_URL;
  }
  const params = url.searchParams;

  // CRITICAL FIX: sslmode=require
  // InsForge dan kebanyakan cloud PostgreSQL WAJIB SSL.
  // Tanpa ini, koneksi diterima lalu langsung ditutup oleh server,
  // menyebabkan "Server has closed the connection".
  if (!params.has("sslmode")) {
    params.set("sslmode", "require");
  }

  // Force connection_limit=1 (Vercel serverless best practice)
  if (!params.has("connection_limit")) {
    params.set("connection_limit", "1");
  }

  // pool_timeout: berapa lama wait untuk connection tersedia
  if (!params.has("pool_timeout")) {
    params.set("pool_timeout", "20");
  }

  // connect_timeout: berapa lama wait untuk establish connection
  if (!params.has("connect_timeout")) {
    params.set("connect_timeout", "15");
  }

  // socket_timeout: query timeout
  if (!params.has("socket_timeout")) {
    params.set("socket_timeout", "30");
  }

  // pgbouncer=true: untuk provider yang pakai PgBouncer
  // (menonaktifkan prepared statements yang tidak kompatibel)
  if (!params.has("pgbouncer")) {
    params.set("pgbouncer", "true");
  }

  return url.toString();
}

// Create Prisma Client dengan optimized DATABASE_URL
function createPrismaClient(): PrismaClient {
  const optimizedUrl = getOptimizedDatabaseUrl();
  return new PrismaClient({
    log: ["error", "warn"],
    datasources: {
      db: {
        url: optimizedUrl,
      },
    },
  });
}

// ALWAYS cache ke globalThis, even in production.
export const db = globalForPrisma.prisma ?? createPrismaClient();

// Always set ke global (production + development)
globalForPrisma.prisma = db;
