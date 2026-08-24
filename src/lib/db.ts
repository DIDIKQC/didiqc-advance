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
// Force connection pooling params untuk serverless safety.
// Append ke DATABASE_URL jika belum ada param-nya.
// ------------------------------------------------------------
function getOptimizedDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Please configure it in environment variables."
    );
  }

  // SQLite (file:) URLs don't support connection pool params
  if (baseUrl.startsWith("file:")) {
    return baseUrl;
  }

  // Parse URL untuk check existing query params (PostgreSQL only)
  const url = new URL(baseUrl);
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
