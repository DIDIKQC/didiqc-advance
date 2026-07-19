# 📦 Panduan Download & Migrasi Database ke Online

Paket lengkap untuk memindahkan aplikasi **didiQCsys** dari sandbox ke PC lokal Anda, lalu ke database online (MySQL/PostgreSQL).

---

## 📁 Isi Paket Download

| File | Ukuran | Keterangan |
|------|--------|------------|
| `source-code.zip` | ~336 KB | Source code aplikasi lengkap (Next.js 16 + Prisma) |
| `custom.db` | ~208 KB | File database SQLite mentah (siap dipakai langsung) |
| `database-dump.sql` | ~18 KB | Dump SQL berisi INSERT statements (82 baris data) |
| `database-export.json` | ~17 KB | Export seluruh data dalam format JSON |
| `database-bundle.zip` | ~17 KB | Bundle: custom.db + dump.sql + schema.prisma |
| `MIGRASI-KE-ONLINE.md` | — | Panduan ini |
| `migrate-to-mysql.ts` | — | Script migrasi SQLite → MySQL |
| `migrate-to-postgres.ts` | — | Script migrasi SQLite → PostgreSQL |

### 📊 Statistik Database Saat Ini
- **23 tabel** (mirror dari 22 sheet Google Sheets + Sessions)
- **82 baris data total** (users, parameters, lotqc, inputqc, historiqc, daftartea, laporancatatan, settings, logactivity)
- Tabel dengan data: `users (2)`, `parameters (1)`, `lotqc (1)`, `inputqc (3)`, `historiqc (3)`, `daftartea (2)`, `laporancatatan (1)`, `settings (8)`, `logactivity (61)`

---

## 🚀 Langkah 1: Download Paket ke PC Lokal

Semua file berada di folder:
```
/home/z/my-project/download/qc-app-bundle/
```

**Cara download:**
1. Buka **file browser** di sandbox (panel sebelah kiri)
2. Navigasi ke `download/qc-app-bundle/`
3. Klik kanan pada setiap file → **Download** (atau drag-and-drop ke PC Anda)
4. Atau download sekaligus dengan ZIP semua file tersebut

---

## 🚀 Langkah 2: Setup di PC Lokal

### Prasyarat
- **Node.js 18+** atau **Bun** (rekomendasi: Bun untuk konsistensi)
- **Git** (opsional, untuk version control)

### Instalasi
```bash
# 1. Extract source code
unzip source-code.zip -d didiQCsys
cd didiQCsys

# 2. Install dependencies (pilih salah satu)
bun install                    # rekomendasi
# atau
npm install

# 3. Setup database SQLite lokal (untuk testing dulu)
mkdir -p db
cp ../custom.db db/custom.db   # pakai database yang sudah ada data

# 4. Edit .env (sudah ada template .env.example)
cp .env.example .env
# Edit .env, pastikan: DATABASE_URL="file:./db/custom.db"

# 5. Generate Prisma client
bunx prisma generate

# 6. Jalankan aplikasi
bun run dev
# Buka http://localhost:3000
```

---

## 🚀 Langkah 3: Migrasi ke Database Online

Ada **3 opsi** database online yang didukung Prisma:

### OPSI A: MySQL (REKOMENDASI untuk hosting shared seperti Hostinger/cPanel)

#### A1. Buat database MySQL di hosting Anda
- Login ke cPanel / panel hosting
- Buka **MySQL Databases**
- Buat database baru, contoh: `didiqc_db`
- Buat user MySQL dan berikan akses ke database tersebut
- Catat: host, username, password, nama database

#### A2. Edit `.env` di PC lokal Anda
```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/DATABASE_NAME"
```
**Contoh:**
```env
DATABASE_URL="mysql://didiqc_user:MyP@ssw0rd@localhost:3306/didiqc_db"
```
> ⚠️ Jika password mengandung karakter khusus (`@`, `:`, `/`, `?`, `#`), encode dengan URL encoding. Contoh: `@` → `%40`

#### A3. Buat schema di MySQL
```bash
bunx prisma db push
```
Ini akan membuat semua 23 tabel di MySQL Anda.

#### A4. Import data dari dump SQL
```bash
# Via command line (jika punya akses SSH)
mysql -u USER -p DATABASE_NAME < database-dump.sql

# Atau via phpMyAdmin (cPanel):
# 1. Buka phpMyAdmin
# 2. Pilih database Anda
# 3. Tab "Import"
# 4. Upload file database-dump.sql
# 5. Klik "Go"
```

#### A5. Verifikasi
```bash
bunx prisma studio
# Akan membuka browser di localhost:5555
# Cek apakah data sudah masuk di semua tabel
```

---

### OPSI B: PostgreSQL (REKOMENDASI untuk Vercel/Neon/Supabase/Railway)

#### B1. Buat database PostgreSQL
- **Gratis & mudah**: [neon.tech](https://neon.tech), [supabase.com](https://supabase.com), [railway.app](https://railway.app)
- Dapatkan connection string, contoh:
  ```
  postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
  ```

#### B2. Edit `.env`
```env
DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"
```

#### B3. Buat schema & import data
```bash
bunx prisma db push                    # buat tabel
bunx prisma db seed                    # (opsional, jika ada seed script)
# Import database-dump.sql via tool database (DBeaver, TablePlus, atau psql)
psql "DATABASE_URL" -f database-dump.sql
```

---

### OPSI C: Tetap SQLite (untuk VPS sederhana)

Jika Anda punya VPS sendiri, SQLite cukup untuk skala kecil-menengah:

```bash
# Di VPS Anda
git clone <repo-anda>
cd didiQCsys
bun install
mkdir -p db
# Upload custom.db ke folder db/
bunx prisma generate
bun run build
bun run start
```

> ⚠️ SQLite kurang ideal untuk aplikasi dengan banyak concurrent writes. Untuk produksi multi-user, gunakan MySQL/PostgreSQL.

---

## 🌐 Langkah 4: Deploy Aplikasi Online

### Deployment Options (urut dari paling mudah):

| Platform | Database | Difficulty | Cost |
|----------|----------|------------|------|
| **Vercel** + Neon/Supabase | PostgreSQL | ⭐ Mudah | Free tier |
| **Railway** | PostgreSQL/MySQL | ⭐ Mudah | $5/bulan credits |
| **Render** | PostgreSQL | ⭐⭐ Menengah | Free tier terbatas |
| **VPS (DigitalOcean/Hetzner)** | MySQL/PostgreSQL | ⭐⭐⭐ Sulit | $4-6/bulan |
| **Shared Hosting cPanel** | MySQL | ⭐⭐ Menengah | $2-5/bulan |

### Deploy ke Vercel (PALING REKOMENDASI)

1. Push source code ke GitHub
2. Login ke [vercel.com](https://vercel.com)
3. **New Project** → import repo GitHub Anda
4. Set environment variables di Vercel dashboard:
   ```
   DATABASE_URL = postgresql://...  (dari Neon/Supabase)
   ```
5. Build command: `bun run build` (atau `npm run build`)
6. Vercel auto-deploy → aplikasi online dalam ~2 menit

### Untuk Shared Hosting (cPanel + MySQL)

Shared hosting biasanya TIDAK support Next.js dengan baik (karena Node.js tidak didukung). Alternatif:
- Gunakan VPS murah (Hetzner CX11 ~$4/bulan)
- Atau deploy ke Railway/Render

---

## 🔧 Troubleshooting

### Error: `Prisma Client not generated`
```bash
bunx prisma generate
```

### Error: `Database connection refused`
- Cek format `DATABASE_URL` (terutama encoding karakter khusus di password)
- Cek apakah host/port benar
- Untuk PostgreSQL di Neon/Supabase: pastikan `?sslmode=require` ada di akhir URL

### Error: `Table already exists` saat import SQL
- Edit `database-dump.sql`, hapus baris `DROP TABLE IF EXISTS` jika tidak ingin overwrite
- Atau jalankan: `bunx prisma migrate reset` (HATI-HATI: hapus semua data)

### Data tidak muncul setelah import
- Pastikan import SQL dilakukan SETELAH `prisma db push` (agar tabel sudah ada)
- Cek via `bunx prisma studio` atau query langsung di database

### Password MySQL mengandung `@`
Encode sebagai `%40`. Contoh: password `P@ss` → `P%40ss`

---

## 📞 Bantuan

Jika ada masalah saat migrasi, beri tahu saya:
1. Platform tujuan (Vercel/Railway/VPS/cPanel)
2. Database pilihan (MySQL/PostgreSQL)
3. Pesan error lengkap

Saya bisa bantu buatkan script migrasi khusus atau troubleshooting sesuai kasus Anda.

---

## 📋 Checklist Migrasi

- [ ] Download semua file dari `download/qc-app-bundle/`
- [ ] Extract `source-code.zip` di PC lokal
- [ ] Jalankan `bun install`
- [ ] Test aplikasi berjalan dengan SQLite lokal (`bun run dev`)
- [ ] Pilih platform hosting & database online
- [ ] Buat database online & dapatkan connection string
- [ ] Update `.env` dengan `DATABASE_URL` online
- [ ] Jalankan `bunx prisma db push` untuk buat schema
- [ ] Import `database-dump.sql` ke database online
- [ ] Verifikasi data via `bunx prisma studio`
- [ ] Deploy aplikasi
- [ ] Test aplikasi online
