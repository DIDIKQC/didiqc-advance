# 🔑 KREDENSIAL LOGIN & ENVIRONMENT VARIABLES
# didiQCsys v9.31

> Panduan kredensial login default dan setup environment variables.

---

## 🎯 KREDENSIAL LOGIN DEFAULT

### Akun yang Auto-Seed (Database Kosong)

| Username | Password | Role | Akses | Catatan |
|----------|----------|------|-------|---------|
| `admin` | `didikqc123` | superadmin | Penuh | Auto-create saat first run jika DB kosong |

### Akun Testing (Manual Seed)

Jalankan `bun run scripts/seed-local-e2e.ts` untuk membuat akun testing:

| Username | Password | Role | Akses | Catatan |
|----------|----------|------|-------|---------|
| `testuser` | `pass123` | user | Standar | Untuk testing fitur user biasa |
| `analis` | `analis123` | user | Standar | Untuk testing multi-tenant |

### Akun Password Tambahan (Tenant)

Akun password tambahan dibuat dari menu Users → Kelola Password Tambahan. Format login:
- **Username**: username akun induk (misal: `admin`)
- **Password**: password tambahan yang dibuat

Contoh:
| Username | Password Tambahan | Akses |
|----------|-------------------|-------|
| `admin` | `pwdalat123` | Hanya Manajemen Alat Lab (jika diceklis) |
| `admin` | `pwdimg123` | Hanya Image Analisis (jika diceklis) |
| `admin` | `pwdfull123` | Semua menu (jika tidak diceklis) |

### Smart Password (untuk Smart Import & Hapus Data)

| Password | Fungsi |
|----------|--------|
| `didikqc` | Smart Import (fitur khusus) & Hapus Data |

---

## 🔐 HAK AKSES PER ROLE

### superadmin (admin langsung)
- ✅ Semua 47 menu
- ✅ Lihat Sebagai (View As) — switch ke akun user lain
- ✅ Menu Users (CRUD user, approve, password tambahan)
- ✅ Menu Pengaturan (settings global)
- ✅ Multi Master (master global)
- ✅ Card User Terdaftar & Online di Dashboard
- ✅ Export DB / Import DB

### user (akun biasa)
- ✅ Semua menu QC utama (Dashboard, Input QC, Histori, Grafik, Laporan, dll)
- ✅ Data privat per akun (tenant isolation)
- ❌ Lihat Sebagai
- ❌ Menu Users
- ❌ Menu Pengaturan
- ❌ Multi Master
- ❌ Card User Terdaftar & Online di Dashboard
- ❌ Export DB / Import DB

### secondary (password tambahan)
- ✅ Semua menu sesuai role induk
  - Jika induk superadmin → akses seluruh database superadmin
  - Jika induk user → akses database user induk
- ✅ Data terkunci ke akun induk (tenant)
- ❌ Menu Users (HANYA superadmin langsung)
- ❌ Menu Pengaturan (HANYA superadmin langsung)
- ❌ Lihat Sebagai (HANYA superadmin langsung)
- ⚙️ Ceklis hak akses (opsional, default: penuh):
  - "Hanya menu Manajemen Alat Lab" → restrict ke grpEquipment
  - "Hanya menu Image Analisis" → restrict ke grpImageAnalysis
  - Diceklis keduanya → restrict ke keduanya
  - Tidak diceklis → akses penuh (perilaku lama untuk legacy)

---

## 🌐 ENVIRONMENT VARIABLES

### `.env.example` (Template)
```
# didiQCsys Environment Variables (TEMPLATE)
# Copy file ini ke .env dan isi dengan nilai asli
# JANGAN commit file .env ke GitHub!

# Database: InsForge PostgreSQL
# Dapatkan connection string dari dashboard InsForge project Anda
DATABASE_URL=postgresql://postgres:PASSWORD@HOST.ap-southeast.database.insforge.app:5432/insforge?sslmode=require

# (Opsional) Backup SQLite untuk migrasi
SQLITE_DATABASE_URL=file:./db/custom.db
```

### `.env` (Production-like)

```
DATABASE_URL=postgresql://postgres:PASSWORD_ANDA@HOST.ap-southeast.database.insforge.app:5432/insforge?sslmode=require&pgbouncer=true&connect_timeout=15
```

### Parameter Penting di DATABASE_URL

| Parameter | Wajib | Contoh | Catatan |
|-----------|-------|--------|---------|
| `postgresql://` | ✅ | `postgresql://` | Protocol (bukan `file:`) |
| `user:password@` | ✅ | `postgres:mypwd@` | DB credentials |
| `host:port` | ✅ | `rz7b4fhh.ap-southeast.database.insforge.app:5432` | DB host |
| `/database` | ✅ | `/insforge` | DB name |
| `?sslmode=require` | ✅ | `?sslmode=require` | Wajib untuk InsForge & cloud DB |
| `&pgbouncer=true` | ⚙️ | `&pgbouncer=true` | Connection pooling (recommended untuk Vercel) |
| `&connect_timeout=15` | ⚙️ | `&connect_timeout=15` | Connection timeout 15s |

---

## 🗄️ INSFORGE SETUP (Recommended)

### Step-by-Step Setup InsForge

1. **Daftar** di https://insforge.dev
2. **Buat project baru**:
   - Name: `didiqc` (atau bebas)
   - Region: `ap-southeast` (Singapore)
   - Plan: Free (cukup untuk development)
3. **Dapatkan connection string**:
   - Buka tab "Database"
   - Copy "Connection String" (format: `postgresql://postgres:...@...:5432/insforge?sslmode=require`)
4. **Isi `.env`**:
   ```
   DATABASE_URL=postgresql://postgres:PASSWORD@HOST.ap-southeast.database.insforge.app:5432/insforge?sslmode=require&pgbouncer=true&connect_timeout=15
   ```
5. **Push schema**:
   ```bash
   bunx prisma generate
   bunx prisma db push
   ```
6. **Verifikasi**:
   ```bash
   bunx prisma studio
   # Buka http://localhost:5555 → lihat 23 tabel
   ```

### InsForge Free Plan Limits
- Storage: 500MB
- Compute: shared
- Connection pooling: ya
- SSL: wajib

---

## 🔄 MIGRASI DARI SQLITE

Jika sudah punya data di SQLite dan ingin pindah ke PostgreSQL (InsForge):

```bash
# 1. Export SQLite ke JSON
bun run scripts/migrate-from-json.ts

# 2. Atau langsung migrate SQLite → InsForge
bun run scripts/migrate-to-insforge.ts

# 3. Verifikasi data
bunx prisma studio
```

---

## 🛡️ SECURITY CHECKLIST

### Yang TIDAK BOLEH Di-commit ke Git
- ✅ `.env` (sudah di `.gitignore`)
- ✅ `node_modules/` (sudah di `.gitignore`)
- ✅ `.next/` (sudah di `.gitignore`)
- ✅ `dev.log`, `*.log` (sudah di `.gitignore`)
- ✅ `prisma/dev.db` (untuk dev SQLite)
- ✅ `.vercel/` (Vercel CLI cache)

### Yang BOLEH Di-commit
- ✅ `.env.example` (template, tanpa nilai asli)
- ✅ Semua source code (`src/`, `public/`, `prisma/schema.prisma`)
- ✅ `package.json`, `bun.lock`
- ✅ Config files (`next.config.ts`, `tsconfig.json`, dll)
- ✅ Documentation (`*.md`)

### Verifikasi .gitignore
```bash
# Pastikan .env tidak akan di-commit
git status .env
# Output harus: nothing to commit, working tree clean (atau "ignored")

# Atau cek manual
git check-ignore .env
# Output: .env
```

---

## 🔄 GANTI PASSWORD ADMIN DEFAULT

**SANGAT DIREKOMENDASIKAN** setelah instalasi:

1. Login sebagai `admin` / `didikqc123`
2. Buka menu **Users** (superadmin only)
3. Cari user `admin` di tabel
4. Klik tombol **Edit**
5. Isi password baru di field "Password"
6. Klik **Simpan**
7. Logout, login dengan password baru

---

## 📞 BANTUAN

Jika lupa password admin:
1. Stop dev server
2. Hapus user admin dari DB:
   ```bash
   bunx prisma studio
   # Buka tabel "users" → hapus row dengan username "admin"
   ```
3. Start dev server lagi
4. Aplikasi akan auto-seed user admin baru dengan password default `didikqc123`

---

## 🌐 PRODUCTION ENVIRONMENT VARIABLES

Untuk deployment ke Vercel production:

1. Buka https://vercel.com/USERNAME/didiqc-advance/settings/environment-variables
2. Tambah variable:
   - **Key**: `DATABASE_URL`
   - **Value**: `postgresql://postgres:PASSWORD@HOST.ap-southeast.database.insforge.app:5432/insforge?sslmode=require&pgbouncer=true&connect_timeout=15`
   - **Environment**: Production, Preview, Development (semua)
3. Save
4. Redeploy project (push commit ke main, atau klik "Redeploy" di Vercel)

---

## 📋 CHECKLIST INSTALASI

Sebelum aplikasi siap production, pastikan:

- [ ] `.env` diisi dengan `DATABASE_URL` valid
- [ ] `bunx prisma generate` sukses
- [ ] `bunx prisma db push` sukses (23 tabel terbuat)
- [ ] `bun run dev` jalan tanpa error
- [ ] Halaman login muncul di `http://localhost:3000`
- [ ] Login `admin` / `didikqc123` sukses
- [ ] Dashboard menampilkan data (atau empty state, bukan error)
- [ ] Sidebar menampilkan 47 menu (untuk superadmin)
- [ ] Tambah parameter baru → tersimpan → muncul di daftar
- [ ] Dark mode toggle berfungsi
- [ ] Bahasa ID/EN toggle berfungsi
- [ ] Mobile responsive (resize ke 375px)
- [ ] **Password admin default sudah diganti** ⚠️

Jika semua checklist OK → instalasi BERHASIL. ✅

---

*didiQCsys v9.31 — Kredensial & Env Vars*
