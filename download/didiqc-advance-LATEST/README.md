# 📦 didiQCsys v9.31 — Source Code Bundle Lengkap (UPDATE TERBARU)

> **Bundle Dibuat**: Oktober 2026
> **Versi Aplikasi**: didiQCsys v9.31 (Round 2 — Next.js Port + InsForge Integration)
> **Kondisi Kode**: ✅ Sync dengan branch `main` GitHub `DIDIKQC/didiqc-advance`
> **Commit Terakhir**: `2d80e5d` — fix(login): pindahkan ikon lihat-password ke sisi KANAN kolom password
> **Status Production**: ✅ LIVE di https://didiqc-advance.vercel.app (auto-deploy dari main)

---

## 🎯 Tentang Bundle Ini

Bundle ini berisi **source code lengkap aplikasi didiQCsys v9.31** yang paling baru dan terupdate. Semua file di folder ini adalah **snapshot persis** dari kondisi terbaru repository di akhir sesi pengerjaan chat. Jika AI lain membaca folder ini dan menjalankan instruksi di `SETUP-INSTALASI.md`, hasil aplikasinya akan **sama persis** dengan aplikasi yang sedang berjalan di production Vercel.

### 📁 Yang TIDAK Ada di Bundle Ini (Harus Disiapkan Sendiri)

| Item | Alasan | Cara Mendapatkannya |
|------|--------|---------------------|
| `node_modules/` | Terlalu besar & tergantung OS | Jalankan `bun install` setelah extract |
| `.env` (file asli) | Berisi secret database | Buat dari `.env.example`, isi DATABASE_URL Anda |
| Database PostgreSQL | Berisi data produksi | Setup InsForge (gratis) atau PostgreSQL sendiri |
| `.git/` | History versi | Tidak perlu kecuali ingin melihat commit history |
| `dev.log`, screenshot `.png` | Artefak pengembangan | Tidak diperlukan untuk menjalankan aplikasi |

---

## 🚀 Quick Start (Cara Pakai)

### Prerequisites
- **Node.js 18+** atau **Bun** (recommended: install dari https://bun.sh)
- **PostgreSQL** database (recommended: [InsForge](https://insforge.dev) — gratis untuk project kecil)

### Langkah-Langkah

```bash
# 1. Extract bundle
unzip didiqc-advance-LATEST.zip -d didiqc-advance
cd didiqc-advance

# 2. Install dependencies
bun install

# 3. Setup environment variables
cp .env.example .env
# Edit .env, isi DATABASE_URL dengan connection string PostgreSQL Anda
# Contoh untuk InsForge:
# DATABASE_URL=postgresql://postgres:PASSWORD@HOST.ap-southeast.database.insforge.app:5432/insforge?sslmode=require

# 4. Generate Prisma client & push schema ke database
bunx prisma generate
bunx prisma db push

# 5. Jalankan dev server
bun run dev
# Buka http://localhost:3000 di browser

# 6. Login dengan kredensial default (auto-seed jika database kosong)
#    Username: admin
#    Password: didikqc123
```

---

## 📂 Struktur Bundle

```
didiqc-advance-LATEST/
├── README.md                          ← File ini (entry point)
├── DOKUMENTASI-LENGKAP.md             ← Dokumentasi lengkap semua pekerjaan
├── SETUP-INSTALASI.md                 ← Panduan setup detail (step-by-step)
├── ARSITEKTUR.md                      ← Penjelasan arsitektur & design pattern
├── CHANGELOG-VERSION.md               ← History versi v9.12 → v9.31
├── KREDENSIAL-LOGIN.md                ← Kredensial login & env vars
├── CATATAN-AI.md                      ← Catatan khusus untuk AI agent yang membaca folder ini
├── AGENTS.md                          ← Catatan integrasi InsForge
│
├── package.json                       ← Dependencies Next.js 16 + Prisma + shadcn/ui
├── bun.lock                           ← Lock file Bun
├── tsconfig.json                      ← Config TypeScript
├── next.config.ts                     ← Config Next.js 16 (standalone output)
├── tailwind.config.ts                 ← Config Tailwind CSS 4
├── postcss.config.mjs                 ← Config PostCSS
├── eslint.config.mjs                  ← Config ESLint
├── components.json                    ← Config shadcn/ui (New York style)
├── vercel.json                        ← Config deployment Vercel
├── Caddyfile                          ← Config gateway (untuk sandbox dev)
├── .env.example                       ← Template environment variables
├── .gitignore                         ← File ignore list
├── start-dev.sh                       ← Launcher dev server (clean env)
├── dev-keeper.sh                      ← Auto-restart dev server jika crash
│
├── prisma/
│   └── schema.prisma                  ← 23 model Prisma PostgreSQL (907 baris)
│
├── public/
│   ├── app.html                       ← Frontend HTML/CSS/JS asli (7,973 baris, 784KB)
│   ├── favicon.ico, favicon-16/32.png ← Favicon set
│   ├── apple-touch-icon.png           ← iOS home screen icon
│   ├── icon-192.png, icon-512.png     ← PWA icons
│   ├── logo.svg                       ← Logo aplikasi
│   ├── robots.txt                     ← SEO robots
│   └── passport.html                  ← Passport alternative page
│
├── src/
│   ├── app/                           ← Next.js App Router
│   │   ├── page.tsx                   ← Wrapper iframe (99 baris)
│   │   ├── layout.tsx                 ← Root layout (44 baris)
│   │   ├── globals.css                ← Global styles + Tailwind
│   │   └── api/
│   │       ├── route.ts                ← API root
│   │       ├── db-test/route.ts       ← Database connection test
│   │       └── rpc/route.ts            ← RPC dispatcher (183 baris)
│   │
│   ├── components/ui/                 ← 48 shadcn/ui components (New York)
│   │   ├── accordion.tsx, alert.tsx, alert-dialog.tsx, avatar.tsx, ...
│   │   └── (48 files total)
│   │
│   ├── hooks/                         ← Custom React hooks
│   │   ├── use-mobile.ts
│   │   └── use-toast.ts
│   │
│   └── lib/
│       ├── db.ts                      ← Prisma client singleton (106 baris)
│       ├── session.ts                 ← SessionData + HMAC cookies (107 baris)
│       ├── utils.ts                   ← Frontend utils (cn helper)
│       ├── utils-server.ts            ← Server utils
│       ├── backend-handlers.ts        ← RPC function registry (312 baris)
│       └── backend/                   ← 17 modul backend TypeScript
│           ├── auth.ts                ← Login, session, password tambahan (16KB)
│           ├── users.ts               ← User management (24KB)
│           ├── master-data.ts         ← Parameter, lot, TEa, settings (28KB)
│           ├── inputqc.ts             ← Input QC data (40KB)
│           ├── calculations.ts        ← QC calculations (52KB)
│           ├── westgard.ts            ← Westgard rules engine (32KB)
│           ├── graph.ts               ← Graph & chart data (28KB)
│           ├── dashboard.ts           ← Dashboard aggregation (20KB)
│           ├── reports.ts             ← Report generators (80KB)
│           ├── images.ts              ← Image analysis (32KB)
│           ├── backup.ts              ← Backup/restore (20KB)
│           ├── smart-import.ts         ← Smart import (12KB)
│           ├── import-db.ts            ← DB import (16KB)
│           ├── misc.ts                ← Misc functions (16KB)
│           ├── qc-helpers.ts           ← QC helpers (4KB)
│           ├── multi-master.ts         ← Multi-master (20KB)
│           └── equipment.ts            ← Equipment 360 (52KB)
│
└── scripts/                           ← 12 utility scripts
    ├── seed-admin.ts                  ← Seed admin user
    ├── seed-local-e2e.ts              ← Seed untuk testing E2E
    ├── migrate-to-insforge.ts         ← Migrasi ke InsForge PostgreSQL
    ├── migrate-from-json.ts           ← Migrasi dari JSON dump
    ├── test-sigma-level.ts            ← Test sigma level calculation
    ├── fix-delete-kalium-dup.ts       ← Fix duplicate Kalium data
    ├── debug-*.ts                     ← Debug scripts
    └── cleanup-db-connections.mjs     ← Cleanup DB connections
```

---

## 📊 Statistik Bundle

| Komponen | Jumlah | Ukuran |
|----------|--------|--------|
| Backend TypeScript (17 modul) | ~10,000 baris | ~480KB |
| Frontend HTML (app.html) | 7,973 baris | 784KB |
| Prisma Schema | 907 baris | 28KB |
| shadcn/ui components | 48 files | ~120KB |
| Next.js App Router | 5 files | ~5KB |
| Library (db, session, utils) | 5 files | ~16KB |
| Scripts | 12 files | ~100KB |
| **Total source code** | **~120 files** | **~2.8MB** |

---

## 🌐 Status Production

| Item | Value |
|------|-------|
| **Live URL** | https://didiqc-advance.vercel.app |
| **GitHub Repo** | https://github.com/DIDIKQC/didiqc-advance |
| **Branch Production** | `main` (auto-deploy ke Vercel) |
| **Database** | InsForge PostgreSQL (Singapore region) |
| **Region Vercel** | sin1 (Singapore) |
| **Framework** | Next.js 16.1.3 (Turbopack) |
| **Auto-Deploy** | Aktif: `git push origin main` → Vercel auto-build |

---

## 📋 Dokumentasi Tambahan

Baca file-file berikut untuk informasi lebih detail:

1. **`DOKUMENTASI-LENGKAP.md`** — Dokumentasi semua pekerjaan yang pernah dilakukan (analysis, fitur, bug fix)
2. **`SETUP-INSTALASI.md`** — Panduan setup step-by-step (lokal & Vercel)
3. **`ARSITEKTUR.md`** — Penjelasan arsitektur & design pattern aplikasi
4. **`CHANGELOG-VERSION.md`** — History versi dari v9.12 sampai v9.31
5. **`KREDENSIAL-LOGIN.md`** — Kredensial login default & env vars
6. **`CATATAN-AI.md`** — Catatan khusus untuk AI agent yang akan membaca & memodifikasi folder ini

---

## ⚠️ Catatan Penting

1. **`.env` TIDAK ada di bundle** (security). Gunakan `.env.example` sebagai template.
2. **`node_modules/` TIDAK ada** — jalankan `bun install` setelah extract.
3. **Database TIDAK ada di bundle** — setup sendiri di InsForge atau PostgreSQL lain.
4. **`public/app.html` adalah HTML asli Google Apps Script** — file terbesar dan terpenting, JANGAN modify sembarangan. Baca `CATATAN-AI.md` dulu sebelum mengubah.
5. **Backend pattern**: setiap fungsi backend menulis signature `(args: any[], session: SessionData | null)` — ikuti pattern yang sudah ada.
6. **Bundle ini adalah snapshot statis** — untuk update terbaru, clone dari https://github.com/DIDIKQC/didiqc-advance.

---

## 🎓 untuk AI Agent yang Membaca Folder Ini

Jika Anda adalah AI agent (Claude, GPT, Cursor, dll) yang ditugaskan untuk mengembangkan atau memodifikasi aplikasi ini, **WAJIB baca `CATATAN-AI.md`** sebelum melakukan perubahan apapun. File tersebut berisi:
- Aturan main dari user (programmer handal, tidak boleh ada error)
- Pola yang sudah teruji (jangan reinvent)
- Bagian sensitif yang harus hati-hati
- Workflow commit + push + Vercel auto-deploy
- Conventions penamaan, struktur kode, dan dokumentasi

---

## 📞 Bantuan

- **Dokumentasi lengkap**: Baca `DOKUMENTASI-LENGKAP.md`
- **Setup detail**: Baca `SETUP-INSTALASI.md`
- **Production app**: https://didiqc-advance.vercel.app
- **Source code online**: https://github.com/DIDIKQC/didiqc-advance

---

*didiQCsys v9.31 — Sistem QC Laboratorium Klinis*
*Bundle ini dibuat sebagai snapshot lengkap untuk memudahkan download & deployment ulang.*
