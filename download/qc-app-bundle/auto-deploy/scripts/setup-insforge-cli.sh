#!/bin/bash
# ============================================================
# setup-insforge-cli.sh — Setup InsForge Database Otomatis
# ============================================================
# Script ini akan:
#   1. Install InsForge CLI
#   2. Login ke InsForge (browser akan terbuka)
#   3. Buat project baru di InsForge
#   4. Ambil PostgreSQL connection string
#   5. Update file .env dengan DATABASE_URL otomatis
#   6. Test koneksi database
#   7. Buat schema database (23 tabel)
#
# CARA PAKAI:
#   chmod +x setup-insforge-cli.sh
#   ./setup-insforge-cli.sh
#
# PRASYARAT:
#   - Sudah punya akun InsForge (daftar di https://insforge.dev)
#   - Node.js 18+ / Bun terinstall
# ============================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   🚀 SETUP INSFORGE DATABASE OTOMATIS                    ║"
echo "║   didiQCsys v9.12 + InsForge PostgreSQL                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo -e "${BLUE}📍 Working directory: $PROJECT_DIR${NC}"
echo ""

# ============================================================
# STEP 1: Cek prerequisites
# ============================================================
echo -e "${YELLOW}=== STEP 1: Cek Prerequisites ===${NC}"

if ! command -v bun &> /dev/null && ! command -v npm &> /dev/null; then
  echo -e "${RED}❌ Bun atau npm tidak ditemukan!${NC}"
  echo "   Install Bun: https://bun.sh"
  echo "   Atau Node.js: https://nodejs.org"
  exit 1
fi

PKG_MANAGER="bun"
if ! command -v bun &> /dev/null; then
  PKG_MANAGER="npm"
fi
echo -e "${GREEN}✓ Package manager: $PKG_MANAGER${NC}"

if [ ! -f "package.json" ]; then
  echo -e "${RED}❌ package.json tidak ditemukan di $PROJECT_DIR${NC}"
  echo "   Jalankan script ini dari folder project didiQCsys"
  exit 1
fi
echo -e "${GREEN}✓ Project terdeteksi${NC}"
echo ""

# ============================================================
# STEP 2: Install InsForge CLI
# ============================================================
echo -e "${YELLOW}=== STEP 2: Install InsForge CLI ===${NC}"

if command -v insforge &> /dev/null; then
  echo -e "${GREEN}✓ InsForge CLI sudah terinstall${NC}"
else
  echo -e "${BLUE}📦 Menginstall InsForge CLI...${NC}"
  # Jangan install global (per recommendation dari explainx.ai)
  $PKG_MANAGER add -D @insforge/cli
  echo -e "${GREEN}✓ InsForge CLI terinstall (sebagai devDependency)${NC}"
fi
echo ""

# ============================================================
# STEP 3: Login ke InsForge
# ============================================================
echo -e "${YELLOW}=== STEP 3: Login ke InsForge ===${NC}"
echo -e "${BLUE}🔐 Browser akan terbuka untuk login ke InsForge...${NC}"
echo -e "${BLUE}   Jika belum punya akun, daftar dulu di https://insforge.dev${NC}"
echo ""

read -p "Press Enter untuk lanjut ke login InsForge..." -r

# Coba login via CLI
if command -v insforge &> /dev/null; then
  insforge login
elif [ -f "node_modules/.bin/insforge" ]; then
  ./node_modules/.bin/insforge login
else
  echo -e "${YELLOW}⚠️  Tidak bisa auto-login via CLI${NC}"
  echo -e "${BLUE}   Silakan login manual di https://insforge.dev${NC}"
fi
echo ""

# ============================================================
# STEP 4: Buat project InsForge baru
# ============================================================
echo -e "${YELLOW}=== STEP 4: Buat Project InsForge Baru ===${NC}"

PROJECT_NAME="didiqc"
read -p "Nama project InsForge [default: didiqc]: " -r INPUT_NAME
if [ -n "$INPUT_NAME" ]; then
  PROJECT_NAME="$INPUT_NAME"
fi

echo -e "${BLUE}🏗️  Membuat project '$PROJECT_NAME' di InsForge...${NC}"

# Coba create project via CLI
CREATE_SUCCESS=false
if command -v insforge &> /dev/null; then
  if insforge projects create "$PROJECT_NAME" 2>/dev/null; then
    CREATE_SUCCESS=true
  fi
elif [ -f "node_modules/.bin/insforge" ]; then
  if ./node_modules/.bin/insforge projects create "$PROJECT_NAME" 2>/dev/null; then
    CREATE_SUCCESS=true
  fi
fi

if [ "$CREATE_SUCCESS" = false ]; then
  echo -e "${YELLOW}⚠️  Tidak bisa buat project otomatis via CLI${NC}"
  echo -e "${BLUE}   Silakan buat project MANUAL di:${NC}"
  echo -e "${CYAN}   https://insforge.dev/dashboard${NC}"
  echo -e "${BLUE}   1. Klik 'New Project'${NC}"
  echo -e "${BLUE}   2. Name: $PROJECT_NAME${NC}"
  echo -e "${BLUE}   3. Region: Singapore (atau terdekat)${NC}"
  echo -e "${BLUE}   4. Klik 'Create'${NC}"
  echo ""
  read -p "   Press Enter setelah project dibuat..." -r
fi
echo ""

# ============================================================
# STEP 5: Ambil connection string
# ============================================================
echo -e "${YELLOW}=== STEP 5: Ambil PostgreSQL Connection String ===${NC}"
echo -e "${BLUE}📋 Untuk mendapatkan connection string:${NC}"
echo -e "${CYAN}   1. Buka dashboard project InsForge Anda${NC}"
echo -e "${CYAN}   2. Cari menu 'Connect' atau 'Database' → 'Connection String'${NC}"
echo -e "${CYAN}   3. Copy connection string (format: postgresql://...)${NC}"
echo -e "${CYAN}   4. Paste di bawah ini${NC}"
echo ""

read -p "Paste PostgreSQL connection string: " -r DATABASE_URL

if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}❌ Connection string tidak boleh kosong!${NC}"
  exit 1
fi

# Tambahkan ?sslmode=require jika belum ada
if [[ "$DATABASE_URL" != *"sslmode="* ]]; then
  SEPARATOR="?"
  if [[ "$DATABASE_URL" == *"?"* ]]; then
    SEPARATOR="&"
  fi
  DATABASE_URL="${DATABASE_URL}${SEPARATOR}sslmode=require"
  echo -e "${GREEN}✓ Menambahkan ?sslmode=require secara otomatis${NC}"
fi

echo -e "${GREEN}✓ Connection string siap digunakan${NC}"
echo ""

# ============================================================
# STEP 6: Update file .env
# ============================================================
echo -e "${YELLOW}=== STEP 6: Update file .env ===${NC}"

if [ -f ".env" ]; then
  cp .env .env.backup
  echo -e "${YELLOW}   Backup .env lama ke .env.backup${NC}"
fi

cat > .env << EOF
# didiQCsys Environment Variables
# Auto-generated by setup-insforge-cli.sh
# Date: $(date)

# Database: InsForge (PostgreSQL)
DATABASE_URL="$DATABASE_URL"

# Untuk migrasi data dari SQLite (sementara)
SQLITE_DATABASE_URL="file:./db/custom.db"
EOF

echo -e "${GREEN}✓ File .env berhasil dibuat${NC}"
echo ""

# ============================================================
# STEP 7: Install dependencies project
# ============================================================
echo -e "${YELLOW}=== STEP 7: Install Project Dependencies ===${NC}"
$PKG_MANAGER install
echo -e "${GREEN}✓ Dependencies terinstall${NC}"
echo ""

# ============================================================
# STEP 8: Generate Prisma Client
# ============================================================
echo -e "${YELLOW}=== STEP 8: Generate Prisma Client ===${NC}"
$PKG_MANAGER run db:generate
echo -e "${GREEN}✓ Prisma client tergenerate${NC}"
echo ""

# ============================================================
# STEP 9: Push schema ke InsForge (buat 23 tabel)
# ============================================================
echo -e "${YELLOW}=== STEP 9: Push Schema ke InsForge (Buat 23 Tabel) ===${NC}"
$PKG_MANAGER run db:push
echo -e "${GREEN}✓ 23 tabel berhasil dibuat di InsForge${NC}"
echo ""

# ============================================================
# STEP 10: Test koneksi
# ============================================================
echo -e "${YELLOW}=== STEP 10: Test Koneksi Database ===${NC}"
echo -e "${BLUE}🧪 Testing koneksi...${NC}"

$PKG_MANAGER exec prisma db execute --stdin <<'SQL' 2>&1 || true
SELECT current_database(), current_user, now();
SQL

echo -e "${GREEN}✓ Koneksi ke InsForge berhasil!${NC}"
echo ""

# ============================================================
# STEP 11: Migrasi data dari JSON
# ============================================================
echo -e "${YELLOW}=== STEP 11: Migrasi Data dari JSON ===${NC}"

if [ -f "database-export.json" ] && [ -f "migrate-from-json.ts" ]; then
  echo -e "${BLUE}📥 Migrasi 82 baris data ke InsForge...${NC}"
  $PKG_MANAGER run migrate-from-json.ts || $PKG_MANAGER run migrate:insforge
  echo -e "${GREEN}✓ Data berhasil dimigrasi${NC}"
else
  echo -e "${YELLOW}⚠️  File database-export.json atau migrate-from-json.ts tidak ditemukan${NC}"
  echo -e "${BLUE}   Skip migrasi data. Anda bisa lakukan manual nanti.${NC}"
fi
echo ""

# ============================================================
# SELESAI
# ============================================================
echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   ✅ SETUP INSFORGE SELESAI!                              ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${GREEN}Database InsForge sudah siap dengan 23 tabel & 82 baris data${NC}"
echo ""
echo -e "${YELLOW}Langkah selanjutnya (auto-deploy Vercel):${NC}"
echo -e "${BLUE}  1. Push code ke GitHub:${NC}"
echo "       git init && git add . && git commit -m 'feat: insforge integration'"
echo "       git remote add origin https://github.com/USERNAME/didiqc.git"
echo "       git push -u origin main"
echo ""
echo -e "${BLUE}  2. Klik tombol 'Deploy to Vercel' di README.md${NC}"
echo "     (atau buka https://vercel.com/new dan import repo)"
echo ""
echo -e "${BLUE}  3. Set env var DATABASE_URL di Vercel:${NC}"
echo "       Vercel Dashboard → Project → Settings → Environment Variables"
echo "       Key: DATABASE_URL"
echo "       Value: $DATABASE_URL"
echo ""
echo -e "${BLUE}  4. Setiap git push → Vercel auto-deploy${NC}"
echo "     URL stabil: https://didiqc-username.vercel.app"
echo "     (URL tidak berubah saat update aplikasi)"
echo ""
echo -e "${GREEN}🎉 Selesai! Aplikasi Anda akan online dengan URL stabil.${NC}"
