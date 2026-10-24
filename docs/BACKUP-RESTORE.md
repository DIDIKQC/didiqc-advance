# DIDIQC — Sistem Backup & Restore Database

> Dokumentasi lengkap implementasi backup otomatis harian ke Cloudflare R2 dan
> restore multi-database (InsForge produksi / Neon / staging).
> Terakhir diperbarui: v9.32

---

## Daftar Isi

1. [Ringkasan Arsitektur](#1-ringkasan-arsitektur)
2. [File yang Dibuat / Diubah](#2-file-yang-dibuat--diubah)
3. [Secrets yang Diperlukan](#3-secrets-yang-diperlukan)
4. [Langkah Deployment](#4-langkah-deployment)
5. [Backup Harian Otomatis (02.00 WIB)](#5-backup-harian-otomatis-0200-wib)
6. [Backup Pertama & Verifikasi](#6-backup-pertama--verifikasi)
7. [Retensi 15 Backup](#7-retensi-15-backup)
8. [Prosedur Restore](#8-prosedur-restore)
9. [Restore ke Neon — Kompatibilitas & Penyesuaian](#9-restore-ke-neon--kompatibilitas--penyesuaian)
10. [Restore ke Produksi InsForge + Rollback](#10-restore-ke-produksi-insforge--rollback)
11. [Pemulihan Selektif](#11-pemulihan-selektif)
12. [Monitoring, Status & Notifikasi](#12-monitoring-status--notifikasi)
13. [Hasil Pengujian Nyata](#13-hasil-pengujian-nyata)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Ringkasan Arsitektur

```
┌─────────────────────────┐    pg_dump (format .dump custom)     ┌──────────────────────┐
│  InsForge PostgreSQL    │ ───────────────────────────────────► │  GitHub Actions       │
│  (Produksi DIDIQC)      │    dijalankan runner ubuntu-latest   │  cron 19:00 UTC       │
│  PG 15.18               │                                      │  (= 02:00 WIB)        │
└─────────────────────────┘                                      └──────────┬───────────┘
                                                                            │ S3 API
                                                                            ▼
                                                              ┌──────────────────────────┐
                                                              │  Cloudflare R2           │
                                                              │  bucket: didikqc         │
                                                              │  prefix: database_didiqc/│
                                                              │   ├─ didiqc_TANGGAL.dump │
                                                              │   ├─ *.sha256 / *.meta   │
                                                              │   ├─ status/…            │
                                                              │   └─ pre-restore/…       │
                                                              └──────────┬───────────────┘
                                                                         │ unduh + pg_restore
                                              ┌──────────────────────────┼────────────────────┐
                                              ▼                          ▼                    ▼
                                       InsForge (prod,          Neon PostgreSQL        Database staging
                                       wajib konfirmasi         (scope app,            / custom (URL
                                       + backup keselamatan)    tanpa menyentuh        apa pun)
                                                                produksi)
```

Prinsip penting:

- **Backup** memakai `pg_dump --format=custom` → file `.dump` yang kompatibel
  `pg_restore`, sudah termasuk kompresi internal.
- **Verifikasi berlapis**: validasi arsip lokal → unggah → cek ukuran via
  `head-object` → unduh ulang → banding `sha256` → validasi arsip lagi.
- **Retensi hanya berjalan setelah backup baru berhasil diunggah & diverifikasi**;
  hanya menyentuh file dengan pola ketat `database_didiqc/didiqc_YYYY-MM-DD_HHMMSS.dump`
  (dan sidecar `.sha256` / `.meta.json`-nya). Prefix lain (`database_didiqc_update/`,
  `status/`, `pre-restore/`, dsb.) **tidak pernah disentuh**.
- **Restore default-nya aman**: target default adalah staging/database baru, bukan
  produksi. Restore produksi memerlukan konfirmasi eksplisit + backup keselamatan otomatis.
- **Kredensial tidak pernah ada di frontend maupun repositori** — hanya di GitHub
  Secrets dan (untuk panel admin baca-status) Vercel Environment Variables.

> **Catatan nama bucket**: instruksi menyebut bucket `didiqc`, namun bucket yang
> benar-benar ada di akun Cloudflare R2 Anda adalah **`didikqc`** (dengan "k").
> Sistem ini memakai bucket existing `didikqc` (tidak membuat bucket baru), prefix
> tetap `database_didiqc/`. Jika keliru, ubah secret `R2_BUCKET`.

---

## 2. File yang Dibuat / Diubah

**Dibuat (baru, tidak mengubah fitur DIDIQC yang ada):**

| File | Fungsi |
|---|---|
| `scripts/backup/common.sh` | Pustaka bersama: validasi env, wrapper AWS CLI R2, logging WIB, webhook, verifikasi arsip |
| `scripts/backup/db-backup.sh` | Backup penuh: snapshot row count → pg_dump → verifikasi → unggah → verifikasi R2 → status → retensi |
| `scripts/backup/db-retention.sh` | Retensi maks 15 backup (pola ketat, `--dry-run` tersedia) |
| `scripts/backup/db-compat-check.sh` | Cek kompatibilitas dump ↔ tujuan (versi PG, ekstensi, encoding) |
| `scripts/backup/db-restore.sh` | Restore dengan pengaman produksi + rollback + verifikasi row count vs snapshot |
| `scripts/backup/db-list-backups.sh` | Melihat daftar backup & status terakhir di R2 |
| `.github/workflows/db-backup.yml` | Cron harian 02:00 WIB + pemicu manual (backup / list) |
| `.github/workflows/db-restore.yml` | Restore manual via GitHub UI (dengan validasi konfirmasi produksi) |
| `src/app/api/backup/status/route.ts` | API read-only status & daftar backup (khusus superadmin) |
| `public/backup-admin.html` | Panel admin status backup (halaman terpisah, tidak menyentuh app.html) |
| `docs/BACKUP-RESTORE.md` | Dokumen ini |

**Diubah (additive saja):**

| File | Perubahan |
|---|---|
| `.env.example` | Ditambah daftar variabel backup/restore (template saja, tanpa nilai asli) |
| `package.json` | Ditambah dependensi server-side `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (dipakai API status) |

**Yang TIDAK diubah:** seluruh fitur aplikasi DIDIQC (RPC layer, `app.html`, Prisma
schema, modul `src/lib/backend/backup.ts` & `import-db.ts` lama tetap utuh).

---

## 3. Secrets yang Diperlukan

### GitHub (Settings → Secrets and variables → Actions) — WAJIB

| Secret | Isi | Catatan |
|---|---|---|
| `INSFORGE_DATABASE_URL` | `postgresql://postgres:…@rz7b4fhh.ap-southeast.database.insforge.app:5432/insforge?sslmode=require` | Kredensial produksi (yang sama dipakai deploy) |
| `R2_ENDPOINT` | `https://3695a92b0fb25af70344ecb676e27201.r2.cloudflarestorage.com` | Endpoint S3 R2 (bukan API token `cfat_…` — token itu tidak dipakai sistem ini) |
| `R2_ACCESS_KEY_ID` | `4f1d3c2e…` | Access Key R2 (bagian "Use jurisdiction-specific endpoints") |
| `R2_SECRET_ACCESS_KEY` | `a51d95c0…` | Secret Access Key R2 |
| `R2_BUCKET` | `didikqc` | Bucket existing (lihat catatan di §1) |
| `R2_PREFIX` | `database_didiqc` | Prefix simpan |

### GitHub — OPSIONAL

| Secret | Isi | Catatan |
|---|---|---|
| `NEON_DATABASE_URL` | `postgresql://…@ep-xxx…neon.tech/neondb?sslmode=require` | Untuk restore ke Neon. **Gunakan endpoint langsung (bukan `-pooler`)** |
| `STAGING_DATABASE_URL` | `postgresql://…` | Target restore staging |
| `BACKUP_ALERT_WEBHOOK` | URL webhook | Notifikasi gagal (Slack/Discord/generik `{"text":…}`) |
| `RETENTION_KEEP` | `15` | Default 15 bila tidak diset |
| `RESTORE_JOBS` | mis. `4` | Restore paralel (non-atomik); default atomik 1 transaksi |

### Vercel (Settings → Environment Variables) — untuk panel admin baca-status

| Variabel | Isi |
|---|---|
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PREFIX` | Sama seperti di atas |

> Panel admin (`/backup-admin.html`) hanya **membaca** status/daftar dari R2 dan
> men-generate tautan unduh sementara (15 menit). Ia tidak bisa memicu backup/restore.

---

## 4. Langkah Deployment

1. **Set GitHub Secrets** sesuai §3 (Minimal 6 secret WAJIB).
2. **Push repositori** — workflow `db-backup.yml` & `db-restore.yml` ikut ter-deploy.
   Setelah push, cek tab **Actions** di GitHub: workflow "DIDIQC Backup Database" harus
   muncul. Jadwal harian otomatis aktif (cron `0 19 * * *` = 02.00 WIB).
3. **Jalankan backup pertama secara manual** (lihat §6) — jangan menunggu 02.00.
4. **(Opsional) Set Vercel Environment Variables** §3 bila ingin panel admin aktif.
5. **(Saat tersedia) Set `NEON_DATABASE_URL`** untuk mengaktifkan restore ke Neon.

> **Keandalan cron GitHub Actions**: penjadwal bisa telat beberapa menit dan workflow
> terjadwal dinonaktifkan otomatis GitHub jika repositori tidak ada aktivitas selama
> ±60 hari. Aplikasi DIDIQC aktif dikembangkan, jadi ini aman; bila nanti jarang
> di-commit, jalankan pemicu manual secara berkala atau pertimbangkan ping otomatis.

---

## 5. Backup Harian Otomatis (02.00 WIB)

- Jadwal: `cron: '0 19 * * *'` (UTC) = **02.00 WIB** (UTC+7).
- Proses tiap hari (semua otomatis):
  1. Snapshot row count semua tabel `public` (41 tabel DIDIQC).
  2. `pg_dump --format=custom --no-owner` → `didiqc_YYYY-MM-DD_HHMMSS.dump` (timestamp WIB).
  3. Validasi arsip (pg_restore --list).
  4. Unggah ke `s3://didikqc/database_didiqc/` (+ `.sha256`, + `.meta.json` berisi
     ukuran, checksum, versi PG, jumlah tabel/baris per tabel).
  5. Verifikasi R2: `head-object` (ukuran) → unduh ulang → banding `sha256` → validasi arsip.
  6. Tulis status ke `database_didiqc/status/backup-status.json`.
  7. **Hanya bila langkah 4–5 sukses**: retensi (hapus >15 backup terlama).
  8. Bila gagal: status `failed` ditulis + webhook (bila diset) + job GitHub berstatus merah.

Ukuran database saat ini ±23 MB → file `.dump` ±1,3 MB, durasi total ±45 detik.

---

## 6. Backup Pertama & Verifikasi

**Status: ✅ SUDAH DIJALANKAN & TERVERIFIKASI.**

Backup pertama dijalankan pemicu manual (bukan menunggu 02.00), dan hasilnya
diverifikasi berlapis:

| Bukti | Nilai |
|---|---|
| File di R2 | `s3://didikqc/database_didiqc/didiqc_2026-10-21_145017.dump` |
| Ukuran | 1.285.649 byte (remote = lokal, via `head-object`) |
| sha256 | cocok antara file lokal, file yang diunggah, dan file yang diunduh ulang |
| Validasi arsip | `pg_restore --list` OK — 41 tabel public, 93 TABLE DATA |
| Snapshot data | 41 tabel, total 18.215 baris (termasuk inputqc 17.073) |
| Status | `database_didiqc/status/backup-status.json` → `lastRunStatus: success` |

Cara menjalankan ulang / memicu manual kapan pun:

- GitHub → **Actions → DIDIQC Backup Database → Run workflow → mode `backup`**, atau
- dari mesin dengan kredensial di environment: `bash scripts/backup/db-backup.sh`.

---

## 7. Retensi 15 Backup

- Jumlah maksimum backup harian: **15** (secret `RETENTION_KEEP` bila ingin ubah).
- Retensi dijalankan **hanya setelah backup baru terverifikasi** — jadi tidak
  pernah menghapus backup lama sebelum penggantinya aman.
- File yang dihapus dibatasi pola ketat `^database_didiqc/didiqc_…\.dump$` plus
  sidecar `.sha256`/`.meta.json` milik file tsb. Backup terbaru tidak pernah dihapus.
- **Backup keselamatan pre-restore** (§10) disimpan di `database_didiqc/pre-restore/`
  dan **tidak dihitung/tidak dihapus** oleh retensi.
- Dry run manual: `bash scripts/backup/db-retention.sh --dry-run`.

---

## 8. Prosedur Restore

### 8.1 Via GitHub Actions (disarankan — tidak butuh mesin lokal)

1. Buka **GitHub → Actions → DIDIQC Restore Database → Run workflow**.
2. Isi input:
   - `backup_file`: `latest` / tanggal `2026-10-21` / nama lengkap file.
   - `target`: `neon` | `staging` | `custom` | `insforge-production`.
   - `scope`: `app` (hanya tabel aplikasi — **default & direkomendasikan**) atau `full`.
   - `clean`: `yes` (replace penuh schema public tujuan) / `no`.
   - Selektif (opsional): `tables`, `data_only`, `truncate_tables`.
   - `restore_target_url`: URL tujuan bila target `staging`/`custom` dan belum diset di secrets.
   - `confirm`: wajib `RESTORE-PRODUCTION` hanya untuk target produksi.
3. Klik **Run workflow** dan pantau log. Laporan verifikasi tersimpan di
   `database_didiqc/status/restore-log/restore_….json`.

### 8.2 Via mesin/terminal (mis. dari CI runner atau admin workstation)

```bash
export INSFORGE_DATABASE_URL=... R2_ENDPOINT=... R2_ACCESS_KEY_ID=... \
       R2_SECRET_ACCESS_KEY=... R2_BUCKET=didikqc R2_PREFIX=database_didiqc

# Lihat daftar backup
bash scripts/backup/db-list-backups.sh

# Restore ke Neon (DR)
NEON_DATABASE_URL='postgresql://…' bash scripts/backup/db-restore.sh \
  --backup-file 2026-10-21 --target neon

# Restore ke staging (URL bebas)
RESTORE_TARGET_URL='postgresql://…' bash scripts/backup/db-restore.sh \
  --backup-file latest --target staging

# Restore selektif satu tabel
RESTORE_TARGET_URL='postgresql://…' bash scripts/backup/db-restore.sh \
  --backup-file latest --target custom --tables parameters --data-only --truncate parameters
```

### 8.3 Alur internal restore (kenapa aman)

1. Resolusi file backup dari R2 + verifikasi `sha256` + validasi arsip.
2. **Cek kompatibilitas** ke tujuan (versi PG, ekstensi, encoding) — gagal = berhenti
   sebelum menulis apa pun.
3. Guard produksi: konfirmasi + backup keselamatan (lihat §10).
4. Persiapan schema (`CREATE SCHEMA IF NOT EXISTS public`; bila `clean=yes`:
   `DROP SCHEMA public CASCADE` lalu buat ulang).
5. `pg_restore --use-list` dengan **TOC terfilter** + `--no-owner --no-privileges
   --no-tablespaces --exit-on-error -1` (atomik dalam satu transaksi — bila gagal,
   tujuan kembali ke kondisi semula).
6. **Verifikasi pasca-restore**: keberadaan semua tabel + row count tiap tabel
   dibanding snapshot `.meta.json` (baris kurang = GAGAL).
7. Laporan JSON diunggah ke `status/restore-log/`.

---

## 9. Restore ke Neon — Kompatibilitas & Penyesuaian

### 9.1 Kondisi sumber (InsForge produksi, terverifikasi)

| Item | Nilai |
|---|---|
| Versi PostgreSQL | **15.18** |
| Ekstensi terpasang | `http`, `pg_cron`, `pgcrypto`, `plpgsql`, `vector` (milik platform InsForge) |
| Tabel aplikasi DIDIQC | 41 tabel di schema **`public`** (Prisma) |
| Fungsi/trigger/RLS di `public` | 0 / 0 / 0 (bersih — semua 170 fungsi public adalah anggota ekstensi platform) |
| Tipe data khusus | Tidak ada (tanpa enum/JSONB khusus/vector column); kolom default tidak memakai fungsi ekstensi |

### 9.2 Penyesuaian yang dilakukan otomatis oleh script

| Perbedaan Neon | Penanganan |
|---|---|
| Tidak ada superuser | `pg_restore --no-owner --no-privileges --no-tablespaces` |
| Owner berbeda (`postgres` vs `neondb_owner`) | `--no-owner` → objek dimiliki role koneksi |
| Ekstensi `http`/`pg_cron`/`vector` tidak tersedia | `scope=app` meng-skip semua `CREATE EXTENSION`/`COMMENT ON EXTENSION` (tabel aplikasi memang tidak memakainya — diverifikasi) |
| Tabel platform InsForge (schema `auth`, `storage`, dll.) tidak relevan di Neon | `scope=app` hanya me-restore schema `public` |
| Endpoint pooler (PgBouncer) tidak cocok untuk pg_restore multi-koneksi | Guard menolak URL `-pooler.` → pakai endpoint langsung |
| Versi server lebih baru (PG 16/17) | Aman: dump dibuat `pg_dump` **v15** (pin `15.8.0`) — restore valid ke server 15/16/17. Sebaliknya (server tujuan lebih lama dari sumber) ditolak compat-check |
| ACL/GRANT role asing | `--no-privileges` |

### 9.3 Cara uji pertama ke Neon (wajib sebelum dipakai darurat)

1. Buat database Neon kosong (mis. `didiqc-dr`).
2. Copy connection string **langsung** (bukan pooler) → set secret `NEON_DATABASE_URL`.
3. Jalankan workflow **DIDIQC Restore Database** → `target=neon`, `scope=app`, `clean=yes`,
   `backup_file=<backup terbaru>`.
4. Verifikasi: log harus menampilkan 41 tabel `OK` + "RESTORE SELESAI & TERVERIFIKASI".
   Spot-check: `SELECT count(*) FROM inputqc;` (17.073 pada snapshot 2026-10-21),
   `SELECT count(*) FROM parameters;` (120).
5. Catat versi Neon Anda di dokumen ini (mis. PG 17.x) — kompatibilitas sudah
   ditangani script, namun angka versi berguna saat troubleshooting.

> **Status pengujian**: restore app-scope ke PostgreSQL non-superuser sudah diuji
> nyata (§13). Restore end-to-end ke Neon **belum** bisa diuji karena
> `NEON_DATABASE_URL` belum tersedia — sistem menunggu secret tersebut. Jangan
> mengandalkan Neon untuk DR sebelum uji §9.3 sukses.

---

## 10. Restore ke Produksi InsForge + Rollback

Restore penuh ke produksi **tidak pernah** berjalan tanpa sengaja:

1. **Konfirmasi ganda**: input workflow `confirm = RESTORE-PRODUCTION` **dan**
   env `RESTORE_CONFIRM_PRODUCTION=RESTORE-PRODUCTION` (divalidasi dua lapis,
   fail-fast di workflow dan di script).
2. **Backup keselamatan otomatis** kondisi produksi saat itu →
   `s3://didikqc/database_didiqc/pre-restore/pre_restore_….dump` (diunggah &
   diverifikasi dulu; **gagal = restore dibatalkan** — produksi tidak disentuh).
3. **Restore atomik** (`--exit-on-error -1`).
4. **Verifikasi row count** vs snapshot meta; gagal → instruksi rollback dicetak.
5. **Rollback** kapan pun:

```bash
# via GitHub Actions: DIDIQC Restore Database → target=insforge-production,
#                     backup_file=<file pre_restore terbaru>, scope=app, confirm=RESTORE-PRODUCTION
# atau via script:
RESTORE_CONFIRM_PRODUCTION=RESTORE-PRODUCTION bash scripts/backup/db-restore.sh --rollback
```

   `--rollback` otomatis memilih file pre-restore terbaru dan mengembalikan schema
   `public` ke kondisi sebelum restore.

Catatan produksi:

- Selama restore berjalan (±10–60 detik), aplikasi sesaat tidak bisa membaca data
  (`DROP SCHEMA` → `pg_restore`). Informasikan pengguna; lakukan di jam sepi.
- Setelah restore, semua user perlu login ulang (tabel `sessions` ikut diganti).
- Platform InsForge (schema `auth`, dsb.) **tidak** disentuh oleh `scope=app`;
  `scope=full` hanya untuk klon InsForge/inspeksi, bukan rutinitas.

---

## 11. Pemulihan Selektif

Untuk perbaikan data tanpa mengganti seluruh database:

```bash
# Data-only 2 tabel, kosongkan dulu isinya, struktur tak tersentuh
bash scripts/backup/db-restore.sh --backup-file 2026-10-21 --target custom \
  --tables "parameters,master_tea" --data-only --truncate "parameters,master_tea"
```

- `--tables` memfilter restore hanya ke tabel tsb (+ indeks/konstraint miliknya).
- `--data-only` tidak mengubah struktur; `--truncate` (default **RESTRICT**)
  mengosongkan tabel tujuan dulu — bila ada tabel dependen berisi data, truncate
  **ditolak** (mencegah penghapusan berantai tak disengaja).
- Untuk produksi, selektif tetap butuh `RESTORE_CONFIRM_PRODUCTION` dan wajib
  `--data-only` (struktur produksi tidak pernah diubah oleh jalur selektif).

---

## 12. Monitoring, Status & Notifikasi

- **Status tersimpan di R2** (dibaca panel admin):
  - `database_didiqc/status/backup-status.json` — backup terakhir (sukses/gagal, ukuran, checksum, jumlah tabel/baris).
  - `database_didiqc/status/restore-status.json` + `status/restore-log/restore_*.json` — laporan tiap restore.
- **Riwayat run**: tab Actions GitHub (hijau/merah per hari).
- **Notifikasi gagal**: set secret `BACKUP_ALERT_WEBHOOK` (Slack/Discord/generik) —
  sistem mengirim pesan saat backup/restore gagal.
- **Panel admin**: buka `<URL-aplikasi>/backup-admin.html` sebagai superadmin →
  status terakhir + daftar 15 backup + tombol unduh (tautan 15 menit) + panduan restore.
- **CLI**: `bash scripts/backup/db-list-backups.sh --all`.

---

## 13. Hasil Pengujian Nyata

Dijalankan pada 2026-10-21 (sandbox + database produksi InsForge + R2 nyata):

| # | Uji | Hasil |
|---|---|---|
| 1 | Konektivitas R2 (list bucket, tulis/baca/hapus object uji di `database_didiqc/`) | ✅ |
| 2 | **Backup pertama** end-to-end: pg_dump → unggah → head-object → unduh ulang → sha256 → validasi arsip → status | ✅ `didiqc_2026-10-21_145017.dump` (1,28 MB) |
| 3 | Retensi (1 file ≤ 15 → tidak ada yang dihapus; pola ketat hanya file harian) | ✅ |
| 4 | Compat-check: deteksi versi (15.18→15.8), encoding UTF8, ekstensi dump vs tujuan | ✅ |
| 5 | **Restore app-scope penuh** ke PostgreSQL 15 non-superuser (mensimulasikan Neon: owner berbeda, tanpa superuser) | ✅ 41 tabel, semua row count = snapshot (inputqc 17.073, parameters 120, users 10, historiqc 436, dst.) |
| 6 | Restore atomik: data-only tanpa filter menabrak data lama → **gagal bersih, tidak ada perubahan** (exit-on-error, single transaction) | ✅ |
| 7 | Restore selektif `--tables parameters,master_tea` ke DB kosong | ✅ 2 tabel dibuat, 120/6 baris terverifikasi |
| 8 | Restore selektif `--data-only --truncate` (RESTRICT) pada DB berisi | ✅ 120/6 baris, tabel lain tak tersentuh |
| 9 | **Guard produksi**: `--target insforge` tanpa `RESTORE_CONFIRM_PRODUCTION` → DITOLAK sebelum menulis apa pun | ✅ |
| 10 | `scope=full` ke server tanpa ekstensi platform → **diblokir compat-check** dengan panduan pakai `scope=app` | ✅ |

**Belum dapat diuji (menunggu akses, jujur dicatat):**

- Restore end-to-end ke **Neon** — butuh `NEON_DATABASE_URL` (§9.3 berisi langkah uji pertama).
- Restore penuh ke **produksi InsForge** — sengaja tidak dieksekusi demi keamanan
  (jalur konfirmasi + backup keselamatan terverifikasi guard-nya; komponen
  pg_dump/unggah/verifikasi identik dengan jalur backup yang sudah teruji).
- Workflow GitHub Actions end-to-end — baru aktif setelah push + secrets diset;
  jalankan "Run workflow" pertama (mode `backup`) untuk memverifikasi jalur CI.

---

## 14. Troubleshooting

| Gejala | Penyebab & Solusi |
|---|---|
| `NoSuchBucket` | Nama bucket salah — cek secret `R2_BUCKET` (harus `didikqc`). Jangan membuat bucket baru. |
| `401/403 SignatureDoesNotMatch` | `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` salah salin. |
| Backup gagal: `connection timed out` | Runner tidak dapat menjangkau `rz7b4fhh…insforge.app:5432` — cek status InsForge. |
| Restore ke Neon ditolak `-pooler` | Gunakan connection string endpoint **langsung** Neon (tanpa `-pooler.`). |
| `SCOPE=full membutuhkan ekstensi…` | Normal untuk target non-InsForge → pakai `scope=app`. Untuk klon InsForge, buat ekstensi dulu (`CREATE EXTENSION vector;` dst.) di tujuan. |
| Verifikasi restore gagal "baris HILANG" | Backup lebih baru daripada kondisi tujuan (mis. restore ke DB yang sedang ditulis) — ulangi dengan `clean=yes` atau berhentikan penulisan selama restore. |
| Retensi tidak menghapus file lama | File tidak cocok pola `didiqc_*.dump` (dibuat manual?) — pindahkan/hapus manual via R2 dashboard. |
| Panel admin "Environment R2 belum diset" | Set variabel R2 di Vercel lalu redeploy. |

---

*Sistem ini sengaja tidak menyentuh kode fitur DIDIQC yang sudah ada. Pertanyaan
implementasi rinci per skrip ada di komentar kepala setiap file `scripts/backup/*.sh`.*
