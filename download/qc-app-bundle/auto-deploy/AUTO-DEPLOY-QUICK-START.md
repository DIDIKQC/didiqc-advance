# 🚀 Auto-Deploy: InsForge + GitHub + Vercel

## ⚡ Quick Start (3 Menit)

### Cara 1: One-Command Deploy ⭐

```bash
# 1. Extract bundle
unzip didiQCsys-complete-bundle.zip
unzip source-code.zip -d didiQCsys
cd didiQCsys

# 2. Copy auto-deploy scripts ke project
cp -r ../auto-deploy .

# 3. Jalankan ONE command
bash auto-deploy/scripts/deploy-all.sh
```

**Hasil**: Aplikasi online di `https://didiqc-username.vercel.app` dengan:
- ✅ Database: InsForge PostgreSQL
- ✅ Source: GitHub (auto-deploy)
- ✅ URL stabil (tidak berubah saat update)

---

### Cara 2: Deploy Button (Manual)

1. **Setup InsForge** (5 menit)
   - Daftar di https://insforge.dev
   - Buat project baru
   - Copy PostgreSQL connection string

2. **Push ke GitHub** (5 menit)
   ```bash
   git init
   git add .
   git commit -m "init: didiQCsys"
   git remote add origin https://github.com/USERNAME/didiqc.git
   git push -u origin main
   ```

3. **Klik Deploy Button** (2 menit)
   
   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)
   
   - Import repo GitHub Anda
   - Set env var: `DATABASE_URL` = connection string InsForge
   - Klik Deploy!

---

## 🔄 Cara Update Aplikasi (URL Tetap Sama)

```bash
# Edit code di PC lokal
# ...

# Commit & push
git add .
git commit -m "feat: tambah fitur baru"
git push origin main
```

**Otomatis terjadi:**
- 5 detik: Vercel detect push dari GitHub
- 2-3 menit: Build aplikasi
- Deploy ke URL yang SAMA: `https://didiqc-username.vercel.app`
- User langsung lihat versi baru

**URL TIDAK PERNAH BERUBAH** selama update aplikasi! ✨

---

## 📦 Isi Folder `auto-deploy/`

```
auto-deploy/
├── scripts/
│   ├── setup-insforge-cli.sh     # Setup database InsForge otomatis
│   ├── auto-deploy-vercel.sh     # Deploy ke Vercel + set env vars
│   └── deploy-all.sh             # ONE-COMMAND untuk semua
├── .github/
│   └── workflows/
│       ├── deploy-vercel.yml     # GitHub Actions: auto-deploy
│       └── pre-deploy-checks.yml # GitHub Actions: lint + build check
├── vercel.json                   # Config Vercel (build, region, headers)
├── package.scripts.json          # Scripts tambahan untuk package.json
├── deploy-button.html            # Halaman visual dengan tombol Deploy
├── DEPLOY-VERCEL-BUTTON.md       # Panduan lengkap
└── README.md                     # README untuk GitHub repo
```

---

## 🛠️ Setup GitHub Actions (Opsional, Lebih Powerful)

Jika ingin auto-deploy via GitHub Actions (selain Vercel-GitHub integration):

### 1. Dapatkan Vercel Tokens
- Buka https://vercel.com/dashboard → Settings → Account → Tokens
- Create Token → Copy (format: `vercel_xxx`)

### 2. Dapatkan Project ID & Org ID
- Setelah deploy pertama via CLI/dashboard
- Buka project → Settings → General
- Copy "Project ID" dan "Organization ID"

### 3. Tambahkan GitHub Secrets
Buka: `https://github.com/USERNAME/didiqc/settings/secrets/actions`

| Name | Value |
|------|-------|
| `VERCEL_TOKEN` | `vercel_xxx...` |
| `VERCEL_PROJECT_ID` | `prj_xxx...` |
| `VERCEL_ORG_ID` | `team_xxx...` atau personal |
| `DATABASE_URL` | `postgresql://...?sslmode=require` |

### 4. Push — Auto-Deploy via Actions!
```bash
git push origin main
```

GitHub Actions akan:
- Lint check
- Build aplikasi
- Deploy ke Vercel
- Print URL production

Lihat status di: `https://github.com/USERNAME/didiqc/actions`

---

## 🎯 Arsitektur Auto-Deploy

```
┌──────────────────────────────────────────────────────────────┐
│                    CARA UPDATE APLIKASI                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   PC Lokal ──git push──> GitHub ──webhook──> Vercel         │
│      │                       │                    │          │
│      │                       │                    │ build    │
│      │                       │                    │ (2-3min) │
│      │                       │                    │          │
│      │                       │                    │ deploy   │
│      │                       │                    ▼          │
│      │                       │              ┌──────────┐     │
│      │                       │              │  Vercel  │     │
│      │                       │              │ Hosting  │     │
│      │                       │              └────┬─────┘     │
│      │                       │                   │           │
│      │                       │                   │           │
│   User ──────────────────────┴───────────────────┘           │
│      │                                                        │
│      │ akses URL stabil                                       │
│      ▼                                                        │
│   https://didiqc-username.vercel.app                         │
│   (URL TIDAK PERNAH BERUBAH)                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## ❓ FAQ

### Q: Apakah URL benar-benar tidak berubah?
**A**: Ya! Setelah deploy pertama, URL `https://didiqc-username.vercel.app` tetap sama selamanya. Setiap update (git push) hanya mengganti konten di URL tersebut, bukan membuat URL baru.

### Q: Berapa lama proses update?
**A**: 
- Git push: ~5 detik
- Vercel detect: ~5 detik
- Build: 2-3 menit
- Total: **~3 menit** dari push sampai live

### Q: Bisakah rollback ke versi lama?
**A**: Ya! Vercel dashboard → Deployments → pilih versi lama → klik "Promote to Production". 1 klik, selesai dalam 10 detik.

### Q: Berapa biaya total?
**A**: 
- InsForge: Free tier (cukup untuk QC system kecil)
- GitHub: Free (private repo unlimited)
- Vercel: Free tier (100GB bandwidth/bulan)
- **Total: $0/bulan** untuk skala kecil-menengah

### Q: Bagaimana jika database InsForge down?
**A**: Aplikasi akan menampilkan error. InsForge biasanya uptime 99.9%. Untuk backup, Anda bisa export database berkala via `bunx prisma db pull`.

### Q: Bisakah custom domain (mis. qc.klinik-saya.com)?
**A**: Ya! Vercel dashboard → Project → Settings → Domains → Add domain. SSL otomatis gratis (Let's Encrypt).

---

## 🆘 Troubleshooting

### Deploy button tidak jalan
- Pastikan repo GitHub **PUBLIC** atau Vercel punya akses ke private repo
- Ganti `USERNAME` di URL button dengan username GitHub Anda

### Build error di Vercel: "Prisma Client not generated"
**Solusi**: Edit `package.json`, tambahkan:
```json
"scripts": {
  "postinstall": "prisma generate"
}
```

### Database connection error
- Format URL: `postgresql://user:pass@host:5432/db?sslmode=require`
- Pastikan `?sslmode=require` ada
- URL-encode karakter khusus di password (`@` → `%40`)

### Auto-deploy tidak trigger
1. Cek Vercel dashboard → Settings → Git → "Connected Git Repository"
2. Pastikan branch production = `main`
3. Atau pakai GitHub Actions workflow (lebih reliable)

### Vercel CLI: "unauthorized"
```bash
vercel logout
vercel login
```

---

## 📞 Butuh Bantuan?

Beri tahu saya:
1. **Langkah mana yang gagal** (mis. "Step 3 Vercel deploy error")
2. **Pesan error lengkap** (copy-paste terminal output)
3. **Platform**: Vercel atau Netlify
4. **OS**: Windows / Mac / Linux

Saya bisa bantu debug step-by-step! 🚀
