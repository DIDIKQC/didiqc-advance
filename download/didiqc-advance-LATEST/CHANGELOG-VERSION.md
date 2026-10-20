# 📜 CHANGELOG & VERSION HISTORY didiQCsys

> History lengkap versi dari v9.12 sampai v9.31 (versi terbaru).

---

## v9.31 (LATEST) — Oktober 2026

### Commit: `9277309` + `2d80e5d`
**Tanggal**: Oktober 2026
**Fokus**: View-As responsive, tombol Muat Data, auto-update dropdown, ikon login kanan, ceklis hak akses

### 5 Fitur Utama
1. **(A) Lihat Sebagai responsive** — Kolom "Lihat Sebagai" superadmin terlihat penuh di semua device (desktop/tablet/HP kecil)
   - CSS @media mobile: ganti `display:none` → `flex compact`
   - Select max-width 26vw/24vw, font .7rem/.66rem untuk layar kecil
   - Label dalam disembunyikan, pseudo "View:" dari rule 768px jadi label

2. **(B) Tombol "Muat Data" di topbar** — Benar-benar memuat data terbaru
   - Fungsi baru `refreshAppData()`:
     - `getInitData(getActiveUsername(), getActiveRole(), CU.role)` (hormati View-As)
     - `getAllMaster()` → perbarui CD.params/lots/teaList/settings/kop/allUsers
     - Perbarui CU (imgAnalAccess/isSecondary/accessMenu)
     - `populateFilters()` + `populateViewAs()` + `populateTrendYear()` + `initMasterCombos()`
     - `loadCurrentPage()` → render ulang halaman aktif
     - Toast konfirmasi
   - Tombol kiri tombol Keluar, title="Muat Data Terbaru"

3. **(C) Auto-update dropdown** — Saat data berubah, dropdown auto-refresh
   - `saveCalcStatsForm`, `delCalcStats` → `populateGrafikFilters()` setelah sukses
   - `saveSigmaCVOptForm`, `delSigmaCVOpt` → `populateGrafikFilters()`
   - `savePME`, `delPME` → `populateGrafikFilters()`
   - Dropdown yang auto-update: `grafPeriodeCS`, `grafPeriodeCVOpt`, `grafSiklusPME`, `grafTahunSiklus`
   - Parameter/Lot/TEa sudah auto-update via `refreshParams`/`refreshLots`/`refreshTEa`

4. **(D) Ikon login di sisi KANAN** — Ikon user & password di kanan kolom
   - CSS scoped `#loginForm .input-icon i.fa-user` → `left: auto; right: 14px`
   - Input padding: `14px/44px` (kiri/kanan)
   - Teks input tidak tertutup ikon

5. **(E) Ceklis hak akses Password Tambahan**
   - 2 ceklis: "Hanya menu Manajemen Alat Lab", "Hanya menu Image Analisis"
   - Boleh diceklis keduanya
   - Tidak menceklis = akses penuh (perilaku lama dipertahankan untuk legacy)
   - Backend: `loginUser` null→"" (bukan "grpEquipment")
   - Frontend: sidebar hanya tampilkan grup yang diceklis; goPage guard blokir page di luar grup allowed

### Bug Fix
- **Fix ikon eye password di KANAN** (commit `2d80e5d`)
  - Root cause: commit v9.31 lupa override `left: auto` untuk `.toggle-pwd` di form login
  - Generic rule `.form-group .input-icon i { left: 14px }` menetapkan `left:14px` untuk SEMUA `<i>`
  - Fix: 1 baris CSS `#loginForm .input-icon .toggle-pwd { left: auto; right: 14px; }`

### Files Changed
- `public/app.html` (CSS + JS untuk 5 fitur)
- `src/lib/backend/auth.ts` (loginUser null→"")
- `src/lib/backend/users.ts` (getUserPasswords null→"" untuk tampilan)
- `prisma/schema.prisma` (komentar accessMenu diperbarui)

---

## v9.30 — Oktober 2026

### Commit: `0924280`
**Fokus**: Password tambahan = tenant dengan akses penuh database akun induk

### Perubahan
- **Role sesi = role ASLI akun induk** (bukan "secondary")
  - Superadmin password tambahan → role sesi = superadmin → akses seluruh database superadmin
  - `isSecondary` tetap di-set untuk gating UI

- **Tenant guard di backend** (defense-in-depth):
  - `users.ts`: `if (_session?.isSecondary) return 'Akses ditolak'` pada:
    - getUsers, saveUser, deleteUser, approveUser
    - getUserPasswords, addUserPassword, deleteUserPassword
    - editUserPassword, toggleUserPasswordStatus
    - getOnlineUsers, getRegisteredUserCount
  - `master-data.ts`: `saveSettings` blokir isSecondary
  - `backup.ts`: backup/restore/reset blokir isSecondary
  - `import-db.ts`: importDB blokir isSecondary
  - `auth.ts`: getInitData tenant guard (View-As tidak boleh beda dari session.username untuk secondary)

- **Frontend simplifikasi**:
  - Hapus CSS tenant-mode & semua logika accessMenu/ceklis lama
  - `applyRole`: isSecondary menyembunyikan navUsers, navSettings, viewAsWrap, btnImportDB, cardOnlineUsers, cardRegisteredUsers
  - grpMultiMaster & menu lain mengikuti role induk
  - Landing = dashboard (bukan eqdash)
  - goPage guard blokir users/settings
  - populateViewAs/getActiveUsername/getActiveRole guard !isSecondary
  - Modal Kelola Password Tambahan: ceklis diganti info box "Semua menu & database akun ini ... KECUALI Users/Pengaturan/Lihat Sebagai"
  - Kolom Hak Akses = badge "Semua Menu"

### Pengecualian Eksplisit (Hanya Superadmin Langsung)
- Menu Users
- Menu Pengaturan (saveSettings/backup/restore/reset/importDB)
- Kolom Lihat Sebagai (viewAsWrap + guard getActiveUsername/Role + getInitData)

### Files Changed
- `public/app.html`
- `src/lib/backend/auth.ts`
- `src/lib/backend/users.ts`
- `src/lib/backend/master-data.ts`
- `src/lib/backend/backup.ts`
- `src/lib/backend/import-db.ts`

---

## v9.29 — September 2026

### Commit: `6ebd4dc`
**Fokus**: 27 dropdown filter di 5 menu jadi searchable combobox

### 5 Menu yang Diubah
1. **Grafik & Analisis** (9 dropdown): grafBidang, grafParam, grafLot, grafSumber, grafSumberSigma, grafSiklusPME, grafTahunSiklus, grafPeriodeCS, grafPeriodeCVOpt
2. **Laporan** (3): lapBidang, lapParam, lapLot
3. **Trend Analisis** (8): trendTahun, trendBulanAwal, trendBulanAkhir, trendBidang, trendParam, trendLot, trendSiklusPME, trendTahunSiklus
4. **Validasi QC** (3): valBidang, valParam, valStatus
5. **Histori QC** (4): histBidang, histParam, histLot, histFilter

### Design Pattern
- `<select>` asli TETAP di DOM (kelas `.ss-src` display:none) sebagai sumber nilai tunggal
- Semua kode lama (G(id).value, filterParamByBidang, populateLotSelect, dll) bekerja tanpa diubah
- Widget custom di depan select untuk:
  - Ketik-untuk-filter (case-insensitive contains)
  - Klik item
  - Keyboard nav (Enter, ArrowUp/Down, Escape, Tab)
  - Panel position:fixed (lolos dari .card overflow:hidden)
  - Flip atas saat ruang bawah sempit
  - Reposisi saat scroll/resize
  - Tutup saat klik luar
  - Highlight item terpilih

### Sync 3 Jalur
1. **Property override** `select.value`: tangkap reset programatik
2. **MutationObserver childList**: tangkap innerHTML rebuild
3. **Event change**: tangkap perubahan dari kode lama

### Files Changed
- `public/app.html` (CSS +1 blok, JS +1 blok)

---

## v9.28 — September 2026

### Commit: `10ba049`
**Fokus**: Opsi cetak g & h di Grafik & Analisis

### Opsi Cetak Baru
- **Opsi g**: Grafik LJ tanpa marker + Tabel Statistik QC + Tabel Penjelasan & Interpretasi Detail Statistik QC + Catatan + TTD
- **Opsi h**: Seperti g + Grafik LJ Sigma-Based (jika lastSigmaBasedData ada)

### Files Changed
- `public/app.html`

### Bug Fix di Versi Ini
- Fix grafik LJ terpotong (commit `f0b6bde`)
  - Hapus kolom "Penjelasan & Rumus" pada tabel Penjelasan & Interpretasi Detail
  - Tambah `white-space: normal` pada td interpretasi (akar masalah: global `.table-wrap td { white-space: nowrap }` membuat tabel meluas sampai 5596px → canvas LJ ikut di-resize Chart.js jadi 5211px)

---

## v9.27 — September 2026

### Commit: `c078bec` + `45d3da3` + `7159696`
**Fokus**: Full i18n ID/EN, card user terdaftar, QGI visibility fix, fix empty menus

### Fitur Utama
1. **Full i18n translation** (779 phrase pairs)
   - DOM-walking translator (`_translateNode`)
   - MutationObserver untuk dynamic content (table renders, toasts, modals)
   - Tenant scoping per akun (`localStorage didiqc_lang_<username>`)
   - Bug fix: `PHRASES_REV` builder skip self-maps (k===v)

2. **Card User Terdaftar** di Dashboard (superadmin only)

3. **Fix empty menus nesting** (34 halaman ter-nesting & kosong)
   - Tambah `</div>` yang hilang di banyak submenu

4. **QGI visibility fix**
   - Blok "Analisis QGI" hanya muncul ketika sigma < 4

---

## v9.26 — Agustus 2026

### Fitur
1. Kolom TEa pada tabel Statistik QC
2. Tabel Penjelasan & Interpretasi Detail Statistik QC (Mean, SD, CV%, Bias%, TE% vs TEa%, Unc, σ, TEa per level)
3. AnalisisOPSpecs: filter parameter diganti checklist ceklis per Bidang; tombol Analisis hanya menghitung parameter tercentang

### Files Changed
- `public/app.html`
- `src/lib/backend/reports.ts`

---

## v9.25 — Agustus 2026

### Fitur: 12 Kolom Eksplisit Bias PME
- Tambah kolom: Hasil L1/L2/L3, Hasil P L1/L2/L3, Bias L1%/L2%/L3%, Sigma L1/L2/L3
- Total tabel Bias PME: 23 + 12 = 35 kolom

---

## v9.24 — Agustus 2026

### Fitur
1. Tampilkan Hasil L1-L3, Hasil P L1-L3, Bias L1-L3%, Sigma L1-L3 di tabel Bias PME
2. Dropdown parameter di form "tambah parameter" mode pilih-saja (searchable, tanpa teks bebas) — `allowFreeText: false`
3. Bidang terisi otomatis sesuai parameter & readonly
4. Scroll horizontal tabel Bias PME

---

## v9.23 — Agustus 2026

### Fitur: Filter + Print/PDF/Excel di Bias PME
- Filter Siklus/Tahun/Ceklist Parameter
- Tombol Print/PDF/Export Excel

---

## v9.22 — Agustus 2026

### Fitur: Z-Score di Bias PME
- 6 fitur Z-Score baru di submenu Bias PME
- Z-QC calculation per level

---

## v9.21 — Agustus 2026

### Task 34 — Tenant Isolation Lengkap
- Audit tenant isolation across all backend handlers
- Fix di master-data.ts (6 list handlers + 3 unscoped helpers)
- Fix di inputqc.ts (7 list/get handlers)
- Fix di equipment.ts (ownerWhere helper + 13 cascading handlers + computeLinkedQCStats)
- Fix di calculations.ts (6 list handlers)
- Fix di reports.ts, dashboard.ts, graph.ts, qc-helpers.ts
- Fix di misc.ts, westgard.ts, users.ts
- Pattern: `where: { ownerUsername: session.username }` di setiap query

### Task 32-33 — Fix Parameter Per-Account
- Dropdown parameter hanya dari submenu "Parameter" (per-account)
- Submenu Kalibrasi QR scan tampilkan semua info
- Dashboard & Report equipment per-akun

---

## v9.20 — Juli 2026

### Fitur
1. **Menu Multi Master** (superadmin-only)
   - Daftar parameter/alat/metode/satuan/TEa global
   - Searchable dropdown (combobox) di 6 submenu

2. **Aktifkan tombol registrasi**
   - Tombol registrasi diaktifkan dan berfungsi

---

## v9.19 — Juli 2026

### Fitur: Equipment 360 (Manajemen Alat Lab)
- Tambah menu "Manajemen Alat Lab"
- Berdasarkan PRD_Equipment360_DiDiQC_v1.0
- Fitur:
  - Dashboard equipment
  - Master equipment + QR passport
  - Maintenance dengan TTD digital
  - Kalibrasi dengan rentang tanggal
  - Hubungkan ke Parameter DiDiQC + auto-connect Sigma L1/L2/L3
  - Print/PDF/Excel export

### 5 Fixes di Versi Ini (Task 23)
1. Foto alat tidak tampil saat URL diinput & saat QR discan
2. Ganti kolom signature URL di Maintenance dengan tanda tangan digital
3. Rapikan tampilan ceklist parameter "Hubungkan ke Parameter DiDiQC"
4. Hasil sigma QC L1/L2/L3 benar-benar ditampilkan sesuai ceklist parameter
5. Tambah rentang tanggal filter pada kolom Hubungkan ke Parameter DiDiQC

### 4 Fixes di Versi Ini (Task 22)
1. Rename menu: Equipment 360 → Manajemen Alat Lab
2. Photo preview di form Tambah Equipment
3. QR di Master Equipment action column + Digital Equipment Passport
4. Hubungkan ke Parameter DiDiQC checklist + auto-connect Sigma L1/L2/L3

---

## v9.18 — Juli 2026

### Fitur: Patologi Anatomi Module
- Form "tambah data" dengan optional fields:
  - Tempat Lahir, NIK, No Tlpn, Lokasi Jaringan/Sampel, Ganas/Tidak Ganas
- Per-print visibility toggle
- Master Dokter Pengirim, Asal Ruangan, Asal Rujukan (dropdown)
- Dashboard PA (analytics with charts)
- Laporan PA (filtered report + CSV/Excel export)
- Footer: HANYA Dokter Spesialis Patologi Anatomi (QR + TTD + name)

---

## v9.17 — Juli 2026

### Fitur
1. **Dashboard trend detail semua bidang** (Task 3)
   - Tampilkan SEMUA bidang (termasuk yang 0 QC)
   - Otomatis adaptif saat ada penambahan bidang baru

2. **Fix Lot QC overwrite** (Task 4)
   - Bug: tambah Lot QC menimpa lot sebelumnya
   - Fix ID generation untuk selalu increment unique

3. **Export Database Excel + Fix View As** (Task 5)
   - Tombol "Export Database" di menu Input QC
   - Export Input QC + Parameter + Lot QC ke Excel dengan filter
   - Fix View As superadmin

4. **Fix form Export Database** (Task 6)
   - Tombol "Batal" dan "Export Excel" dipindah ke bagian bawah

5. **Fix View As dashboard bug + Enhance Validasi QC** (Task 7)
   - Fix Sigma/CV-Bias/Trend Detail tidak render saat kembali ke akun sendiri
   - Validasi QC: status filter, date range, search, default 24h, Edit & Hapus buttons

6. **Fix image analysis blank** (Task 8)
   - Penyebab: shim tidak kirim session untuk image analysis RPC

7. **Kop Surat + TTD digital PA** (Task 9)
   - Field "Nama PJ Dokter PA" di Kop Surat
   - TTD elektronik untuk dokter PA

8. **Fix Patologi footer** (Task 10)
   - Footer: HANYA Dokter Spesialis Patologi Anatomi

9. **Login background brightness + LJ animation** (Task 11)
   - Brightness level untuk login background image (sampai 10 level)
   - Movement animation di LJ chart plot di login form

10. **Hapus small logo di login** (Task 12)
    - Hapus small logo image dan small logo box

11. **Fix Prisma error sqlite URL** (Task 13)
    - Switch schema.prisma ke postgresql + fix DATABASE_URL

---

## v9.16 — Juli 2026

### Fitur: Auto-Deploy GitHub → Vercel
- Setup Vercel-GitHub OAuth untuk auto-deploy selamanya
- Branch `main` → auto-build → auto-deploy ke production
- Vercel webhook ke GitHub untuk status check
- Stable URL: https://didiqc-advance.vercel.app

---

## v9.15 — Juli 2026

### Fitur: InsForge Live Integration
- Direct integration ke InsForge project "didiqc advance"
- Konfigurasi DATABASE_URL production
- Production URL: https://didiqc-advance.vercel.app
- Region: sin1 (Singapore)

---

## v9.14 — Juli 2026

### Fitur: Bundle Download
- Bundle source code + database SQLite di-zip untuk migrasi lokal
- Bundle untuk InsForge (PostgreSQL) + GitHub + Vercel/Netlify
- Disimpan di `/download/qc-app-bundle/`

---

## v9.13 — Juli 2026

### Bug Fixes Awal
- Fix preview blank (iframe sandbox warning)
- Fix "Tambah Parameter", "Tambah Users", "Tambah Daftar TEa" buttons tidak berfungsi
- Fix ikon Trend Analisis & Instrument Compare submenu hilang
- Fix data user belum tampil di Users page
- Fix tombol aksi edit dan hapus pada Input QC tidak berfungsi

---

## v9.12 — Juli 2026 (Initial Release)

### Fitur: 100% Porting GAS → Next.js
- 180+ fungsi GAS → 17 modul TypeScript (~10,000 baris)
- 0 modifikasi UI/CSS/JS asli (frontend tetap `public/app.html`)
- Shim `google.script.run` → `POST /api/rpc`
- 23 model Prisma PostgreSQL (22 sheet + Sessions)
- InsForge integration (PostgreSQL live)
- Data migration: 82 baris SQLite → PostgreSQL
- Dev server persistent di port 3000

### Modul Backend (17 files, ~10,000 baris)
1. `auth.ts` — Login, session, password tambahan
2. `users.ts` — User management
3. `master-data.ts` — Parameter, lot, TEa, settings
4. `inputqc.ts` — Input QC data
5. `calculations.ts` — QC calculations (mean, sd, cv, bias, te, sigma)
6. `westgard.ts` — Westgard rules engine (single + across run)
7. `graph.ts` — Graph & chart data
8. `dashboard.ts` — Dashboard aggregation
9. `reports.ts` — Report generators (laporan, trend, instrcompare, tabulasi, opspecs)
10. `images.ts` — Image analysis (6 jenis)
11. `backup.ts` — Backup/restore
12. `smart-import.ts` — Smart import dari Excel
13. `import-db.ts` — DB import
14. `misc.ts` — Misc functions
15. `qc-helpers.ts` — QC helpers
16. `multi-master.ts` — Multi-master (superadmin only)
17. `equipment.ts` — Equipment 360 (Manajemen Alat Lab)

---

## ROADMAP (Belum Dikerjakan)

Berdasarkan permintaan user terakhir yang belum selesai:

### Task A: Fix TRIGLISERID tidak tampil di superadmin
- **Root cause**: `getParameters` di master-data.ts filter by `ownerUsername: didik` saja, tapi TRIGLISERID row punya `ownerUsername: admin` (dibuat sebelum tenant isolation)
- **Plan**: Ubah `getParameters` jadi union query — parameter milik sendiri ∪ parameter yang ada data QC di lotQC/inputQC/historiQC/calculatedStats/biasPME/daftarTEa/sigmaCVOpt (data-driven self-healing)
- **Tujuan**: "pastikan jangan ada kesalahan seperti ini lagi" (prevent recurrence)

### Task B: Filter lengkap di Master Equipment
- Tambah filter dropdown: status kepemilikan, vendor, status, dll
- Berdasarkan field yang sudah ada di schema equipment (v9.32+)

---

## STATISTIK VERSION HISTORY

| Versi | Tanggal | Komitmen Utama |
|-------|---------|----------------|
| v9.12 | Jul 2026 | Initial porting GAS → Next.js |
| v9.13 | Jul 2026 | Bug fixes awal |
| v9.14 | Jul 2026 | Bundle download |
| v9.15 | Jul 2026 | InsForge live |
| v9.16 | Jul 2026 | Auto-deploy GitHub→Vercel |
| v9.17 | Jul 2026 | Dashboard, Equipment 360, Patologi module |
| v9.18 | Jul 2026 | Patologi optional fields, master dropdowns |
| v9.19 | Jul 2026 | Equipment 360 enhancements (QR passport, sigma linkage) |
| v9.20 | Jul 2026 | Multi Master menu, registrasi, fix PDF |
| v9.21 | Aug 2026 | Tenant isolation penuh (Task 34) |
| v9.22 | Aug 2026 | Z-Score di Bias PME |
| v9.23 | Aug 2026 | Filter + Print/PDF/Excel di Bias PME |
| v9.24 | Aug 2026 | Tabel Bias PME 35 kolom, combobox |
| v9.25 | Aug 2026 | 12 kolom eksplisit Bias PME |
| v9.26 | Aug 2026 | TEa kolom, OPSpecs checklist |
| v9.27 | Sep 2026 | Full i18n, fix empty menus, QGI fix |
| v9.28 | Sep 2026 | Opsi cetak g & h, fix grafik LJ |
| v9.29 | Sep 2026 | 27 dropdown searchable |
| v9.30 | Okt 2026 | Password tambahan akses penuh (tenant) |
| **v9.31** | **Okt 2026** | **ViewAs responsive, Muat Data, auto-update, login icons, ceklis access** |

---

*didiQCsys v9.31 — Changelog Lengkap*
