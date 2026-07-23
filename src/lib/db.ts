// ============================================================
// db.ts — Prisma Client (Serverless-optimized for Vercel)
// ============================================================
// FIX: "Server has closed the connection" error di Vercel
//
// Root cause:
//   1. Prisma Client tidak di-cache ke globalThis di production
//      → setiap warm lambda invocation membuat instance baru
//      → connection pool boros & cepat habis
//   2. Default connection_limit=10 terlalu banyak untuk serverless
//   3. Tidak ada retry logic untuk transient connection errors
//
// Solusi:
//   - Selalu cache Prisma Client ke globalThis (production & dev)
//   - Connection params di DATABASE_URL: connection_limit=1, pool_timeout=20
//   - Retry logic di RPC handler level
// ============================================================

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Create Prisma Client dengan log minimal
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: ["error", "warn"],
    // Connection pool params diatur via DATABASE_URL query string:
    //   ?connection_limit=1&pool_timeout=20&connect_timeout=15&socket_timeout=30
    // Ini lebih reliable daripada datasources override
  });
}

// ALWAYS cache ke globalThis, even in production.
// Di Vercel serverless, warm lambda invocations reuse globalThis,
// sehingga Prisma Client instance dan connection pool-nya tetap hidup
// antar invocations. Ini menghindari pembukaan koneksi baru setiap request.
export const db = globalForPrisma.prisma ?? createPrismaClient();

// Always set ke global (production + development)
globalForPrisma.prisma = db;

// Graceful shutdown hook — ensure connections ditutup saat lambda freeze/exit
if (process.env.NODE_ENV === "production") {
  // Di Vercel serverless, jangan panggil $disconnect() secara eager
  // karena akan memutus connection pool yang masih dibutuhkan warm invocations
  // Lambda akan handle cleanup otomatis saat instance di-destroy
}
