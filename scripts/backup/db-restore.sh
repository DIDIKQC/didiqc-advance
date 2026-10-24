#!/usr/bin/env bash
# ============================================================
# db-restore.sh — Restore backup DIDIQC ke database tujuan (InsForge/Neon/Staging)
#
# PILIHAN TUJUAN:
#   --target neon      → pakai $NEON_DATABASE_URL (default scope=app)
#   --target staging   → pakai $STAGING_DATABASE_URL atau $RESTORE_TARGET_URL
#   --target custom    → pakai $RESTORE_TARGET_URL
#   --target insforge  → PRODUKSI. Wajib RESTORE_CONFIRM_PRODUCTION=RESTORE-PRODUCTION
#                        dan otomatis membuat backup keselamatan dulu (pre-restore).
#
# PENGAMAN PRODUKSI (target=insforge atau URL == URL produksi):
#   1. Wajib env RESTORE_CONFIRM_PRODUCTION="RESTORE-PRODUCTION"
#   2. Otomatis backup kondisi terkini → s3://$R2_BUCKET/$R2_PREFIX/pre-restore/
#      (backup keselamatan TIDAK ikut retensi 15 hari)
#   3. Gagal membuat backup keselamatan → restore DIBATALKAN
#   4. Prosedur rollback dicetak di akhir log
#
# PENGAMAN NEON:
#   - URL Neon wajib endpoint LANGSUNG (bukan -pooler.) untuk pg_restore
#   - Verifikasi kompatibilitas versi/ekstensi sebelum menulis apa pun
#   - Restore default scope=app (hanya schema public = tabel aplikasi),
#     sehingga platform/tabel lain tidak tersentuh
#
# SCOPE:
#   app  → hanya objek schema public (tabel aplikasi DIDIQC) — untuk Neon/staging
#   full → seluruh isi dump (untuk klon InsForge/staging serupa)
#
# CONTOH:
#   bash db-restore.sh --backup-file 2026-10-21 --target neon
#   bash db-restore.sh --backup-file didiqc_2026-10-21_020000.dump --target staging
#   bash db-restore.sh --backup-file latest --target insforge   # + wajib confirm env
#   bash db-restore.sh --backup-file 2026-10-21 --target insforge --tables "parameters,master_tea" --data-only
#   bash db-restore.sh --rollback                               # kembalikan kondisi sebelum restore
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

BACKUP_FILE="latest"
TARGET=""
SCOPE=""
CLEAN="yes"
TABLES=""
DATA_ONLY=0
TRUNCATE_TABLES=""
ROLLBACK_MODE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --backup-file) shift; BACKUP_FILE="${1:-latest}" ;;
    --target)      shift; TARGET="${1:-}" ;;
    --scope)       shift; SCOPE="${1:-}" ;;
    --clean)       shift; CLEAN="${1:-yes}" ;;
    --tables)      shift; TABLES="${1:-}" ;;
    --data-only)   DATA_ONLY=1 ;;
    --truncate)    shift; TRUNCATE_TABLES="${1:-}" ;;
    --rollback)    ROLLBACK_MODE=1 ;;
    *) die "Argumen tidak dikenal: $1" ;;
  esac
  shift
done

require_tools pg_restore psql aws sha256sum
require_r2_env
aws_env
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-25}"

BACKUP_TMP_DIR="$(mktemp -d)"
trap cleanup_tmp EXIT
STAMP="$(TZ=$TZ_BACKUP date '+%Y-%m-%d_%H%M%S')"
START_EPOCH="$(date +%s)"

# ============================================================
# 0. MODE ROLLBACK — kembalikan kondisi dari backup keselamatan terbaru
# ============================================================
if [ "$ROLLBACK_MODE" -eq 1 ]; then
  log "=== MODE ROLLBACK: mencari backup keselamatan pre-restore terbaru ==="
  PRE_KEYS="$(r2_list_keys "$R2_PREFIX/pre-restore/" | grep -E "^$R2_PREFIX/pre-restore/pre_restore_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump$" | sort | sed '/^$/d')"
  [ -n "$PRE_KEYS" ] || die "Tidak ada backup keselamatan pre-restore di R2."
  LATEST_PRE="$(printf '%s\n' "$PRE_KEYS" | tail -1)"
  log "Backup keselamatan terbaru: $LATEST_PRE"
  # Paksa mode produksi (rollback selalu ke database yang diselamatkan)
  TARGET="insforge"
  SCOPE="app"
  BACKUP_FILE="$(basename "$LATEST_PRE")"
  IS_PRE_RESTORE=1
else
  IS_PRE_RESTORE=0
fi

# ============================================================
# 1. Resolusi URL tujuan + pengaman produksi
# ============================================================
[ -n "$TARGET" ] || die "Wajib --target (neon|staging|custom|insforge). Lihat docs/BACKUP-RESTORE.md."
case "$TARGET" in
  neon)     [ -n "${NEON_DATABASE_URL:-}" ]     || die "NEON_DATABASE_URL belum diset (GitHub Secrets / environment)."
            TARGET_URL="$NEON_DATABASE_URL";     DEFAULT_SCOPE="app" ;;
  staging)  TARGET_URL="${STAGING_DATABASE_URL:-${RESTORE_TARGET_URL:-}}"
            [ -n "$TARGET_URL" ] || die "Target staging: set STAGING_DATABASE_URL atau RESTORE_TARGET_URL."
            DEFAULT_SCOPE="app" ;;
  custom)   TARGET_URL="${RESTORE_TARGET_URL:-}"
            [ -n "$TARGET_URL" ] || die "Target custom: set RESTORE_TARGET_URL."
            DEFAULT_SCOPE="app" ;;
  insforge) [ -n "${INSFORGE_DATABASE_URL:-}" ] || die "INSFORGE_DATABASE_URL belum diset."
            TARGET_URL="$INSFORGE_DATABASE_URL"; DEFAULT_SCOPE="full" ;;
  *) die "Target tidak dikenal: $TARGET (pilih: neon|staging|custom|insforge)" ;;
esac
SCOPE="${SCOPE:-$DEFAULT_SCOPE}"
case "$SCOPE" in app|full) ;; *) die "Scope tidak dikenal: $SCOPE (pilih: app|full)" ;; esac

# Normalisasi URL untuk deteksi produksi (buang query string)
norm_url() { printf '%s' "$1" | sed 's/?.*//' | sed 's/\/$//'; }
PROD_BASE="$(norm_url "${INSFORGE_DATABASE_URL:-__none__}")"
TARGET_BASE="$(norm_url "$TARGET_URL")"
IS_PRODUCTION=0
if [ "$TARGET" = "insforge" ] || { [ "$PROD_BASE" != "__none__" ] && [ "$TARGET_BASE" = "$PROD_BASE" ]; }; then
  IS_PRODUCTION=1
fi

if [ "$IS_PRODUCTION" -eq 1 ]; then
  echo "================================================================"
  echo "  PERINGATAN: TUJUAN = DATABASE PRODUKSI INSFORGE"
  echo "  Restore akan MENGGANTIKAN data produksi DIDIQC."
  echo "================================================================"
  if [ "${RESTORE_CONFIRM_PRODUCTION:-}" != "RESTORE-PRODUCTION" ]; then
    die "DITOLAK: restore ke produksi wajib env RESTORE_CONFIRM_PRODUCTION=\"RESTORE-PRODUCTION\". Lihat docs/BACKUP-RESTORE.md §Restore Produksi."
  fi
  [ "$SCOPE" = "full" ] || [ -n "$TABLES" ] || die "Target produksi: gunakan --scope full (restore penuh) atau --tables (selektif)."
  if [ -n "$TABLES" ] && [ "$DATA_ONLY" -eq 0 ]; then
    die "Restore selektif ke produksi wajib --data-only (skema produksi tidak diubah)."
  fi
fi

# Pengaman Neon
if printf '%s' "$TARGET_BASE" | grep -q "neon.tech"; then
  if printf '%s' "$TARGET_URL" | grep -q -- "-pooler\."; then
    [ "${ALLOW_POOLER:-0}" = "1" ] || die "URL Neon memakai endpoint POOLER (-pooler). pg_restore membutuhkan endpoint LANGSUNG (direct). Ganti URL atau set ALLOW_POOLER=1 (tidak disarankan)."
  fi
fi

# ============================================================
# 2. Backup keselamatan kondisi terkini (hanya untuk produksi)
# ============================================================
ROLLBACK_FILE=""
if [ "$IS_PRODUCTION" -eq 1 ]; then
  log "Membuat BACKUP KESELAMATAN kondisi produksi saat ini (pre-restore)..."
  PRE_BASE="pre_restore_${STAMP}.dump"
  PRE_LOCAL="$BACKUP_TMP_DIR/$PRE_BASE"
  pg_dump --format=custom --no-owner --file "$PRE_LOCAL" "$TARGET_URL" \
    || { notify_failure "DIDIQC restore DIBATALKAN: gagal backup keselamatan produksi."; die "Gagal backup keselamatan — restore produksi DIBATALKAN (tidak ada perubahan yang dilakukan)."; }
  verify_dump_file "$PRE_LOCAL" || { notify_failure "DIDIQC restore DIBATALKAN: backup keselamatan tidak valid."; die "Backup keselamatan tidak valid — restore produksi DIBATALKAN."; }
  sha256sum "$PRE_LOCAL" | awk '{print $1}' > "$BACKUP_TMP_DIR/$PRE_BASE.sha256"
  r2s3 cp "$PRE_LOCAL"                           "s3://$R2_BUCKET/$R2_PREFIX/pre-restore/$PRE_BASE"        || { notify_failure "DIDIQC restore DIBATALKAN: gagal upload backup keselamatan."; die "Gagal upload backup keselamatan ke R2 — restore produksi DIBATALKAN."; }
  r2s3 cp "$BACKUP_TMP_DIR/$PRE_BASE.sha256"     "s3://$R2_BUCKET/$R2_PREFIX/pre-restore/$PRE_BASE.sha256" >/dev/null || warn "Upload sha256 backup keselamatan gagal (non-fatal)."
  REMOTE_PRE_SIZE="$(r2_head_size "$R2_PREFIX/pre-restore/$PRE_BASE")"
  [ "$REMOTE_PRE_SIZE" = "$(wc -c < "$PRE_LOCAL" | tr -d ' ')" ] || { notify_failure "DIDIQC restore DIBATALKAN: verifikasi backup keselamatan gagal."; die "Verifikasi backup keselamatan gagal — restore produksi DIBATALKAN."; }
  ROLLBACK_FILE="$PRE_BASE"
  log "Backup keselamatan OK & terverifikasi: s3://$R2_BUCKET/$R2_PREFIX/pre-restore/$PRE_BASE"
fi

# ============================================================
# 3. Unduh & verifikasi file backup dari R2
# ============================================================
log "Mencari file backup: $BACKUP_FILE"
ALL_KEYS="$(r2_list_keys "$R2_PREFIX/")" || die "Gagal list R2."
RESOLVED_KEY=""
case "$BACKUP_FILE" in
  latest)
    RESOLVED_KEY="$(printf '%s\n' "$ALL_KEYS" | grep -E "^$R2_PREFIX/didiqc_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump$" | sort | tail -1)" ;;
  didiqc_*)
    RESOLVED_KEY="$(printf '%s\n' "$ALL_KEYS" | grep -Fx "$R2_PREFIX/$BACKUP_FILE")" ;;
  *)
    # Tanggal / prefix, contoh: 2026-10-21 → ambil backup TERBARU pada tanggal tsb
    RESOLVED_KEY="$(printf '%s\n' "$ALL_KEYS" | grep -E "^$R2_PREFIX/didiqc_${BACKUP_FILE}_[0-9]{6}\.dump$" | sort | tail -1)" ;;
esac
[ -n "$RESOLVED_KEY" ] || die "File backup tidak ditemukan di R2 untuk '$BACKUP_FILE'. Gunakan scripts/backup/db-list-backups.sh untuk melihat daftar."
BASE_NAME="$(basename "$RESOLVED_KEY")"
log "File terpilih: $RESOLVED_KEY"

LOCAL_DUMP="$BACKUP_TMP_DIR/$BASE_NAME"
r2s3 cp "s3://$R2_BUCKET/$RESOLVED_KEY" "$LOCAL_DUMP" >/dev/null || die "Gagal mengunduh $RESOLVED_KEY dari R2."

# Verifikasi checksum bila sidecar tersedia
r2s3 cp "s3://$R2_BUCKET/$R2_PREFIX/$BASE_NAME.sha256" "$BACKUP_TMP_DIR/$BASE_NAME.sha256" >/dev/null 2>&1 \
  && { SHA_EXPECTED="$(cat "$BACKUP_TMP_DIR/$BASE_NAME.sha256")"; \
       SHA_ACTUAL="$(sha256sum "$LOCAL_DUMP" | awk '{print $1}')"; \
       [ "$SHA_EXPECTED" = "$SHA_ACTUAL" ] || die "sha256 tidak cocok — file di R2 korup? ($BASE_NAME)"; \
       log "Checksum sha256 cocok."; } \
  || warn "Sidecar .sha256 tidak ditemukan — lewati cek checksum."

# Verifikasi arsip + meta row count snapshot
verify_dump_file "$LOCAL_DUMP" || die "File bukan arsip pg_restore yang valid: $BASE_NAME"
META_LOCAL="$BACKUP_TMP_DIR/$BASE_NAME.meta.json"
HAVE_META=0
r2s3 cp "s3://$R2_BUCKET/$R2_PREFIX/$BASE_NAME.meta.json" "$META_LOCAL" >/dev/null 2>&1 && HAVE_META=1
log "Arsip valid (dumped-from=$DUMP_SOURCE_VERSION, TABLE_DATA=$TABLE_DATA_COUNT)."

# Ambil snapshot row count dari meta (untuk verifikasi pasca-restore)
COUNTS_FILE=""
if [ "$HAVE_META" -eq 1 ]; then
  COUNTS_FILE="$BACKUP_TMP_DIR/counts.txt"
  # Ambil pasangan "tabel": jumlah di dalam blok "tableCounts": { ... }
  sed -n '/"tableCounts"/,/^[[:space:]]*}[[:space:]]*,\{0,1\}[[:space:]]*$/ s/.*"\([^"]*\)": *\([0-9][0-9]*\).*/\1\t\2/p' "$META_LOCAL" > "$COUNTS_FILE" || COUNTS_FILE=""
  [ -s "$COUNTS_FILE" ] || { COUNTS_FILE=""; warn "Snapshot row count di meta.json tidak terbaca — verifikasi hanya cek keberadaan tabel."; }
fi

# ============================================================
# 4. Cek kompatibilitas dengan tujuan
# ============================================================
if [ "$IS_PRODUCTION" -eq 1 ]; then
  unset COMPAT_OVERRIDE   # produksi tidak boleh bypass
fi
bash "$SCRIPT_DIR/db-compat-check.sh" --dump "$LOCAL_DUMP" --target-url "$TARGET_URL" --scope "$SCOPE" --label "$TARGET" \
  || { notify_failure "DIDIQC restore DIBATALKAN: cek kompatibilitas gagal ($TARGET)."; die "Cek kompatibilitas gagal — tidak ada perubahan di tujuan. (Bypass sengaja: COMPAT_OVERRIDE=1, hanya untuk staging/custom.)"; }

# ============================================================
# 5. Siapkan schema & filter TOC
# ============================================================
log "Menyiapkan schema public di tujuan..."
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -c 'CREATE SCHEMA IF NOT EXISTS public;' >/dev/null \
  || { notify_failure "DIDIQC restore DIBATALKAN: gagal menyiapkan schema tujuan."; die "Gagal CREATE SCHEMA public di tujuan — tidak ada perubahan."; }

if [ "$CLEAN" = "yes" ] && [ "$DATA_ONLY" -eq 0 ]; then
  log "CLEAN=yes: DROP SCHEMA public CASCADE lalu buat ulang (data lama di tujuan diganti)."
  [ "$IS_PRODUCTION" -eq 1 ] && log "PRODUKSI: menghapus schema public produksi (rollback tersedia: $ROLLBACK_FILE)."
  psql "$TARGET_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null \
    || { notify_failure "DIDIQC restore GAGAL saat DROP/CREATE SCHEMA tujuan."; die "Gagal DROP/CREATE SCHEMA di tujuan."; }
fi

log "Membangun TOC terfilter (scope=$SCOPE)..."
FULL_TOC="$BACKUP_TMP_DIR/toc-full.txt"
FILTERED_TOC="$BACKUP_TMP_DIR/toc-filtered.txt"
pg_restore --list "$LOCAL_DUMP" > "$FULL_TOC" || die "Gagal membaca TOC dump."

# Validasi nama tabel selektif
TABLES_REGEX=""
if [ -n "$TABLES" ]; then
  IFS=',' read -r -a TBL_ARR <<< "$TABLES"
  for t in "${TBL_ARR[@]}"; do
    t="$(printf '%s' "$t" | tr -d ' ')"
    printf '%s' "$t" | grep -qE '^[a-zA-Z0-9_]+$' || die "Nama tabel tidak valid: $t"
    [ -n "$TABLES_REGEX" ] && TABLES_REGEX="$TABLES_REGEX|"
    TABLES_REGEX="$TABLES_REGEX$t"
  done
  [ "$IS_PRODUCTION" -eq 1 ] && [ "$DATA_ONLY" -eq 0 ] && die "Restore selektif produksi wajib --data-only."
fi

if [ "$SCOPE" = "app" ]; then
  # Allow-list ketat: hanya objek tabel/urutan schema public milik aplikasi
  # Format baris TOC pg15:  <id>; <cat1> <cat2> TYPE schema name [extra] [owner]
  if [ -n "$TABLES_REGEX" ]; then
    grep -E '^[0-9]+; [0-9]+ [0-9]+ (TABLE|TABLE DATA|SEQUENCE|SEQUENCE SET|INDEX|CONSTRAINT|FK CONSTRAINT) public ('"$TABLES_REGEX"') ' "$FULL_TOC" > "$FILTERED_TOC" || true
  else
    grep -E '^[0-9]+; [0-9]+ [0-9]+ (TABLE|TABLE DATA|SEQUENCE|SEQUENCE SET|INDEX|CONSTRAINT|FK CONSTRAINT) public ' "$FULL_TOC" > "$FILTERED_TOC" || true
  fi
else
  # Full: buang entri ekstensi & komentar ekstensi (tercipta di tujuan/berpotensi
  # tidak tersedia); ACL tetap disertakan namun di-skip via --no-privileges
  grep -vE '^[0-9]+; [0-9]+ [0-9]+ (EXTENSION|COMMENT - EXTENSION) ' "$FULL_TOC" > "$FILTERED_TOC" || true
fi
N_SEL="$(wc -l < "$FILTERED_TOC" | tr -d ' ')"
[ "$N_SEL" -gt 0 ] || die "TOC terfilter kosong (scope=$SCOPE, tables=$TABLES) — tidak ada yang bisa direstore."
log "Entri TOC terpilih: $N_SEL"

# ============================================================
# 6. Truncate selektif (opsional, untuk --data-only)
# ============================================================
if [ -n "$TRUNCATE_TABLES" ] && [ "$DATA_ONLY" -eq 1 ]; then
  TRUNC_SQL="TRUNCATE TABLE "
  IFS=',' read -r -a TR_ARR <<< "$TRUNCATE_TABLES"
  first=1
  for t in "${TR_ARR[@]}"; do
    t="$(printf '%s' "$t" | tr -d ' ')"
    printf '%s' "$t" | grep -qE '^[a-zA-Z0-9_]+$' || die "Nama tabel truncate tidak valid: $t"
    [ $first -eq 1 ] && first=0 || TRUNC_SQL="$TRUNC_SQL, "
    TRUNC_SQL="$TRUNC_SQL public.\"$t\""
  done
  log "Truncate tabel tujuan: $TRUNCATE_TABLES (RESTRICT — aman, gagal bila ada tabel dependen)"
  psql "$TARGET_URL" -v ON_ERROR_STOP=1 -c "$TRUNC_SQL RESTRICT;" >/dev/null \
    || { notify_failure "DIDIQC restore DIBATALKAN: gagal truncate tabel tujuan (ada dependensi?)."; die "Gagal TRUNCATE di tujuan (RESTRICT mencegah truncate berantai). Sertakan tabel dependen secara eksplisit bila memang dimaksudkan."; }
fi

# ============================================================
# 7. pg_restore (atomik dalam 1 transaksi, exit-on-error)
# ============================================================
log "Menjalankan pg_restore ke $(mask_url "$TARGET_URL") ..."
RESTORE_ARGS=(--no-owner --no-privileges --no-tablespaces
              --exit-on-error --use-list "$FILTERED_TOC")
if [ "$DATA_ONLY" -eq 1 ]; then
  RESTORE_ARGS+=(--data-only)           # data-only tidak boleh digabung --clean
else
  RESTORE_ARGS+=(--clean --if-exists)   # ganti objek yang direstore
fi
if [ -n "${RESTORE_JOBS:-}" ] && [ "${RESTORE_JOBS}" -gt 1 ] && [ "$DATA_ONLY" -eq 0 ]; then
  log "Paralel: RESTORE_JOBS=$RESTORE_JOBS (non-atomik)"
  pg_restore -j "$RESTORE_JOBS" "${RESTORE_ARGS[@]}" -d "$TARGET_URL" "$LOCAL_DUMP" 2> "$BACKUP_TMP_DIR/restore.err"
else
  RESTORE_ARGS+=(-1)   # single transaction = atomik
  pg_restore "${RESTORE_ARGS[@]}" -d "$TARGET_URL" "$LOCAL_DUMP" 2> "$BACKUP_TMP_DIR/restore.err"
fi
RESTORE_EXIT=$?
if [ $RESTORE_EXIT -ne 0 ]; then
  ERRMSG="pg_restore gagal (exit=$RESTORE_EXIT): $(tail -5 "$BACKUP_TMP_DIR/restore.err" | tr '\n' ' ')"
  log "$ERRMSG"
  notify_failure "DIDIQC restore ke $TARGET GAGAL: $ERRMSG"
  [ "$IS_PRODUCTION" -eq 1 ] && log "ROLLOUT GAGAL DI PRODUKSI — jalankan ROLLBACK: bash scripts/backup/db-restore.sh --rollback (dengan RESTORE_CONFIRM_PRODUCTION=RESTORE-PRODUCTION)"
  die "$ERRMSG"
fi
log "pg_restore selesai tanpa error (atomik, exit-on-error)."

# ============================================================
# 8. Verifikasi pasca-restore
# ============================================================
log "=== VERIFIKASI PASCA-RESTORE ==="
VERIFY_OK=1
VERIFY_REPORT="$BACKUP_TMP_DIR/verify-report.txt"
: > "$VERIFY_REPORT"

EXPECTED_TABLES="$(awk '$4=="TABLE" && $5=="public" {gsub(/"/,"",$6); print $6}' "$FILTERED_TOC")"
N_EXPECTED="$(printf '%s\n' "$EXPECTED_TABLES" | sed '/^$/d' | wc -l | tr -d ' ')"
log "Tabel diharapkan: $N_EXPECTED"

MISSING_TABLES=""
while IFS= read -r t; do
  [ -z "$t" ] && continue
  ACTUAL="$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM public.\"$t\";" 2>/dev/null || echo 'MISSING')"
  SNAPSHOT=""
  if [ -n "$COUNTS_FILE" ]; then
    SNAPSHOT="$(awk -F'\t' -v tb="$t" '$1==tb {print $2}' "$COUNTS_FILE")"
  fi
  if [ "$ACTUAL" = "MISSING" ]; then
    MISSING_TABLES="$MISSING_TABLES $t"
    VERIFY_OK=0
    printf 'FAIL  %-28s tabel tidak ada di tujuan\n' "$t" >> "$VERIFY_REPORT"
  elif [ -n "$SNAPSHOT" ] && [ "$ACTUAL" -lt "$SNAPSHOT" ]; then
    VERIFY_OK=0
    printf 'FAIL  %-28s tujuan=%s snapshot=%s (baris HILANG)\n' "$t" "$ACTUAL" "$SNAPSHOT" >> "$VERIFY_REPORT"
  else
    printf 'OK    %-28s tujuan=%s%s\n' "$t" "$ACTUAL" "${SNAPSHOT:+ (snapshot=$SNAPSHOT)}" >> "$VERIFY_REPORT"
  fi
done <<< "$EXPECTED_TABLES"

cat "$VERIFY_REPORT"
[ -n "$MISSING_TABLES" ] && log "Tabel hilang:$MISSING_TABLES"

if [ "$VERIFY_OK" -ne 1 ]; then
  ERRMSG="Verifikasi pasca-restore GAGAL (lihat laporan di atas)."
  notify_failure "DIDIQC restore ke $TARGET: $ERRMSG"
  [ "$IS_PRODUCTION" -eq 1 ] && log "JALANKAN ROLLBACK: bash scripts/backup/db-restore.sh --rollback (dengan RESTORE_CONFIRM_PRODUCTION=RESTORE-PRODUCTION)"
  die "$ERRMSG"
fi
log "Verifikasi row count: SEMUA COCOK / AMAN."

# ------------------------------------------------------------
# 9. Status restore → R2 (monitoring)
# ------------------------------------------------------------
DURATION=$(( $(date +%s) - START_EPOCH ))
RESTORE_REPORT_KEY="$R2_PREFIX/status/restore-log/restore_${STAMP}.json"
{
  printf '{\n'
  printf '  "app": "didiqc",\n'
  printf '  "kind": "restore",\n'
  printf '  "status": "success",\n'
  printf '  "atWIB": "%s",\n' "$(TZ=$TZ_BACKUP date '+%F %T')"
  printf '  "atUTC": "%s",\n' "$(date -u '+%F %T')"
  printf '  "sourceFile": "%s",\n' "$(json_escape "$BASE_NAME")"
  printf '  "targetLabel": "%s",\n' "$(json_escape "$TARGET")"
  printf '  "scope": "%s",\n' "$SCOPE"
  printf '  "dataOnly": %s,\n' "$DATA_ONLY"
  printf '  "tables": %s,\n' "${TABLES:+\"$(json_escape "$TABLES")\"}${TABLES:-null}"
  printf '  "expectedTables": %s,\n' "$N_EXPECTED"
  printf '  "isProduction": %s,\n' "$IS_PRODUCTION"
  printf '  "preRestoreSafetyBackup": %s,\n' "${ROLLBACK_FILE:+\"$ROLLBACK_FILE\"}${ROLLBACK_FILE:-null}"
  printf '  "durationSeconds": %s\n' "$DURATION"
  printf '}\n'
} > "$BACKUP_TMP_DIR/restore-status.json"
r2s3 cp "$BACKUP_TMP_DIR/restore-status.json" "s3://$R2_BUCKET/$RESTORE_REPORT_KEY" >/dev/null || warn "Gagal upload laporan restore ke R2 (non-fatal)."

# Status ringkas terakhir
r2s3 cp "$BACKUP_TMP_DIR/restore-status.json" "s3://$R2_BUCKET/$R2_PREFIX/status/restore-status.json" >/dev/null || true

echo "=============================================================="
echo "  RESTORE SELESAI & TERVERIFIKASI ✓"
echo "  Sumber  : $BASE_NAME"
echo "  Tujuan  : $TARGET (scope=$SCOPE)"
echo "  Durasi  : ${DURATION}s"
if [ "$IS_PRODUCTION" -eq 1 ]; then
echo "  ROLLBACK (bila diperlukan):"
echo "    RESTORE_CONFIRM_PRODUCTION=RESTORE-PRODUCTION bash scripts/backup/db-restore.sh --rollback"
echo "    (mengembalikan dari: $ROLLBACK_FILE)"
fi
echo "=============================================================="
exit 0
