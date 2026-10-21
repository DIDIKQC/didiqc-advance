# 🚀 SETUP & INSTALASI didiQCsys v9.31

> Panduan lengkap setup aplikasi didiQCsys v9.31 dari bundle ini.
> Ikuti step-by-step untuk menjalankan aplikasi secara lokal atau deploy ke production.

---

## 📋 PREREQUISITES

### Wajib
- **Node.js 18+** atau **Bun** (recommended: install dari https://bun.sh)
- **PostgreSQL database** — pilih salah satu:
  - **[InsForge](https://insforge.dev)** (recommended, gratis untuk project kecil)
  - PostgreSQL lokal (via Docker, apt, brew, atau installer)
  - PostgreSQL cloud lain (Neon, Supabase, Railway, dll)

### Opsional (untuk production)
- **GitHub account** — untuk push code & setup auto-deploy
- **Vercel account** — untuk hosting production (gratis untuk project personal)

---

## 🛠️ STEP 1: EXTRACT BUNDLE

```bash
# Extract bundle zip
unzip didiqc-advance-LATEST.zip -d didiqc-advance

# Masuk ke folder project
cd didiqc-advance

# Verifikasi struktur
ls -la
```

Anda harus melihat struktur seperti:
```
didiqc-advance/
├── README.md
├── DOKUMENTASI-LENGKAP.md
├── SETUP-INSTALASI.md        ← file ini
├── ARSITEKTUR.md
├── CHANGELOG-VERSION.md
├── KREDENSIAL-LOGIN.md
├── CATATAN-AI.md
├── AGENTS.md
├── package.json
├── ...
├── prisma/
├── public/
├── src/
└── scripts/
```

---

## 📦 STEP 2: INSTALL DEPENDENCIES

### Opsi A: Bun (Recommended)
```bash
# Install Bun jika belum (https://bun.sh)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install
```

### Opsi B: npm
```bash
# Install dependencies
npm install
```

### Opsi C: yarn
```bash
# Install dependencies
yarn install
```

---

## 🔐 STEP 3: SETUP ENVIRONMENT VARIABLES

### 3.1 Buat file `.env` dari template
```bash
cp .env.example .env
```

### 3.2 Edit file `.env` dengan editor favorit Anda
```bash
nano .env
# atau
code .env
```

### 3.3 Isi `DATABASE_URL`

#### Opsi A: InsForge (Recommended — gratis & cepat)
1. Daftar di https://insforge.dev
2. Buat project baru (misal: "didiqc")
3. Buka tab "Database" → dapatkan connection string
4. Isi `.env`:
   ```
   DATABASE_URL=postgresql://postgres:PASSWORD_ANDA@HOST.ap-southeast.database.insforge.app:5432/insforge?sslmode=require&pgbouncer=true&connect_timeout=15
   ```

#### Opsi B: PostgreSQL lokal
```bash
# Install PostgreSQL (Ubuntu/Debian)
sudo apt install postgresql postgresql-contrib

# Buat database
sudo -u postgres psql
postgres=# CREATE DATABASE didiqc;
postgres=# CREATE USER didikqc WITH PASSWORD 'password_anda';
postgres=# GRANT ALL PRIVILEGES ON DATABASE didiqc TO didikqc;
postgres=# \q
```

Isi `.env`:
```
DATABASE_URL=postgresql://didikqc:password_anda@localhost:5432/didiqc?schema=public
```

#### Opsi C: Docker PostgreSQL
```bash
# Run PostgreSQL di Docker
docker run -d \
  --name didiqc-db \
  -e POSTGRES_USER=didikqc \
  -e POSTGRES_PASSWORD=password_anda \
  -e POSTGRES_DB=didiqc \
  -p 5432:5432 \
  postgres:16
```

Isi `.env`:
```
DATABASE_URL=postgresql://didikqc:password_anda@localhost:5432/didiqc?schema=public
```

---

## 🗄️ STEP 4: GENERATE PRISMA CLIENT & PUSH SCHEMA

```bash
# Generate Prisma Client (TypeScript types)
bunx prisma generate

# Push schema ke database (buat 23 tabel)
bunx prisma db push
```

### Verifikasi
Setelah `db push` sukses, ada 23 tabel di database Anda:
- `users`, `user_passwords`, `sessions`
- `parameters`, `lot_q_c`, `input_q_c`, `histori_q_c`
- `calculated_stats`, `bias_p_m_e`, `sigma_c_v_opt`, `daftar_t_ea`
- `kop_surat`, `settings`, `log_activity`
- `equipment`, `maintenance`, `kalibrasi`
- `patologi_anatomi`, `image_hematologi`, `image_urine`, `image_malaria`, `image_bta`
- `master_alat`, `master_metode`, `master_satuan`

---

## 🌱 STEP 5: SEED DATA DEFAULT (OPSIONAL)

Jika database kosong, aplikasi akan auto-seed user admin saat first login. Tapi jika ingin seed manual:

```bash
# Seed admin user manual
bun run scripts/seed-admin.ts

# Atau seed lengkap untuk testing E2E
bun run scripts/seed-local-e2e.ts
```

### Kredensial Default Setelah Seed
| Username | Password | Role |
|----------|----------|------|
| `admin` | `didikqc123` | superadmin |
| `testuser` | `pass123` | user |

---

## 🏃 STEP 6: JALANKAN DEV SERVER

### Opsi A: Bun (Recommended)
```bash
bun run dev
```

### Opsi B: Manual dengan cleaning env
```bash
./start-dev.sh
```

### Opsi C: Dengan auto-restart (jika sering crash)
```bash
./dev-keeper.sh
```

### Verifikasi
Server berjalan di `http://localhost:3000`. Buka di browser.

### Output yang diharapkan
```
   ▲ Next.js 16.1.3 (Turbopack)
   - Local:        http://localhost:3000
   - Network:      http://192.168.x.x:3000

 ✓ Ready in 1234ms
```

---

## 🌐 STEP 7: AKSES APLIKASI

### 7.1 Buka aplikasi di browser
- URL: `http://localhost:3000`
- Anda akan melihat halaman login dengan background image dan form login

### 7.2 Login dengan kredensial default
- Username: `admin`
- Password: `didikqc123`
- Klik tombol "Masuk"

### 7.3 Setelah login sukses
Anda akan melihat dashboard utama dengan:
- Sidebar kiri: 47+ menu (47 untuk superadmin)
- Top bar: logo, judul halaman, "Muat Data", "Lihat Sebagai" (superadmin), tombol keluar
- Main content: dashboard dengan kartu statistik & grafik

---

## ☁️ STEP 8: DEPLOY KE PRODUCTION (OPSIONAL)

### 8.1 Push ke GitHub
```bash
# Inisialisasi git jika belum
git init
git add .
git commit -m "Initial commit: didiQCsys v9.31"

# Buat repo di GitHub: https://github.com/new
# Lalu tambahkan remote
git remote add origin https://github.com/USERNAME/REPO_ANDA.git
git branch -M main
git push -u origin main
```

### 8.2 Setup Vercel
1. Buka https://vercel.com/new
2. Import repo GitHub Anda
3. Set environment variable:
   - Name: `DATABASE_URL`
   - Value: (connection string PostgreSQL Anda, sama dengan di `.env`)
4. Klik "Deploy"

### 8.3 Konfigurasi Vercel (sudah ada di `vercel.json`)
```json
{
  "framework": "nextjs",
  "buildCommand": "bunx prisma generate && (bunx prisma db push --skip-generate || echo 'WARN') && next build",
  "installCommand": "bun install",
  "regions": ["sin1"],
  "functions": {
    "src/app/api/rpc/route.ts": {
      "maxDuration": 60
    }
  }
}
```

### 8.4 Setup Auto-Deploy
1. Buka Vercel project → Settings → Git
2. Pastikan "Production Branch" = `main`
3. Setiap `git push origin main` → Vercel auto-build → deploy ke production

---

## 🔧 TROUBLESHOOTING

### Error: "Cannot find module @prisma/client"
**Solusi**: Jalankan `bunx prisma generate`

### Error: "Database connection failed"
**Solusi**:
- Cek `DATABASE_URL` di `.env` sudah benar
- Cek database bisa diakses dari lokal
- Untuk InsForge: pastikan format URL benar dengan `?sslmode=require`
- Tambah `&pgbouncer=true&connect_timeout=15` untuk pooling

### Error: "Prisma: the URL must start with the protocol file:"
**Penyebab**: schema.prisma masih pakai `sqlite` provider
**Solusi**:
```bash
# Cek prisma/schema.prisma line 22
# Pastikan: provider = "postgresql"
# Bukan: provider = "sqlite"
```

### Error: "Port 3000 already in use"
**Solusi**:
```bash
# Cari process yang pakai port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Atau pakai port lain
bun run dev -- -p 3001
```

### Error: "Server has closed the connection" (di Vercel production)
**Penyebab**: Connection pooling kurang optimal
**Solusi**:
- Tambah `&pgbouncer=true&connect_timeout=15` di DATABASE_URL
- Vercel functions perlu connection pooling untuk serverless

### Error: "Login gagal: invalid credentials"
**Penyebab**: Database belum di-seed
**Solusi**:
```bash
# Cek apakah user admin ada
bunx prisma studio
# Atau pakai: bun run scripts/seed-admin.ts
```

### Halaman blank / putih
**Penyebab**: JavaScript error di app.html
**Solusi**:
- Buka DevTools (F12) → Console
- Lihat error message
- Check `dev.log` untuk error backend

### Halaman login tidak muncul
**Penyebab**: Build belum selesai
**Solusi**:
- Tunggu sampai "Ready" di console
- Refresh halaman

---

## 📝 COMMAND REFERENCE

### Development
```bash
bun run dev              # Start dev server
bun run lint            # Run ESLint
bun run build           # Build production (jangan dipakai untuk dev)
bun run start           # Run production build
```

### Database
```bash
bunx prisma generate     # Generate Prisma Client
bunx prisma db push      # Push schema ke DB
bunx prisma migrate dev  # Create migration
bunx prisma migrate reset # Reset DB + run all migrations
bunx prisma studio       # Buka Prisma Studio (DB GUI)
```

### Scripts
```bash
bun run scripts/seed-admin.ts           # Seed admin user
bun run scripts/seed-local-e2e.ts        # Seed untuk testing
bun run scripts/migrate-to-insforge.ts  # Migrate ke InsForge
bun run scripts/migrate-from-json.ts    # Migrate dari JSON dump
```

---

## 🔄 UPDATE & MAINTENANCE

### Update dari bundle baru
1. Backup `.env` dan `prisma/dev.db` (jika ada)
2. Extract bundle baru
3. Restore `.env`
4. `bun install`
5. `bunx prisma generate`
6. `bunx prisma db push` (jika schema berubah)

### Backup database
```bash
# Export semua data ke JSON
bunx prisma studio

# Atau pakai pg_dump (untuk PostgreSQL)
pg_dump $DATABASE_URL > backup.sql
```

### Restore database
```bash
# Restore dari SQL dump
psql $DATABASE_URL < backup.sql

# Atau pakai script migrate-from-json
bun run scripts/migrate-from-json.ts
```

---

## 📊 VERIFIKASI INSTALASI BERHASIL

Setelah semua step selesai, verifikasi:

1. **Dev server jalan**: `http://localhost:3000` → halaman login muncul
2. **Login sukses**: `admin` / `didikqc123` → masuk dashboard
3. **Sidebar lengkap**: 47 menu untuk superadmin
4. **Database terhubung**: klik menu "Input QC" → data tampil (atau empty state)
5. **Dark mode toggle**: klik tombol bulan/matahari di topbar
6. **Bahasa toggle**: klik bendera ID/EN di hero
7. **Mobile responsive**: resize browser ke 375px → layout adaptif
8. **Filter searchable**: buka "Grafik & Analisis" → ketik di dropdown filter → opsi terfilter
9. **Save data**: tambah parameter baru → tersimpan → muncul di daftar
10. **Print PDF**: buka menu "Grafik & Analisis" → tombol Print → pilih opsi → PDF ter-generate

Jika semua poin di atas OK → instalasi BERHASIL. ✅

---

## 🎯 NEXT STEPS

Setelah instalasi berhasil:

1. **Ubah password admin default** — ke menu Users → Edit admin → password baru
2. **Buat user baru** — menu Users → Tambah User
3. **Setup bidang** — menu Parameter → tambah parameter per bidang
4. **Tambah lot QC** — menu Lot QC → Tambah Lot
5. **Input data QC** — menu Input QC → tambah data harian
6. **Lihat grafik LJ** — menu Grafik & Analisis → pilih parameter & lot → grafik tampil
7. **Generate laporan** — menu Laporan → pilih rentang tanggal → export Excel/PDF

---

## 📞 BANTUAN

Jika ada masalah:
- Baca `DOKUMENTASI-LENGKAP.md` untuk konteks lengkap
- Baca `ARSITEKTUR.md` untuk memahami design pattern
- Baca `CATATAN-AI.md` untuk aturan main & conventions
- Lihat `worklog.md` (jika disertakan) untuk history perubahan
- Production reference: https://didiqc-advance.vercel.app

---

*didiQCsys v9.31 — Setup & Instalasi*
