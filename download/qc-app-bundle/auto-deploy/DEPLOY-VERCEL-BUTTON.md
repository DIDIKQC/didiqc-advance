# 🚀 Deploy ke Vercel — One Click

## Option 1: Deploy Button (EASIEST)

Setelah Anda push code ke GitHub, tambahkan tombol ini ke README.md repo Anda:

```markdown
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/USERNAME/didiqc&env=DATABASE_URL&envDescription=PostgreSQL%20connection%20string%20dari%20InsForge&project-name=didiqc&repository-name=didiqc)
```

**Ganti `USERNAME` dengan GitHub username Anda.**

Tombol akan tampil seperti:
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

---

## Option 2: Manual Deploy via Vercel Dashboard

1. Buka https://vercel.com/new
2. Import repository GitHub Anda
3. Set Environment Variables:
   - `DATABASE_URL` = `postgresql://...?sslmode=require` (dari InsForge)
4. Klik **Deploy**
5. Tunggu 2-3 menit → aplikasi online!

---

## Option 3: Vercel CLI (Script Otomatis)

Jalankan script otomatis yang sudah disediakan:

```bash
# Di PC lokal Anda (setelah extract bundle)
cd didiQCsys
bash auto-deploy/scripts/auto-deploy-vercel.sh
```

Script akan otomatis:
- Install Vercel CLI
- Login ke Vercel (via browser)
- Link project ke Vercel
- Set DATABASE_URL env var
- Deploy pertama
- Tampilkan URL stabil production

---

## 🔗 URL Stabil & Auto-Update

### URL Tidak Pernah Berubah
Setelah deploy pertama, URL Anda akan tetap sama selamanya:
```
https://didiqc-<username>.vercel.app
```

### Cara Update Aplikasi
Setiap kali Anda update code:

```bash
# Edit file aplikasi di PC lokal
# ...

# Commit & push ke GitHub
git add .
git commit -m "feat: tambah fitur baru"
git push origin main
```

**Vercel akan OTOMATIS:**
1. Detect push ke repo GitHub (dalam ~5 detik)
2. Build aplikasi (2-3 menit)
3. Deploy ke URL yang SAMA
4. Tidak perlu ganti link baru!

### Cek Status Deploy
- Vercel Dashboard: https://vercel.com/dashboard
- Atau via CLI: `vercel ls`
- Atau via GitHub Actions (jika pakai workflow)

---

## 📊 Diagram Alur Auto-Deploy

```
PC Lokal Anda          GitHub              Vercel           User
    │                    │                   │                │
    │ git push ─────────>│                   │                │
    │                    │ webhook ─────────>│                │
    │                    │                   │ build (2-3min) │
    │                    │                   │ deploy         │
    │                    │                   │ ────────────── >│ akses URL
    │                    │                   │                │ stabil
    │                    │                   │                │
    │                    │                   │<───── HTTP ────│
    │                    │<─── git log ──────│                │
    │                    │                   │                │
    v                    v                   v                v
    
URL: https://didiqc-username.vercel.app (TIDAK BERUBAH)
```

---

## ⚙️ Konfigurasi yang Sudah Disiapkan

### `vercel.json` (auto-deploy/vercel.json)
- Framework: Next.js (auto-detected)
- Build command: `bun run build`
- Install command: `bun install`
- Region: Singapore (terdekat untuk Indonesia)
- Max duration untuk API: 60 detik
- Security headers otomatis

### `.github/workflows/deploy-vercel.yml`
- Auto-trigger saat push ke `main` atau `master`
- Build & deploy otomatis via Vercel CLI
- Butuh 4 GitHub Secrets (lihat file untuk panduan)

### `.github/workflows/pre-deploy-checks.yml`
- Lint & build check sebelum deploy
- Mencegah deploy code yang error

### `auto-deploy/scripts/setup-insforge-cli.sh`
- Otomatisasi setup InsForge via CLI
- Install CLI, login, buat project, set env, push schema

### `auto-deploy/scripts/auto-deploy-vercel.sh`
- Otomatisasi deploy ke Vercel
- Set env vars, deploy pertama, setup auto-deploy

### `auto-deploy/scripts/deploy-all.sh`
- **ONE COMMAND untuk semuanya!**
- InsForge + GitHub + Vercel dalam sekali jalan

---

## 🆘 Troubleshooting

### Deploy button tidak jalan
- Pastikan repo GitHub Anda **PUBLIC** (atau Vercel punya akses ke private repo)
- Pastikan URL repo benar: `https://github.com/USERNAME/didiqc`

### Build error di Vercel
- Cek: Vercel dashboard → project → **Build Logs**
- Pastikan `DATABASE_URL` env var sudah diset
- Pastikan `postinstall: prisma generate` ada di package.json

### Database connection error
- Cek format URL: `postgresql://user:pass@host:5432/db?sslmode=require`
- Pastikan `?sslmode=require` ada
- URL-encode karakter khusus di password

### Auto-deploy tidak trigger
- Cek: Vercel dashboard → Settings → Git → "Connected Git Repository"
- Pastikan branch production = `main`
- Cek webhook GitHub: repo → Settings → Webhooks

### Mau pakai GitHub Actions instead
1. Setup 4 secrets di GitHub (lihat `.github/workflows/deploy-vercel.yml`)
2. Workflow akan auto-run setiap push
3. Tidak butuh Vercel-GitHub integration

---

## 📞 Butuh Bantuan?

Beri tahu saya:
1. Langkah mana yang gagal
2. Pesan error lengkap
3. Platform (Vercel/Netlify)

Saya bisa bantu debug!
