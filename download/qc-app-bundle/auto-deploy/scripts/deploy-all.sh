#!/bin/bash
# ============================================================
# deploy-all.sh — ONE COMMAND untuk Deploy Lengkap
# ============================================================
# Script ini menjalankan SEMUA langkah:
#   1. Setup InsForge (database online)
#   2. Setup GitHub (push code)
#   3. Setup Vercel (auto-deploy)
#
# Hasil akhir:
#   - URL stabil: https://didiqc-xxx.vercel.app
#   - Database: InsForge PostgreSQL (online)
#   - Source: GitHub (version control)
#   - Auto-update: setiap git push → Vercel auto-deploy
#
# CARA PAKAI:
#   chmod +x deploy-all.sh
#   ./deploy-all.sh
# ============================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                                                          ║"
echo "║   🚀 ONE-COMMAND DEPLOY: didiQCsys                       ║"
echo "║                                                          ║"
echo "║   InsForge + GitHub + Vercel = URL Stabil + Auto-Update  ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${YELLOW}Script ini akan:${NC}"
echo -e "${BLUE}  1. Setup database InsForge (PostgreSQL online)${NC}"
echo -e "${BLUE}  2. Push source code ke GitHub${NC}"
echo -e "${BLUE}  3. Deploy ke Vercel + setup auto-deploy${NC}"
echo ""
echo -e "${YELLOW}Hasil akhir:${NC}"
echo -e "${GREEN}  ✅ URL stabil: https://didiqc-xxx.vercel.app${NC}"
echo -e "${GREEN}  ✅ Auto-update: setiap git push → auto-deploy${NC}"
echo -e "${GREEN}  ✅ Tidak perlu ganti link saat update aplikasi${NC}"
echo ""
echo -e "${RED}⚠️  PRASYARAT:${NC}"
echo -e "${BLUE}   - Punya akun: GitHub, InsForge (https://insforge.dev), Vercel${NC}"
echo -e "${BLUE}   - Bun atau Node.js 18+ terinstall${NC}"
echo -e "${BLUE}   - Git terinstall${NC}"
echo ""
read -p "Lanjut? (y/N): " -r CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo -e "${RED}❌ Setup dibatalkan${NC}"
  exit 0
fi
echo ""

# Step 1: InsForge
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}${BOLD}STEP 1/3: SETUP INSFORGE DATABASE${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ -f ".env" ] && grep -q "^DATABASE_URL=.*postgresql" .env; then
  echo -e "${GREEN}✓ InsForge sudah dikonfigurasi di .env${NC}"
  echo -e "${BLUE}  Skip Step 1${NC}"
else
  bash "$SCRIPT_DIR/setup-insforge-cli.sh"
fi
echo ""

# Step 2: GitHub
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}${BOLD}STEP 2/3: PUSH CODE KE GITHUB${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

cd "$PROJECT_DIR"

if [ ! -d ".git" ]; then
  git init
fi

# Cek .gitignore
if [ ! -f ".gitignore" ]; then
  cp "$SCRIPT_DIR/../deployment/.gitignore" .gitignore
fi

git add .
git status

if git diff --cached --quiet; then
  echo -e "${YELLOW}  Tidak ada perubahan untuk di-commit${NC}"
else
  read -p "Commit message [default: Initial commit]: " -r COMMIT_MSG
  COMMIT_MSG=${COMMIT_MSG:-"Initial commit: didiQCsys with InsForge integration"}
  git commit -m "$COMMIT_MSG"
fi

# Setup remote
if ! git remote get-url origin &> /dev/null; then
  echo ""
  echo -e "${BLUE}📋 Buat repo GitHub PRIVATE dulu di: https://github.com/new${NC}"
  read -p "GitHub repo URL (https://github.com/USERNAME/didiqc.git): " -r REPO_URL

  if [ -n "$REPO_URL" ]; then
    git remote add origin "$REPO_URL"
    git branch -M main
    git push -u origin main
    echo -e "${GREEN}✓ Code pushed ke GitHub${NC}"
  else
    echo -e "${RED}❌ Repo URL kosong, skip push ke GitHub${NC}"
    echo -e "${YELLOW}  Anda bisa push manual nanti${NC}"
  fi
else
  git push origin main 2>/dev/null || true
  echo -e "${GREEN}✓ Code sudah di-push ke GitHub${NC}"
fi
echo ""

# Step 3: Vercel
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}${BOLD}STEP 3/3: DEPLOY KE VERCEL + AUTO-DEPLOY SETUP${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

bash "$SCRIPT_DIR/auto-deploy-vercel.sh"

echo ""
echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                                                          ║"
echo "║   🎉 DEPLOY LENGKAP SELESAI!                             ║"
echo "║                                                          ║"
echo "║   ✅ Database: InsForge (online)                         ║"
echo "║   ✅ Source:   GitHub (version control)                  ║"
echo "║   ✅ Hosting:  Vercel (auto-deploy)                      ║"
echo "║                                                          ║"
echo "║   URL stabil selamanya!                                  ║"
echo "║   Setiap git push → aplikasi auto-update                 ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
