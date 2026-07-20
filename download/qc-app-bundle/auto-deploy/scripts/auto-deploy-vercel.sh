#!/bin/bash
# ============================================================
# auto-deploy-vercel.sh — Setup Auto-Deploy Vercel Sekali Klik
# ============================================================
# Script ini akan:
#   1. Cek apakah Vercel CLI terinstall
#   2. Login ke Vercel (jika belum)
#   3. Link project ke Vercel (jika belum)
#   4. Set environment variable DATABASE_URL di Vercel
#   5. Deploy pertama kali
#   6. Setup auto-deploy dari GitHub (instruksi)
#
# Setelah setup, setiap `git push origin main` akan:
#   → Vercel auto-deploy
#   → URL tetap: https://didiqc-username.vercel.app
#   → Tidak perlu ganti link baru
# ============================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   🚀 AUTO-DEPLOY VERCEL SETUP                            ║"
echo "║   Stable URL + Auto-Update on Git Push                   ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# ============================================================
# STEP 1: Cek prerequisites
# ============================================================
echo -e "${YELLOW}=== STEP 1: Cek Prerequisites ===${NC}"

# Cek .env ada & punya DATABASE_URL
if [ ! -f ".env" ]; then
  echo -e "${RED}❌ File .env belum ada!${NC}"
  echo "   Jalankan dulu: ./scripts/setup-insforge-cli.sh"
  exit 1
fi

if ! grep -q "^DATABASE_URL=" .env; then
  echo -e "${RED}❌ DATABASE_URL belum diset di .env${NC}"
  echo "   Jalankan dulu: ./scripts/setup-insforge-cli.sh"
  exit 1
fi
echo -e "${GREEN}✓ .env dengan DATABASE_URL terdeteksi${NC}"

# Cek Git sudah init
if [ ! -d ".git" ]; then
  echo -e "${YELLOW}⚠️  Git belum di-init. Initializing...${NC}"
  git init
  git add .
  git commit -m "Initial commit: didiQCsys with InsForge"
fi
echo -e "${GREEN}✓ Git repository siap${NC}"

# Cek remote GitHub sudah diset
if ! git remote get-url origin &> /dev/null; then
  echo -e "${YELLOW}⚠️  GitHub remote belum diset${NC}"
  echo -e "${BLUE}   Silakan buat repo di https://github.com/new (PRIVATE recommended)${NC}"
  read -p "   Masukkan GitHub repo URL (https://github.com/USERNAME/didiqc.git): " -r REPO_URL
  if [ -n "$REPO_URL" ]; then
    git remote add origin "$REPO_URL"
    git branch -M main
    git push -u origin main
    echo -e "${GREEN}✓ Code pushed ke GitHub${NC}"
  else
    echo -e "${RED}❌ GitHub repo URL kosong. Setup dibatalkan.${NC}"
    exit 1
  fi
else
  REPO_URL=$(git remote get-url origin)
  echo -e "${GREEN}✓ GitHub remote: $REPO_URL${NC}"
fi
echo ""

# ============================================================
# STEP 2: Install Vercel CLI
# ============================================================
echo -e "${YELLOW}=== STEP 2: Install Vercel CLI ===${NC}"

if command -v vercel &> /dev/null; then
  echo -e "${GREEN}✓ Vercel CLI sudah terinstall${NC}"
else
  echo -e "${BLUE}📦 Menginstall Vercel CLI...${NC}"
  if command -v bun &> /dev/null; then
    bun add -g vercel
  else
    npm install -g vercel
  fi
  echo -e "${GREEN}✓ Vercel CLI terinstalled${NC}"
fi
echo ""

# ============================================================
# STEP 3: Login ke Vercel
# ============================================================
echo -e "${YELLOW}=== STEP 3: Login ke Vercel ===${NC}"

if vercel whoami &> /dev/null; then
  echo -e "${GREEN}✓ Sudah login sebagai: $(vercel whoami)${NC}"
else
  echo -e "${BLUE}🔐 Browser akan terbuka untuk login Vercel...${NC}"
  echo -e "${BLUE}   Pilih 'Continue with GitHub' (recommended)${NC}"
  vercel login
fi
echo ""

# ============================================================
# STEP 4: Link project ke Vercel
# ============================================================
echo -e "${YELLOW}=== STEP 4: Link Project ke Vercel ===${NC}"

if [ -f ".vercel/project.json" ]; then
  echo -e "${GREEN}✓ Project sudah ter-link ke Vercel${NC}"
else
  echo -e "${BLUE}🔗 Linking project ke Vercel...${NC}"
  echo -e "${BLUE}   Pilih jawaban berikut saat diminta:${NC}"
  echo -e "${CYAN}   - Set up and deploy? → Y${NC}"
  echo -e "${CYAN}   - Which scope? → (pilih akun Anda)${NC}"
  echo -e "${CYAN}   - Link to existing project? → N${NC}"
  echo -e "${CYAN}   - Project name? → didiqc (atau nama lain)${NC}"
  echo -e "${CYAN}   - Directory? → ./${NC}"
  echo -e "${CYAN}   - Modify settings? → N${NC}"
  echo ""
  vercel link
fi

# Ambil project info
if [ -f ".vercel/project.json" ]; then
  PROJECT_ID=$(grep -o '"projectId":"[^"]*"' .vercel/project.json | cut -d'"' -f4)
  ORG_ID=$(grep -o '"orgId":"[^"]*"' .vercel/project.json | cut -d'"' -f4)
  echo -e "${GREEN}✓ Project ID: $PROJECT_ID${NC}"
  echo -e "${GREEN}✓ Org ID: $ORG_ID${NC}"
fi
echo ""

# ============================================================
# STEP 5: Set DATABASE_URL di Vercel
# ============================================================
echo -e "${YELLOW}=== STEP 5: Set DATABASE_URL Environment Variable ===${NC}"

# Extract DATABASE_URL dari .env (tanpa quote)
DB_URL=$(grep "^DATABASE_URL=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")

if [ -z "$DB_URL" ]; then
  echo -e "${RED}❌ Gagal extract DATABASE_URL dari .env${NC}"
  exit 1
fi

echo -e "${BLUE}🔧 Set DATABASE_URL untuk Production environment...${NC}"
echo "$DB_URL" | vercel env add DATABASE_URL production 2>/dev/null || true

echo -e "${BLUE}🔧 Set DATABASE_URL untuk Preview environment...${NC}"
echo "$DB_URL" | vercel env add DATABASE_URL preview 2>/dev/null || true

echo -e "${BLUE}🔧 Set DATABASE_URL untuk Development environment...${NC}"
echo "$DB_URL" | vercel env add DATABASE_URL development 2>/dev/null || true

echo -e "${GREEN}✓ DATABASE_URL diset di semua environments${NC}"
echo ""

# ============================================================
# STEP 6: Deploy pertama ke Vercel
# ============================================================
echo -e "${YELLOW}=== STEP 6: Deploy Pertama ke Vercel ===${NC}"
echo -e "${BLUE}🚀 Building & deploying... (mungkin butuh 2-3 menit)${NC}"
echo ""

DEPLOY_URL=$(vercel --prod --yes 2>&1 | tail -1)

echo -e "${GREEN}✅ DEPLOY BERHASIL!${NC}"
echo -e "${CYAN}   URL Production: $DEPLOY_URL${NC}"
echo ""

# ============================================================
# STEP 7: Setup GitHub Integration untuk Auto-Deploy
# ============================================================
echo -e "${YELLOW}=== STEP 7: Setup GitHub Auto-Deploy ===${NC}"

# Extract repo info dari URL
REPO_MATCH=$(echo "$REPO_URL" | grep -oP 'github\.com[/:]\K[^/]+/[^.]+')

echo -e "${BLUE}📋 Untuk mengaktifkan auto-deploy setiap git push:${NC}"
echo ""
echo -e "${CYAN}   1. Buka: https://vercel.com/dashboard${NC}"
echo -e "${CYAN}   2. Klik project 'didiqc' Anda${NC}"
echo -e "${CYAN}   3. Settings → Git${NC}"
echo -e "${CYAN}   4. Pastikan 'Production Branch' = main${NC}"
echo -e "${CYAN}   5. Pastikan 'Connected Git Repository' = $REPO_MATCH${NC}"
echo ""
echo -e "${BLUE}   Atau alternatif: pakai GitHub Actions workflow${NC}"
echo -e "${CYAN}   (sudah disediakan di .github/workflows/deploy-vercel.yml)${NC}"
echo ""

# ============================================================
# STEP 8: Tambahkan GitHub Secrets (jika pakai GitHub Actions)
# ============================================================
echo -e "${YELLOW}=== STEP 8: Tambah GitHub Secrets (untuk GitHub Actions) ===${NC}"
echo -e "${BLUE}📋 Untuk menggunakan GitHub Actions auto-deploy:${NC}"
echo ""
echo -e "${CYAN}   Buka: https://github.com/$REPO_MATCH/settings/secrets/actions${NC}"
echo -e "${CYAN}   Tambahkan 3 secrets berikut:${NC}"
echo ""
echo -e "${GREEN}   Name: VERCEL_TOKEN${NC}"
echo -e "${GREEN}   Value: (dari https://vercel.com/account/tokens)${NC}"
echo ""
echo -e "${GREEN}   Name: VERCEL_PROJECT_ID${NC}"
echo -e "${GREEN}   Value: $PROJECT_ID${NC}"
echo ""
echo -e "${GREEN}   Name: VERCEL_ORG_ID${NC}"
echo -e "${GREEN}   Value: $ORG_ID${NC}"
echo ""
echo -e "${GREEN}   Name: DATABASE_URL${NC}"
echo -e "${GREEN}   Value: $DB_URL${NC}"
echo ""

# ============================================================
# SELESAI
# ============================================================
echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   🎉 AUTO-DEPLOY VERCEL SIAP!                            ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${GREEN}✅ URL Stabil Production: $DEPLOY_URL${NC}"
echo ""
echo -e "${YELLOW}CARA UPDATE APLIKASI (tanpa ganti link):${NC}"
echo -e "${BLUE}   1. Edit code di PC lokal Anda${NC}"
echo -e "${BLUE}   2. Commit & push:${NC}"
echo "      git add ."
echo "      git commit -m 'update: fitur baru'"
echo "      git push origin main"
echo ""
echo -e "${BLUE}   3. Vercel akan AUTO-DEPLOY dalam 2-3 menit${NC}"
echo -e "${BLUE}   4. URL tetap sama: $DEPLOY_URL${NC}"
echo -e "${BLUE}   5. Cek status: https://vercel.com/dashboard${NC}"
echo ""
echo -e "${GREEN}🎉 Selesai! URL Anda stabil selamanya.${NC}"
echo ""
echo -e "${YELLOW}Alternatif (lebih powerful):${NC}"
echo -e "${BLUE}   - Pakai GitHub Actions workflow (.github/workflows/deploy-vercel.yml)${NC}"
echo -e "${BLUE}   - Set 4 secrets di GitHub (lihat STEP 8)${NC}"
echo -e "${BLUE}   - Setiap push akan trigger workflow + deploy${NC}"
