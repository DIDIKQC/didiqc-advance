# 📦 didiQCsys v9.12 — Complete Source Code Bundle

> **Bundle Created**: 21 Juli 2026
> **Version**: didiQCsys v9.12 (Next.js Port + InsForge Integration)
> **Status**: ✅ LIVE di https://didiqc-advance.vercel.app

---

## 📋 Isi Bundle

Bundle ini berisi **source code lengkap** aplikasi didiQCsys v9.12 yang sudah ter-deploy di Vercel production.

### File Utama
| File | Deskripsi |
|------|-----------|
| `DOKUMENTASI-PEKERJAAN.md` | Dokumentasi lengkap semua pekerjaan (844 baris) |
| `worklog.md` | Worklog detail 20+ task (922 baris) |
| `README-BUNDLE.md` | File ini |
| `package.json` | Dependencies & scripts |
| `vercel.json` | Config Vercel deployment |
| `next.config.ts` | Config Next.js 16 |
| `.env.example` | Template environment variables |
| `start-dev.sh` | Launcher dev server |

### Source Code
| Folder | Isi |
|--------|-----|
| `src/app/` | Next.js App Router (page.tsx, layout.tsx, api/rpc/route.ts) |
| `src/lib/` | Library (db.ts, session.ts, utils-server.ts, backend-handlers.ts) |
| `src/lib/backend/` | 14 modul backend TypeScript (9,293 baris) |
| `src/components/ui/` | shadcn/ui components |
| `prisma/` | Prisma schema PostgreSQL (23 model) |
| `public/` | HTML/CSS/JS asli GAS (app.html, 3,565 baris) |
| `scripts/` | Script migrasi database |

---

## 🚀 Cara Menjalankan Secara Lokal

### Prerequisites
- Node.js 18+ atau Bun
- PostgreSQL database (atau InsForge account)

### Steps

1. **Extract bundle**
   ```bash
   unzip didiqc-source-complete.zip -d didiqc-advance
   cd didiqc-advance
   ```

2. **Install dependencies**
   ```bash
   bun install
   # atau: npm install
   ```

3. **Setup environment**
   ```bash
   cp .env.example .env
   # Edit .env, isi DATABASE_URL dengan connection string PostgreSQL Anda
   ```

4. **Generate Prisma client & push schema**
   ```bash
   bunx prisma generate
   bunx prisma db push
   ```

5. **Run dev server**
   ```bash
   bun run dev
   # Aplikasi jalan di http://localhost:3000
   ```

---

## ☁️ Cara Deploy ke Vercel

### Opsi 1: Import dari GitHub (Recommended)
1. Push code ke GitHub repo Anda
2. Buka https://vercel.com/new
3. Import repo GitHub Anda
4. Set environment variable `DATABASE_URL`
5. Deploy

### Opsi 2: Vercel CLI
```bash
npm i -g vercel
vercel login
vercel --prod
```

### Konfigurasi yang Sudah Ada
- `vercel.json` sudah dikonfigurasi (region: sin1, build: prisma generate + next build)
- `.env.example` sebagai template
- Branch `main` sebagai production branch

---

## 🔐 Environment Variables

### Yang Dibutuhkan
```
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
```

### Untuk InsForge (yang dipakai production)
```
DATABASE_URL=postgresql://postgres:***@rz7b4fhh.ap-southeast.database.insforge.app:5432/insforge?sslmode=require
```

**Dapatkan connection string Anda di**: https://insforge.dev/dashboard

---

## 🗄️ Database

### Schema
- **23 model Prisma** (Users, Parameters, LotQC, InputQC, HistoriQC, dll)
- Lihat: `prisma/schema.prisma`

### Default Data
Jika database kosong, aplikasi akan auto-seed:
- User `admin` / `didikqc123` (superadmin) — auto-create pada first run
- Settings default (8 baris)
- Setelah admin login, bisa create user lain via menu Users

---

## 🔑 Login Credentials (Default)

| Username | Password | Role | Akses |
|----------|----------|------|-------|
| `admin` | `didikqc123` | superadmin | Penuh |
| `testuser` | `pass123` | user | Standar |
| *(smart password)* | `didikqc` | — | Untuk Smart Import & Hapus Data |

---

## 📊 Statistik Code

| Komponen | Baris |
|----------|-------|
| Backend TypeScript (14 modul) | 9,293 |
| Frontend HTML asli (app.html) | 3,565 |
| Prisma Schema | 561 |
| Backend handlers registry | 231 |
| Server utils | 204 |
| Session management | 105 |
| page.tsx (iframe wrapper) | 99 |
| **Total source code** | **~15,665 baris** |

---

## 🌐 Status Production

| Item | Value |
|------|-------|
| **Live URL** | https://didiqc-advance.vercel.app |
| **GitHub Repo** | https://github.com/DIDIKQC/didiqc-advance |
| **Database** | InsForge PostgreSQL |
| **Auto-Deploy** | Aktif (push main → Vercel auto-build) |
| **Region** | sin1 (Singapore) |
| **Framework** | Next.js 16.1.3 (Turbopack) |

---

## ⚠️ Catatan Penting

1. **`.env` TIDAK ada di bundle ini** (security). Gunakan `.env.example` sebagai template.
2. **`node_modules/` TIDAK ada** — jalankan `bun install` setelah extract.
3. **Database TIDAK ada di bundle** — setup sendiri di InsForge atau PostgreSQL lain.
4. **`public/app.html` adalah HTML asli Google Apps Script** — JANGAN modify sembarangan.
5. **Backend pattern**: `(args: any[], session: SessionData | null)` — ikuti pattern yang ada.

---

## 📞 Bantuan

- **Dokumentasi lengkap**: Baca `DOKUMENTASI-PEKERJAAN.md`
- **Worklog detail**: Baca `worklog.md`
- **Production app**: https://didiqc-advance.vercel.app
- **Source code online**: https://github.com/DIDIKQC/didiqc-advance

---

*Bundle ini dibuat pada 21 Juli 2026.*
*didiQCsys v9.12 — Sistem QC Laboratorium Klinis*
