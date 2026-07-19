# 🚀 Panduan Deployment: InsForge + GitHub + Vercel/Netlify

Panduan **step-by-step** lengkap untuk deploy aplikasi **didiQCsys** dengan:
- **Database**: InsForge (PostgreSQL gratis)
- **Source Code**: GitHub (version control)
- **Hosting**: Vercel (rekomendasi) atau Netlify

---

## 📋 Arsitektur Final

```
┌─────────────────────────────────────────────────────────────┐
│                    APLIKASI ONLINE ANDA                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   Browser User ──→ https://didiqc.vercel.app                │
│                        │                                     │
│                        ▼                                     │
│                 ┌─────────────┐                              │
│                 │   Vercel    │ ← Hosting aplikasi Next.js   │
│                 │  (Frontend  │                              │
│                 │  + Backend) │                              │
│                 └──────┬──────┘                              │
│                        │                                     │
│                        │ DATABASE_URL (env var)              │
│                        ▼                                     │
│                 ┌─────────────┐                              │
│                 │  InsForge   │ ← Database PostgreSQL online │
│                 │  (Postgres) │                              │
│                 └─────────────┘                              │
│                        ▲                                     │
│                        │                                     │
│   GitHub Repo ────────┘ (auto-deploy trigger)               │
│   github.com/you/didiQCsys                                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Flow kerja:**
1. Anda **push code** ke GitHub
2. Vercel/Netlify **auto-deploy** aplikasi (gratis, ~2 menit)
3. Aplikasi di Vercel **terhubung** ke database InsForge via `DATABASE_URL`
4. User akses aplikasi via URL Vercel (`https://nama-app.vercel.app`)

---

## 🗂️ Persiapan: Download Bundle ke PC

Pastikan Anda sudah download paket lengkap dari sandbox:
```
didiQCsys-complete-bundle.zip
├── source-code.zip              ← aplikasi Next.js
├── custom.db                    ← database SQLite (untuk backup)
├── database-dump.sql            ← dump SQL (untuk migrasi data)
├── database-export.json         ← JSON export (alternatif migrasi)
├── insforge-setup/
│   ├── schema.postgresql.prisma ← schema Prisma untuk PostgreSQL
│   └── migrate-to-insforge.ts   ← script migrasi data
├── migrate-to-mysql.ts
├── migrate-to-postgres.ts
├── MIGRASI-KE-ONLINE.md
└── .env.example
```

---

## 📌 LANGKAH 1: Setup Akun (5 menit)

Buat 3 akun gratis berikut:

### 1.1 GitHub (jika belum punya)
- Daftar di: https://github.com/signup
- Verifikasi email
- **Catat**: username GitHub Anda

### 1.2 InsForge (Database)
- Buka: https://insforge.dev
- Klik **"Sign Up"** / **"Try for Free"**
- Login via GitHub / Google / Email
- Setelah login, Anda akan masuk ke **Dashboard InsForge**

### 1.3 Vercel (Hosting — REKOMENDASI)
- Buka: https://vercel.com/signup
- **Sign up with GitHub** (paling mudah, agar auto-deploy)
- Authorize Vercel untuk akses repo GitHub Anda

### ATAU 1.3 Alternatif: Netlify
- Buka: https://app.netlify.com/signup
- **Sign up with GitHub**
- Authorize Netlify

---

## 📌 LANGKAH 2: Buat Database di InsForge (10 menit)

### 2.1 Buat Project Baru di InsForge
1. Login ke https://insforge.dev
2. Klik **"New Project"** / **"Create Project"**
3. Isi form:
   - **Project Name**: `didiqc` (atau nama lain bebas)
   - **Region**: pilih yang terdekat (Singapore / US East)
   - **Plan**: Free tier (cukup untuk QC system skala kecil)
4. Klik **"Create"**

### 2.2 Ambil Connection String PostgreSQL
1. Di dashboard project InsForge Anda, cari menu:
   - **"Database"** atau **"Connect"** atau **"Settings → Database"**
2. Cari bagian **"Connection String"** atau **"External Connection"**
3. Copy connection string, formatnya kira-kira:
   ```
   postgresql://postgres.xxxx:password@db.xxxx.insforge.dev:5432/postgres
   ```
   atau
   ```
   postgresql://user:password@aws-0-region.pooler.insforge.dev:6543/postgres
   ```

4. **PENTING**: Tambahkan `?sslmode=require` di akhir URL jika belum ada:
   ```
   postgresql://postgres.xxxx:password@db.xxxx.insforge.dev:5432/postgres?sslmode=require
   ```

5. **Simpan connection string ini** di tempat aman (password manager / notes)
   Ini akan dipakai sebagai `DATABASE_URL`

### 2.3 Catat Info Penting
Simpan informasi berikut:
- ✅ Project name: `didiqc`
- ✅ Region: `Singapore` (atau yang Anda pilih)
- ✅ Connection string: `postgresql://...?sslmode=require`

---

## 📌 LANGKAH 3: Setup Project Lokal di PC (15 menit)

### 3.1 Install Prerequisites di PC
Pastikan terinstall:
- **Node.js 18+**: https://nodejs.org (pilih LTS)
- **Bun** (opsional, lebih cepat): https://bun.sh
- **Git**: https://git-scm.com

Cek dengan:
```bash
node --version    # harus >= 18
git --version
```

### 3.2 Extract Source Code
```bash
# Extract bundle
unzip didiQCsys-complete-bundle.zip
unzip source-code.zip -d didiQCsys
cd didiQCsys
```

### 3.3 Ganti Schema Prisma ke PostgreSQL
```bash
# Backup schema lama (SQLite)
mv prisma/schema.prisma prisma/schema.sqlite.prisma.bak

# Pakai schema PostgreSQL
cp ../insforge-setup/schema.postgresql.prisma prisma/schema.prisma

# Copy script migrasi
cp ../insforge-setup/migrate-to-insforge.ts migrate-to-insforge.ts
```

### 3.4 Setup Environment Variables
```bash
# Buat file .env
cp ../.env.example .env

# Edit .env dengan editor favorit Anda (VS Code, Notepad, dll)
# Ganti DATABASE_URL dengan connection string InsForge Anda:
```

Edit `.env` menjadi:
```env
# InsForge PostgreSQL connection
DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@db.xxxx.insforge.dev:5432/postgres?sslmode=require"

# Untuk migrasi data dari SQLite (sementara)
SQLITE_DATABASE_URL="file:./db/custom.db"
```

> ⚠️ **PENTING**: Jika password mengandung karakter khusus (`@`, `:`, `/`, `?`, `#`, `&`), encode dengan URL encoding:
> - `@` → `%40`
> - `:` → `%3A`
> - `/` → `%2F`
> - `?` → `%3F`
> - `#` → `%23`
> - `&` → `%26`

### 3.5 Copy Database SQLite Lokal (untuk sumber migrasi)
```bash
mkdir -p db
cp ../custom.db db/custom.db
```

### 3.6 Install Dependencies
```bash
bun install
# atau jika pakai npm:
# npm install
```

### 3.7 Generate Prisma Client
```bash
bunx prisma generate
```

### 3.8 Buat Schema di InsForge (PUSH TABLES)
```bash
bunx prisma db push
```

Output yang diharapkan:
```
🚀  Your database is now in sync with your Prisma schema. Done in 2.3s

✅ 23 tables created successfully
```

> Jika muncul error, cek:
> - Connection string benar (port 5432 atau 6543)
> - `?sslmode=require` sudah ditambahkan
> - Password sudah di-URL encode

### 3.9 Verifikasi Tabel Sudah Dibuat
```bash
bunx prisma studio
```
Akan membuka browser di `http://localhost:5555` — cek semua 23 tabel sudah ada (kosong).

---

## 📌 LANGKAH 4: Migrasi Data SQLite → InsForge (5 menit)

### 4.1 Update db.ts untuk Baca dari SQLite (Sementara)

Karena script migrasi perlu baca SQLite + tulis ke InsForge secara bersamaan, kita perlu setup koneksi ganda.

Edit `src/lib/db.ts` menjadi sementara:
```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```
(Sudah seperti ini — tidak perlu diubah)

### 4.2 Buat Script Migrasi Khusus

Buat file `migrate-data.ts` di root project:
```bash
# Copy dari insforge-setup
cp ../insforge-setup/migrate-to-insforge.ts migrate-data.ts
```

### 4.3 Sesuaikan Script untuk Baca SQLite

Karena `db` sekarang menunjuk ke InsForge (PostgreSQL), kita butuh Prisma client kedua untuk baca SQLite. Edit `migrate-data.ts`:

```typescript
// Tambahkan di bagian atas file migrate-data.ts
import { PrismaClient as PrismaSqlite } from "@prisma/client";

// Buat client khusus untuk SQLite (baca data lama)
const sqliteDb = new PrismaSqlite({
  datasources: { db: { url: process.env.SQLITE_DATABASE_URL } },
});

// Ganti semua "db[table]" untuk baca SQLite → "sqliteDb[table]"
// Ganti semua "db[table]" untuk tulis PostgreSQL → "db[table]"
```

**Atau cara lebih mudah — pakai JSON export yang sudah disediakan:**

### 4.4 ALTERNATIF: Migrasi via JSON (PALING MUDAH)

Karena kita sudah punya `database-export.json`, gunakan script ini:

Buat file `migrate-from-json.ts` di root project:
```typescript
import { db } from "./src/lib/db";
import data from "./database-export.json";

async function migrate() {
  console.log("🚀 Migrasi dari JSON ke InsForge...\n");

  for (const [table, rows] of Object.entries(data)) {
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`⏭️  ${table.padEnd(20)} 0 rows (skip)`);
      continue;
    }
    try {
      // @ts-expect-error dynamic
      const result = await db[table].createMany({
        data: rows as any,
        skipDuplicates: true,
      });
      console.log(`✅ ${table.padEnd(20)} ${result.count}/${rows.length} rows`);
    } catch (e: any) {
      console.error(`❌ ${table.padEnd(20)} ERROR: ${e.message}`);
    }
  }

  await db.$disconnect();
  process.exit(0);
}

migrate();
```

Copy `database-export.json` ke root project, lalu jalankan:
```bash
cp ../database-export.json .
bun run migrate-from-json.ts
```

### 4.5 Verifikasi Data Sudah Masuk
```bash
bunx prisma studio
```
Buka `http://localhost:5555`, klik tabel-tabel berikut untuk verifikasi:
- ✅ `users` → harus ada 2 baris
- ✅ `parameters` → 1 baris
- ✅ `lotqc` → 1 baris
- ✅ `inputqc` → 3 baris
- ✅ `historiqc` → 3 baris
- ✅ `daftartea` → 2 baris
- ✅ `laporancatatan` → 1 baris
- ✅ `settings` → 8 baris
- ✅ `logactivity` → 61 baris

Total: **82 baris data**

---

## 📌 LANGKAH 5: Push ke GitHub (5 menit)

### 5.1 Init Git Repository Lokal
```bash
cd didiQCsys

git init
git add .
git commit -m "Initial commit: didiQCsys with PostgreSQL (InsForge) support"
```

### 5.2 Buat Repo di GitHub
1. Buka https://github.com/new
2. Isi:
   - **Repository name**: `didiqc` (atau `didiQCsys`)
   - **Description**: `Sistem QC Laboratorium dengan Next.js + Prisma + InsForge`
   - **Visibility**: **Private** (REKOMENDASI — jangan public, ada credential)
   - ❌ Jangan centang "Add a README" / .gitignore / license (sudah ada di project)
3. Klik **"Create repository"**

### 5.3 Push Code ke GitHub
GitHub akan menampilkan instruksi. Jalankan:
```bash
git remote add origin https://github.com/USERNAME-ANDA/didiqc.git
git branch -M main
git push -u origin main
```

> Jika diminta login, gunakan Personal Access Token (PAT):
> - Buka https://github.com/settings/tokens
> - Generate new token (classic) dengan scope `repo`
> - Saat git push, masukkan username + token sebagai password

### 5.4 Verifikasi .gitignore Sudah Benar
Pastikan file `.gitignore` berisi (sudah ada dari source code):
```
node_modules
.next
.env
db/*.db
db/*.db-journal
*.log
```

> ⚠️ **PENTING**: Pastikan file `.env` **TIDAK** ter-push ke GitHub (berisi password database). Cek dengan:
> ```bash
> git log --all -- .env
> # Jika ada, hapus dari history dengan:
> # git rm --cached .env && git commit -m "remove .env from tracking"
> ```

---

## 📌 LANGKAH 6: Deploy ke Vercel (10 menit) — REKOMENDASI

### 6.1 Import Project ke Vercel
1. Buka https://vercel.com/dashboard
2. Klik **"Add New..."** → **"Project"**
3. Cari repo `didiqc` Anda → klik **"Import"**

### 6.2 Configure Build Settings
Vercel akan auto-detect sebagai Next.js project. Set konfigurasi berikut:

- **Framework Preset**: Next.js (auto-detected)
- **Root Directory**: `./` (default)
- **Build Command**: `bun run build` atau `npx next build` (auto-detected)
- **Output Directory**: `.next` (auto-detected)
- **Install Command**: `bun install` atau `npm install` (auto-detected)

### 6.3 Set Environment Variables (PENTING!)
Scroll ke bawah ke bagian **"Environment Variables"**. Tambahkan:

| Key | Value | Environment |
|-----|-------|-------------|
| `DATABASE_URL` | `postgresql://postgres.xxxx:PASSWORD@db.xxxx.insforge.dev:5432/postgres?sslmode=require` | Production, Preview, Development |

> ⚠️ Pastikan **tidak ada spasi** di awal/akhir value
> ⚠️ Pastikan `?sslmode=require` ada di akhir

### 6.4 Deploy
1. Klik **"Deploy"**
2. Tunggu ~2-3 menit (Vercel build + deploy)
3. Setelah selesai, klik **"Visit"** untuk lihat aplikasi
4. URL Anda: `https://didiqc-username.vercel.app`

### 6.5 Verifikasi Deploy Berhasil
1. Buka URL Vercel Anda di browser
2. Cek login berfungsi
3. Cek data tersimpan di InsForge (via Prisma Studio lokal atau InsForge dashboard)

### 6.6 Setup Auto-Deploy (Sudah Otomatis)
Setiap kali Anda `git push` ke GitHub:
- Vercel akan **auto-deploy** versi baru
- Build log bisa dilihat di dashboard Vercel
- URL tetap sama (`didiqc-username.vercel.app`)

---

## 📌 LANGKAH 6 ALTERNATIF: Deploy ke Netlify (10 menit)

> Pilih ini jika Anda lebih suka Netlify atau Vercel ada masalah

### 6.1 Import Project ke Netlify
1. Buka https://app.netlify.com
2. Klik **"Add new site"** → **"Import an existing project"**
3. Pilih **GitHub** → authorize
4. Cari repo `didiqc` → klik

### 6.2 Configure Build
- **Base directory**: `.` (default)
- **Build command**: `npm run build` (atau `bun run build`)
- **Publish directory**: `.next` (auto-detected untuk Next.js)

### 6.3 Set Environment Variables
1. Klik **"Advanced settings"** → **"Environment variables"**
2. Tambahkan:
   - Key: `DATABASE_URL`
   - Value: `postgresql://...?sslmode=require`

### 6.4 Install Next.js Plugin (Otomatis)
Netlify akan otomatis install `@netlify/plugin-nextjs`. Tidak perlu konfigurasi tambahan.

### 6.5 Deploy Site
1. Klik **"Deploy site"**
2. Tunggu ~3-5 menit
3. URL: `https://didiqc-username.netlify.app`

### 6.6 Update next.config.ts untuk Netlify
Edit `next.config.ts` di repo Anda, tambahkan:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tambahkan untuk Netlify compatibility
  output: 'standalone',
};

export default nextConfig;
```
Commit & push, Netlify akan auto-deploy.

---

## 📌 LANGKAH 7: Setup Custom Domain (Opsional, 10 menit)

### Via Vercel
1. Buka dashboard Vercel → pilih project `didiqc`
2. Settings → **Domains**
3. Masukkan domain Anda (mis. `qc.klinik-anda.com`)
4. Ikuti instruksi DNS (tambah A record / CNAME ke domain registrar)
5. Vercel auto-provision SSL (gratis, Let's Encrypt)

### Via Netlify
1. Dashboard Netlify → pilih site → **Domain settings**
2. **Add a domain**
3. Setup DNS sesuai instruksi
4. SSL otomatis

---

## 📌 LANGKAH 8: Setup Backup & Monitoring (Opsional)

### 8.1 Backup Database InsForge
- InsForge biasanya auto-backup harian di plan berbayar
- Untuk free tier, lakukan manual export berkala:
  ```bash
  # Export ke SQL
  bunx prisma db execute --schema prisma/schema.prisma --stdin < backup.sql
  # Atau via InsForge dashboard → Export
  ```

### 8.2 Monitoring di Vercel
- Vercel Analytics (gratis): Settings → Analytics
- Error tracking: setup Sentry (opsional)
- Log real-time: dashboard Vercel → Logs

---

## 🔧 TROUBLESHOOTING

### ❌ Error: `Can't reach database server`
**Penyebab**: Connection string salah atau firewall block
**Solusi**:
1. Cek format: `postgresql://user:pass@host:port/db?sslmode=require`
2. Cek port (biasanya 5432 untuk direct, 6543 untuk pooler)
3. Pastikan `?sslmode=require` ada
4. Test koneksi: `bunx prisma db pull` (harusnya sukses)

### ❌ Error: `password authentication failed`
**Penyebab**: Password salah atau mengandung karakter khusus
**Solusi**:
- URL-encode karakter khusus di password (lihat tabel encoding di Langkah 3.4)
- Cek ulang password dari dashboard InsForge

### ❌ Error: `relation "users" does not exist`
**Penyebab**: Tabel belum dibuat di InsForge
**Solusi**: Jalankan `bunx prisma db push` lagi

### ❌ Build error di Vercel: `Prisma Client not generated`
**Solusi**: 
1. Tambahkan `postinstall` script di `package.json`:
   ```json
   "scripts": {
     "postinstall": "prisma generate",
     ...
   }
   ```
2. Commit & push

### ❌ Aplikasi jalan di lokal tapi 500 error di Vercel
**Kemungkinan**:
- `DATABASE_URL` env var belum diset di Vercel
- Connection string tidak persis sama (spasi, newline)
- Prisma client belum di-generate saat build

**Cek**: Vercel dashboard → project → **Functions** → lihat log error

### ❌ Data tidak muncul di production
**Kemungkinan**: Anda migrasi data ke database dev, tapi production pakai database berbeda
**Solusi**: Pastikan `DATABASE_URL` di Vercel = `DATABASE_URL` di `.env` lokal saat migrasi

### ❌ Prisma migrate error: `drift detected`
**Solusi**: 
```bash
bunx prisma migrate reset --force  # HATI-HATI: hapus semua data!
bunx prisma db push
```

### ❌ Netlify: `Function timeout`
Next.js API routes di Netlify ada limit 10 detik (free tier).
**Solusi**: Pindah ke Vercel (limit 60 detik di hobby, 300 detik di pro)

---

## 📋 CHECKLIST FINAL

Tandai ✅ setelah selesai:

### Setup
- [ ] Daftar akun GitHub, InsForge, Vercel
- [ ] Buat project InsForge & dapatkan connection string
- [ ] Download bundle dari sandbox ke PC
- [ ] Extract source code & setup .env
- [ ] Ganti schema.prisma ke versi PostgreSQL
- [ ] Install dependencies (`bun install`)
- [ ] Generate Prisma client (`bunx prisma generate`)
- [ ] Push schema ke InsForge (`bunx prisma db push`)
- [ ] Verifikasi 23 tabel terbentuk

### Migrasi Data
- [ ] Copy `database-export.json` ke root project
- [ ] Buat `migrate-from-json.ts`
- [ ] Jalankan migrasi
- [ ] Verifikasi 82 baris data masuk via Prisma Studio

### GitHub
- [ ] Init git repo lokal
- [ ] Buat repo private di GitHub
- [ ] Push code ke GitHub
- [ ] Pastikan `.env` TIDAK ter-commit

### Deploy
- [ ] Import project ke Vercel/Netlify
- [ ] Set `DATABASE_URL` environment variable
- [ ] Deploy berhasil
- [ ] Aplikasi bisa diakses publik
- [ ] Test login & fitur utama

### Post-Deploy
- [ ] Setup custom domain (opsional)
- [ ] Backup database berkala
- [ ] Monitoring logs

---

## 🎉 Selesai!

Setelah semua checklist ✅, aplikasi **didiQCsys** Anda sudah online:

- 🌐 **URL**: `https://didiqc-username.vercel.app` (atau `.netlify.app`)
- 🗄️ **Database**: InsForge (PostgreSQL online)
- 📦 **Source**: GitHub (version control + auto-deploy)
- 🔄 **Update**: Cukup `git push`, Vercel auto-deploy

**Total biaya**: $0 (semua pakai free tier)

---

## 🆘 Butuh Bantuan?

Jika ada masalah, beri tahu saya dengan info berikut:
1. **Langkah mana yang gagal** (Langkah X.Y)
2. **Pesan error lengkap** (copy-paste)
3. **Platform**: Vercel atau Netlify
4. **OS PC Anda**: Windows / Mac / Linux

Saya bisa bantu debug step-by-step!
