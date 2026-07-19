# didiQCsys — Sistem QC Laboratorium

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![Prisma](https://img.shields.io/badge/Prisma-6-blue)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-InsForge-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

Sistem Quality Control Laboratorium berbasis web, port dari Google Apps Script (didiQCsys v9.12) ke Next.js + Prisma + PostgreSQL.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ atau Bun
- Database PostgreSQL (rekomendasi: [InsForge](https://insforge.dev))

### Installation

```bash
# Clone repo
git clone https://github.com/USERNAME/didiqc.git
cd didiqc

# Install dependencies
bun install   # atau npm install

# Setup environment
cp .env.example .env
# Edit .env, isi DATABASE_URL dengan connection string InsForge Anda

# Generate Prisma client
bunx prisma generate

# Buat schema database
bunx prisma db push

# Jalankan aplikasi
bun run dev
```

Buka http://localhost:3000

## 🏗️ Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5
- **Database**: PostgreSQL (via InsForge)
- **ORM**: Prisma 6
- **UI**: Tailwind CSS 4 + shadcn/ui
- **Auth**: Custom session-based

## 📁 Project Structure

```
├── prisma/
│   └── schema.prisma         # 23 model (Users, Parameters, LotQC, InputQC, ...)
├── src/
│   ├── app/                  # Next.js App Router
│   ├── components/           # React components + shadcn/ui
│   └── lib/                  # Utilities, db client, session
├── public/                   # Static assets
└── .env                      # Environment variables (jangan commit!)
```

## 🗃️ Database Schema

23 tabel (mirror dari 22 sheet Google Sheets + Sessions):

| # | Tabel | Fungsi |
|---|-------|--------|
| 1 | users | User accounts (superadmin, user) |
| 2 | parameters | Parameter pemeriksaan lab |
| 3 | lotqc | Lot reagen QC |
| 4 | inputqc | Input data QC harian |
| 5 | historiqc | Riwayat perubahan/deleted QC |
| 6 | calculatedstats | Statistik terhitung (mean, SD, CV) |
| 7 | biaspme | Data Bias PME |
| 8 | daftartea | Daftar TEa (Total Error Allowable) |
| 9 | sigmacvopt | Optimasi Sigma & CV |
| 10 | laporancatatan | Catatan laporan QC |
| 11 | tabulasicatatan | Catatan tabulasi |
| 12 | kopsurat | Konfigurasi kop surat |
| 13 | settings | Pengaturan aplikasi |
| 14 | logactivity | Log aktivitas user |
| 15 | catatandokter | Catatan dokter |
| 16 | userpasswords | Password sharing |
| 17-22 | img* | Tabel image analysis (Hemato, Urin, Malaria, BTA, Lain, Patologi) |
| 23 | sessions | Session token untuk autentikasi |

## 🔧 Deployment

Lihat panduan lengkap: [deployment/PANDUAN-DEPLOY-INSFORGE-GITHUB-VERCEL.md](deployment/PANDUAN-DEPLOY-INSFORGE-GITHUB-VERCEL.md)

**Singkatnya:**
1. Database: Buat project di [InsForge](https://insforge.dev) → dapatkan connection string
2. Code: Push ke GitHub (private repo)
3. Hosting: Import ke Vercel → set env var `DATABASE_URL` → deploy

## 📝 License

Private — All rights reserved.

## 🆘 Support

Untuk pertanyaan teknis, hubungi developer.
