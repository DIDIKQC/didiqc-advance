/**
 * next.config.ts — Konfigurasi untuk Vercel & Netlify
 *
 * Untuk deploy di Vercel: TIDAK PERLU perubahan (default sudah support)
 * Untuk deploy di Netlify: Uncomment baris "output: 'standalone'"
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // === UNTUK NETLIFY ===
  // Uncomment baris berikut jika deploy ke Netlify:
  // output: 'standalone',

  // === PRODUCTION ===
  // Aktifkan experimental features jika diperlukan
  // experimental: {
  //   serverActions: { bodySizeLimit: '10mb' },
  // },

  // === ENVIRONMENT VARIABLES ===
  // Hanya expose env vars yang aman ke client
  env: {
    // Contoh: NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },

  // === IMAGES ===
  // Jika menggunakan next/image dengan external domains
  // images: {
  //   remotePatterns: [
  //     { protocol: 'https', hostname: '**' },
  //   ],
  // },
};

export default nextConfig;
