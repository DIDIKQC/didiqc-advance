# 🚀 didiQCsys v9.12

> Sistem Quality Control Laboratorium berbasis web dengan auto-deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FUSERNAME%2Fdidiqc&env=DATABASE_URL&envDescription=PostgreSQL%20connection%20string%20from%20InsForge%20(format%3A%20postgresql%3A%2F%2F...%3Fsslmode%3Drequire)&project-name=didiqc&repository-name=didiqc&demo-title=didiQCsys&demo-description=Sistem%20QC%20Laboratorium)

---

## ✨ Fitur Utama

- ✅ **23 tabel database** (Users, Parameters, LotQC, InputQC, HistoriQC, dll)
- ✅ **Multi-level QC** (Level 1, 2, 3 dengan kalkulasi Mean, SD, CV)
- ✅ **Westgard Multi-Rule Engine** (1-2s, 1-3s, 2-2s, R-4s, 4-1s, 6x, 7x, 8x, 10x)
- ✅ **OPSpecs Analysis** (PED, PFR, ΔSEc, ΔREc)
- ✅ **Image Analysis** (Hemato, Urin, Malaria, BTA, Patologi)
- ✅ **Auto-deploy** — URL stabil, update otomatis saat git push
- ✅ **Database online** — PostgreSQL via InsForge
- ✅ **Responsive design** — mobile + desktop

---

## 🎯 Quick Deploy (3 cara)

### Cara 1: One-Command Deploy ⭐ RECOMMENDED

```bash
# Extract bundle
unzip didiQCsys-complete-bundle.zip
unzip source-code.zip -d didiQCsys
cd didiQCsys

# Copy auto-deploy scripts
cp -r ../auto-deploy .

# Jalankan ONE command untuk setup semua
bash auto-deploy/scripts/deploy-all.sh
```

Script akan otomatis:
1. Setup database InsForge
2. Push code ke GitHub
3. Deploy ke Vercel + auto-deploy

**Hasil**: URL stabil `https://didiqc-username.vercel.app`

### Cara 2: Deploy Button (manual)

1. Push code ke GitHub repo Anda
2. Klik tombol **"Deploy with Vercel"** di atas
3. Set env var `DATABASE_URL` (dari InsForge)
4. Deploy!

### Cara 3: Step-by-step manual

Lihat: [`auto-deploy/DEPLOY-VERCEL-BUTTON.md`](auto-deploy/DEPLOY-VERCEL-BUTTON.md)

---

## 🏗️ Tech Stack

| Komponen | Teknologi |
|----------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Database | PostgreSQL (via InsForge) |
| ORM | Prisma 6 |
| UI | Tailwind CSS 4 + shadcn/ui |
| Auth | Custom session-based |
| Hosting | Vercel (auto-deploy) |
| Version Control | GitHub |

---

## 🔄 Cara Update Aplikasi

Setelah deploy pertama, update aplikasi sangat mudah:

```bash
# 1. Edit code di PC lokal Anda
# (misal: tambah fitur, fix bug, dll)

# 2. Commit perubahan
git add .
git commit -m "feat: tambah fitur X"

# 3. Push ke GitHub
git push origin main
```

**Yang terjadi otomatis:**
- ⏱️ 5 detik: Vercel detect push
- 🔨 2-3 menit: Build aplikasi
- 🚀 Deploy ke URL yang SAMA: `https://didiqc-username.vercel.app`
- ✅ User langsung lihat versi baru

**URL TIDAK PERNAH BERUBAH** selama update aplikasi!

---

## 📁 Struktur Project

```
didiQCsys/
├── prisma/
│   └── schema.prisma              # 23 model Prisma
├── src/
│   ├── app/                       # Next.js App Router (pages & API)
│   ├── components/                # React + shadcn/ui components
│   ├── lib/                       # db client, session, utils
│   └── hooks/                     # React hooks
├── public/                        # Static assets
├── auto-deploy/                   # ← Scripts auto-deploy
│   ├── scripts/
│   │   ├── setup-insforge-cli.sh  # Setup database InsForge
│   │   ├── auto-deploy-vercel.sh  # Deploy ke Vercel
│   │   └── deploy-all.sh          # ONE-COMMAND deploy
│   ├── .github/workflows/         # GitHub Actions
│   └── vercel.json                # Vercel config
├── .env                           # Environment variables
└── package.json
```

---

## 🗄️ Database Schema

23 tabel PostgreSQL:

| # | Tabel | Fungsi |
|---|-------|--------|
| 1 | users | Akun user (superadmin, user) |
| 2 | parameters | Parameter pemeriksaan lab |
| 3 | lotqc | Lot reagen QC |
| 4 | inputqc | Input data QC harian |
| 5 | historiqc | Riwayat perubahan QC |
| 6 | calculatedstats | Statistik terhitung (mean, SD, CV) |
| 7 | biaspme | Data Bias PME |
| 8 | daftartea | Daftar TEa |
| 9 | sigmacvopt | Optimasi Sigma & CV |
| 10-12 | laporan/kop/settings | Laporan, kop surat, settings |
| 13 | logactivity | Log aktivitas user |
| 14-16 | catatan dokter/password | Catatan & password sharing |
| 17-22 | img* | Image analysis (Hemato, Urin, Malaria, BTA, Lain, Patologi) |
| 23 | sessions | Session token autentikasi |

---

## 🔧 Development Lokal

```bash
# Install dependencies
bun install

# Generate Prisma client
bunx prisma generate

# Push schema ke database
bunx prisma db push

# Jalankan dev server
bun run dev

# Buka http://localhost:3000
```

---

## 🆘 Troubleshooting

| Masalah | Solusi |
|---------|--------|
| Deploy button error | Pastikan repo GitHub PUBLIC, ganti `USERNAME` di URL |
| Build error Vercel | Cek `DATABASE_URL` env var sudah diset |
| Database connection error | Pastikan `?sslmode=require` di akhir URL |
| Auto-deploy tidak trigger | Cek Vercel → Settings → Git → Connected Repository |

Lihat juga: [`auto-deploy/DEPLOY-VERCEL-BUTTON.md`](auto-deploy/DEPLOY-VERCEL-BUTTON.md)

---

## 📄 License

Private — All rights reserved.

---

## 🙋‍♂️ Support

Untuk bantuan teknis, hubungi developer atau buka issue di GitHub repo.
