// ============================================================
// db.ts — Prisma Client (Serverless-optimized for Vercel)
// ============================================================
// FIX: "Server has closed the connection" & "Too many clients already"
// errors di Vercel Serverless + InsForge PostgreSQL.
//
// Root cause:
//   1. Prisma Client tidak di-cache ke globalThis di production
//      → setiap warm lambda invocation membuat instance baru
//   2. Default connection_limit=10 per instance terlalu banyak
//      → InsForge PostgreSQL punya connection limit rendah
//      → N lambdas × 10 = exceeded pool
//   3. Tidak ada retry logic untuk transient connection errors
//
// Solusi:
//   - Force connection_limit=1 di runtime (append ke DATABASE_URL)
//   - Selalu cache Prisma Client ke globalThis (production & dev)
//   - Retry logic di RPC handler level
// ============================================================

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// ------------------------------------------------------------
// Force connection pooling params untuk serverless safety.
// Append ke DATABASE_URL jika belum ada param-nya.
// Ini critical karena InsForge PostgreSQL punya connection limit
// rendah dan Vercel serverless bisa spin up banyak instances.
// ------------------------------------------------------------
function getOptimizedDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Please configure it in environment variables."
    );
  }

  // SQLite (file:) URLs don't support connection pool params — adding them
  // breaks the file path (e.g. dev.db?connection_limit=1 doesn't exist).
  // Return as-is for SQLite.
  if (baseUrl.startsWith("file:")) {
    return baseUrl;
  }

  // Parse URL untuk check existing query params (PostgreSQL only)
  const url = new URL(baseUrl);
  const params = url.searchParams;

  // Force connection_limit=1 (Vercel serverless best practice)
  // 1 connection per lambda instance = safe untuk InsForge
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

  // socket_timeout: query timeout (hindari hang)
  if (!params.has("socket_timeout")) {
    params.set("socket_timeout", "30");
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
// Di Vercel serverless, warm lambda invocations reuse globalThis,
// sehingga Prisma Client instance dan connection pool-nya tetap hidup
// antar invocations. Ini menghindari pembukaan koneksi baru setiap request.
export const db = globalForPrisma.prisma ?? createPrismaClient();

// Always set ke global (production + development)
globalForPrisma.prisma = db;
