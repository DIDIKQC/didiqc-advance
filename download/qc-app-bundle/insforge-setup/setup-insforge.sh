#!/bin/bash
# ============================================================
# setup-insforge.sh — Setup script untuk InsForge deployment
# ============================================================
# Jalankan di PC lokal setelah extract source-code.zip
#
# Usage:
#   chmod +x setup-insforge.sh
#   ./setup-insforge.sh
# ============================================================

set -e

echo "🚀 Setup didiQCsys untuk InsForge (PostgreSQL)"
echo "=============================================="
echo ""

# Cek apakah .env sudah ada
if [ ! -f .env ]; then
  echo "❌ File .env belum ada!"
  echo "   Jalankan: cp ../.env.example .env"
  echo "   Lalu edit .env dengan DATABASE_URL InsForge Anda"
  exit 1
fi

# Cek apakah DATABASE_URL mengandung postgresql
if ! grep -q "postgresql://" .env; then
  echo "❌ DATABASE_URL di .env belum menunjuk ke PostgreSQL!"
  echo "   Edit .env dan ganti DATABASE_URL dengan connection string InsForge"
  echo "   Contoh: DATABASE_URL=\"postgresql://user:pass@host:5432/db?sslmode=require\""
  exit 1
fi

echo "✅ .env terdeteksi dengan PostgreSQL URL"
echo ""

# Backup schema lama
if [ -f prisma/schema.prisma ] && ! grep -q "postgresql" prisma/schema.prisma; then
  echo "📦 Backup schema SQLite..."
  cp prisma/schema.prisma prisma/schema.sqlite.bak
fi

# Ganti dengan schema PostgreSQL
if [ -f ../insforge-setup/schema.postgresql.prisma ]; then
  echo "📦 Install schema PostgreSQL..."
  cp ../insforge-setup/schema.postgresql.prisma prisma/schema.prisma
fi

# Copy script migrasi
if [ -f ../insforge-setup/migrate-from-json.ts ]; then
  echo "📦 Copy script migrasi..."
  cp ../insforge-setup/migrate-from-json.ts ./
fi

# Copy database-export.json untuk migrasi
if [ -f ../database-export.json ]; then
  echo "📦 Copy database-export.json..."
  cp ../database-export.json ./
fi

echo ""
echo "📦 Install dependencies..."
bun install

echo ""
echo "🔧 Generate Prisma client..."
bunx prisma generate

echo ""
echo "🗄️  Push schema ke InsForge (membuat 23 tabel)..."
bunx prisma db push

echo ""
echo "📥 Migrasi data dari JSON ke InsForge..."
bun run migrate-from-json.ts

echo ""
echo "✅ SETUP SELESAI!"
echo ""
echo "Langkah selanjutnya:"
echo "  1. Test aplikasi: bun run dev"
echo "  2. Buka http://localhost:3000"
echo "  3. Verifikasi data via: bunx prisma studio"
echo "  4. Push ke GitHub: git init && git add . && git commit -m 'init' && git push"
echo "  5. Import ke Vercel/Netlify"
echo ""
echo "Panduan lengkap: deployment/PANDUAN-DEPLOY-INSFORGE-GITHUB-VERCEL.md"
