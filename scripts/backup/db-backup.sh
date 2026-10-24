#!/usr/bin/env bash
# ============================================================
# db-backup.sh — Backup penuh database InsForge PostgreSQL DIDIQC ke Cloudflare R2
#
# Proses:
#   1. Snapshot row count semua tabel public (untuk verifikasi restore)
#   2. pg_dump format custom (.dump) — kompatibel pg_restore
#   3. Verifikasi lokal (pg_restore --list)
#   4. Upload ke R2: s3://$R2_BUCKET/$R2_PREFIX/didiqc_<WIB>.dump (+ .sha256 + .meta.json)
#   5. Verifikasi upload: head-object → download balik → cek sha256 → cek arsip
#   6. Tulis status ke s3://$R2_BUCKET/$R2_PREFIX/status/backup-status.json
#   7. Retensi: hapus lama (max RETENTION_KEEP) HANYA jika langkah 4-5 sukses
#   8. Notifikasi webhook bila gagal (opsional)
#
# Penggunaan:
#   bash db-backup.sh [--skip-retention] [--retention N]
#
# Environment wajib: INSFORGE_DATABASE_URL, R2_ENDPOINT,
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

SKIP_RETENTION=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-retention) SKIP_RETENTION=1 ;;
    --retention)      shift; RETENTION_KEEP="${1:-15}" ;;
    *) die "Argumen tidak dikenal: $1" ;;
  esac
  shift
done

require_tools pg_dump pg_restore psql aws sha256sum curl
require_r2_env
[ -z "${INSFORGE_DATABASE_URL:-}" ] && die "INSFORGE_DATABASE_URL belum diset."
aws_env

BACKUP_TMP_DIR="$(mktemp -d)"
trap cleanup_tmp EXIT

START_EPOCH="$(date +%s)"
STAMP="$(TZ=$TZ_BACKUP date '+%Y-%m-%d_%H%M%S')"
DATE_WIB="$(TZ=$TZ_BACKUP date '+%F %T')"
DATE_UTC="$(date -u '+%F %T')"
FILE_BASE="didiqc_${STAMP}.dump"
LOCAL_DUMP="$BACKUP_TMP_DIR/$FILE_BASE"
STATUS_KEY="$R2_PREFIX/status/backup-status.json"
STATUS_LOCAL="$BACKUP_TMP_DIR/backup-status.json"

log "=== BACKUP DIDIQC dimulai: $FILE_BASE ==="

# ------------------------------------------------------------
# 1. Snapshot row count per tabel public (snapshot verifikasi)
# ------------------------------------------------------------
log "Mengambil daftar tabel & row count (snapshot)..."
TABLE_NAMES="$(psql "$INSFORGE_DATABASE_URL" -tAc \
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" 2>&1)" \
  || die "Gagal mengambil daftar tabel: $TABLE_NAMES"
TABLE_NAMES="$(printf '%s\n' "$TABLE_NAMES" | sed '/^$/d')"
[ -n "$TABLE_NAMES" ] || die "Tidak ada tabel public ditemukan."

TABLE_COUNTS="$BACKUP_TMP_DIR/table-counts.txt"
: > "$TABLE_COUNTS"
TOTAL_ROWS=0
for t in $TABLE_NAMES; do
  c="$(psql "$INSFORGE_DATABASE_URL" -tAc "SELECT count(*) FROM public.\"$t\";" 2>/dev/null || echo '?')"
  printf '%s\t%s\n' "$t" "$c" >> "$TABLE_COUNTS"
  case "$c" in (*[!0-9]*|"") ;; (*) TOTAL_ROWS=$((TOTAL_ROWS + c)) ;; esac
done
N_TABLES="$(printf '%s\n' "$TABLE_NAMES" | wc -l | tr -d ' ')"
log "Tabel public: $N_TABLES, total baris (snapshot): $TOTAL_ROWS"

# ------------------------------------------------------------
# 2. pg_dump custom format
# ------------------------------------------------------------
log "Menjalankan pg_dump (custom format)..."
PGDUMP_ERR="$BACKUP_TMP_DIR/pgdump.err"
if ! pg_dump --format=custom --no-owner --file "$LOCAL_DUMP" \
      "$INSFORGE_DATABASE_URL" 2> "$PGDUMP_ERR"; then
  ERRMSG="pg_dump gagal: $(tail -3 "$PGDUMP_ERR" | tr '\n' ' ')"
  log "$ERRMSG"
  cat > "$STATUS_LOCAL" <<EOF
{"app":"didiqc","kind":"backup","lastRunStatus":"failed","lastError":"$(json_escape "$ERRMSG")","lastRunAt":"$DATE_WIB","lastRunAtUTC":"$DATE_UTC"}
EOF
  r2s3 cp "$STATUS_LOCAL" "s3://$R2_BUCKET/$STATUS_KEY" >/dev/null 2>&1 || true
  notify_failure "DIDIQC backup GAGAL: $ERRMSG"
  die "$ERRMSG"
fi
SIZE_BYTES="$(wc -c < "$LOCAL_DUMP" | tr -d ' ')"
log "pg_dump selesai: $SIZE_BYTES bytes"

# ------------------------------------------------------------
# 3. Verifikasi arsip lokal
# ------------------------------------------------------------
log "Verifikasi arsip lokal (pg_restore --list)..."
verify_dump_file "$LOCAL_DUMP" || { ERRMSG="File dump lokal tidak valid"; notify_failure "DIDIQC backup GAGAL: $ERRMSG"; die "$ERRMSG"; }
log "Arsip valid. TABLE=$TABLE_LIST_COUNT TABLE_DATA=$TABLE_DATA_COUNT, dumped-from=$DUMP_SOURCE_VERSION, dumped-by=$DUMP_CLIENT_VERSION"

# ------------------------------------------------------------
# 4. Checksum + metadata
# ------------------------------------------------------------
sha256sum "$LOCAL_DUMP" | awk '{print $1}' > "$BACKUP_TMP_DIR/$FILE_BASE.sha256"
SHA256="$(cat "$BACKUP_TMP_DIR/$FILE_BASE.sha256")"
META_LOCAL="$BACKUP_TMP_DIR/$FILE_BASE.meta.json"
{
  printf '{\n'
  printf '  "app": "didiqc",\n'
  printf '  "file": "%s",\n' "$FILE_BASE"
  printf '  "createdAtWIB": "%s",\n' "$DATE_WIB"
  printf '  "createdAtUTC": "%s",\n' "$DATE_UTC"
  printf '  "format": "pg_dump custom (pg_restore compatible)",\n'
  printf '  "sizeBytes": %s,\n' "$SIZE_BYTES"
  printf '  "sha256": "%s",\n' "$SHA256"
  printf '  "pgDumpClientVersion": "%s",\n' "$(pg_dump --version | grep -oE '[0-9]+\.[0-9]+')"
  printf '  "sourceServerVersion": "%s",\n' "$DUMP_SOURCE_VERSION"
  printf '  "publicTables": %s,\n' "$N_TABLES"
  printf '  "totalRowsSnapshot": %s,\n' "$TOTAL_ROWS"
  printf '  "tableCounts": {\n'
  first=1
  while IFS="$(printf '\t')" read -r t c; do
    [ $first -eq 1 ] && first=0 || printf ',\n'
    printf '    "%s": %s' "$(json_escape "$t")" "${c:-null}"
  done < "$TABLE_COUNTS"
  printf '\n  }\n}\n'
} > "$META_LOCAL"

# ------------------------------------------------------------
# 5. Upload ke R2 (prefix tetap: $R2_PREFIX/)
# ------------------------------------------------------------
log "Upload ke s3://$R2_BUCKET/$R2_PREFIX/ ..."
r2s3 cp "$LOCAL_DUMP"                          "s3://$R2_BUCKET/$R2_PREFIX/$FILE_BASE"         || { ERRMSG="Upload .dump gagal"; notify_failure "DIDIQC backup GAGAL: $ERRMSG"; die "$ERRMSG"; }
r2s3 cp "$BACKUP_TMP_DIR/$FILE_BASE.sha256"    "s3://$R2_BUCKET/$R2_PREFIX/$FILE_BASE.sha256"  >/dev/null || warn "Upload .sha256 gagal (non-fatal)"
r2s3 cp "$META_LOCAL"                          "s3://$R2_BUCKET/$R2_PREFIX/$FILE_BASE.meta.json" >/dev/null || warn "Upload .meta.json gagal (non-fatal)"

# ------------------------------------------------------------
# 6. Verifikasi upload: ada + ukuran cocok + download balik + sha256 cocok + arsip valid
# ------------------------------------------------------------
log "Verifikasi file di R2 (head-object + download balik + sha256)..."
REMOTE_SIZE="$(r2_head_size "$R2_PREFIX/$FILE_BASE")"
if [ -z "$REMOTE_SIZE" ] || [ "$REMOTE_SIZE" != "$SIZE_BYTES" ]; then
  ERRMSG="Verifikasi R2 gagal: ukuran remote ($REMOTE_SIZE) != lokal ($SIZE_BYTES)"
  notify_failure "DIDIQC backup GAGAL: $ERRMSG"
  die "$ERRMSG"
fi
REMOTE_DUMP="$BACKUP_TMP_DIR/verify-$FILE_BASE"
r2s3 cp "s3://$R2_BUCKET/$R2_PREFIX/$FILE_BASE" "$REMOTE_DUMP" >/dev/null || { ERRMSG="Download balik dari R2 gagal"; notify_failure "DIDIQC backup GAGAL: $ERRMSG"; die "$ERRMSG"; }
SHA_REMOTE="$(sha256sum "$REMOTE_DUMP" | awk '{print $1}')"
if [ "$SHA_REMOTE" != "$SHA256" ]; then
  ERRMSG="Verifikasi R2 gagal: sha256 remote != lokal"
  notify_failure "DIDIQC backup GAGAL: $ERRMSG"
  die "$ERRMSG"
fi
verify_dump_file "$REMOTE_DUMP" || { ERRMSG="File di R2 bukan arsip pg_restore yang valid"; notify_failure "DIDIQC backup GAGAL: $ERRMSG"; die "$ERRMSG"; }
log "VERIFIKASI R2 BERHASIL: file utuh & arsip PostgreSQL valid."

# ------------------------------------------------------------
# 7. Status file (sukses)
# ------------------------------------------------------------
DURATION=$(( $(date +%s) - START_EPOCH ))
{
  printf '{\n'
  printf '  "app": "didiqc",\n'
  printf '  "kind": "backup",\n'
  printf '  "lastRunStatus": "success",\n'
  printf '  "lastRunAt": "%s",\n' "$DATE_WIB"
  printf '  "lastRunAtUTC": "%s",\n' "$DATE_UTC"
  printf '  "lastRunSource": "%s",\n' "$(json_escape "${BACKUP_SOURCE_LABEL:-github-actions}")"
  printf '  "lastError": null,\n'
  printf '  "lastBackup": {\n'
  printf '    "file": "%s",\n' "$FILE_BASE"
  printf '    "sizeBytes": %s,\n' "$SIZE_BYTES"
  printf '    "sha256": "%s",\n' "$SHA256"
  printf '    "verified": true,\n'
  printf '    "publicTables": %s,\n' "$N_TABLES"
  printf '    "totalRowsSnapshot": %s,\n' "$TOTAL_ROWS"
  printf '    "sourceServerVersion": "%s",\n' "$DUMP_SOURCE_VERSION"
  printf '    "durationSeconds": %s\n' "$DURATION"
  printf '  },\n'
  printf '  "retentionKeep": %s\n' "$RETENTION_KEEP"
  printf '}\n'
} > "$STATUS_LOCAL"
r2s3 cp "$STATUS_LOCAL" "s3://$R2_BUCKET/$STATUS_KEY" >/dev/null
log "Status tersimpan: s3://$R2_BUCKET/$STATUS_KEY"

# ------------------------------------------------------------
# 8. Retensi — HANYA dijalankan setelah backup terverifikasi
# ------------------------------------------------------------
if [ "$SKIP_RETENTION" -eq 1 ]; then
  log "Retensi dilewati (--skip-retention)."
else
  log "Menjalankan retensi (keep=$RETENTION_KEEP)..."
  bash "$SCRIPT_DIR/db-retention.sh" || warn "Retensi gagal (backup utama tetap aman; cek log)."
fi

log "=== BACKUP SELESAI & TERVERIFIKASI: $FILE_BASE ($SIZE_BYTES bytes) ==="
exit 0
