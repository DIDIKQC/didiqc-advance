#!/usr/bin/env bash
# ============================================================
# common.sh — Pustaka bersama untuk sistem Backup & Restore DIDIQC
#
# ATURAN KEAMANAN:
#   - Seluruh kredensial (InsForge, Neon, R2) dibaca dari ENVIRONMENT.
#   - TIDAK ADA kredensial yang ditulis di file ini maupun dicetak ke log.
#   - Hanya file dengan prefix ketat "database_didiqc/didiqc_*.dump"
#     yang boleh disentuh retention. Prefix/prefix lain TIDAK disentuh.
#
# Variabel environment yang dipakai:
#   INSFORGE_DATABASE_URL   (wajib untuk backup / restore ke InsForge)
#   R2_ENDPOINT             (mis. https://<account>.r2.cloudflarestorage.com)
#   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
#   R2_BUCKET               (default: didikqc — bucket existing milik user)
#   R2_PREFIX               (default: database_didiqc)
#   RETENTION_KEEP          (default: 15)
#   BACKUP_ALERT_WEBHOOK    (opsional — notifikasi gagal: Slack/Discord/generic)
# ============================================================

# Jangan pakai `set -e` global; setiap script mengelola error eksplisit
# agar pesan error bisa ditulis ke status file R2 sebelum exit.
set -uo pipefail

R2_ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID:-}.r2.cloudflarestorage.com}"
R2_BUCKET="${R2_BUCKET:-didikqc}"
R2_PREFIX="${R2_PREFIX:-database_didiqc}"
RETENTION_KEEP="${RETENTION_KEEP:-15}"
TZ_BACKUP="${TZ_BACKUP:-Asia/Jakarta}"

# Direktori kerja sementara (bersih otomatis via trap di script pemanggil)
BACKUP_TMP_DIR=""

# ------------------------------------------------------------
# Logging dengan timestamp WIB
# ------------------------------------------------------------
log()  { printf '[%s] %s\n' "$(TZ=$TZ_BACKUP date '+%F %T %Z')" "$*"; }
warn() { log "WARN: $*"; }
die()  { log "ERROR: $*"; exit 1; }

# ------------------------------------------------------------
# Escape string untuk di sisipkan ke JSON (satu baris, aman printf)
# ------------------------------------------------------------
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"    # backslash
  s="${s//\"/\\\"}"    # double quote
  s="${s//$'\n'/ }"    # newline -> spasi
  s="${s//$'\r'/ }"
  s="${s//$'\t'/ }"
  printf '%s' "$s"
}

# ------------------------------------------------------------
# Validasi environment minimum
# ------------------------------------------------------------
require_tools() {
  local missing=""
  for t in "$@"; do
    command -v "$t" >/dev/null 2>&1 || missing="$missing $t"
  done
  [ -n "$missing" ] && die "Tool tidak ditemukan:$missing — instal dulu (lihat docs/BACKUP-RESTORE.md)."
}

require_r2_env() {
  [ -z "${R2_ACCESS_KEY_ID:-}" ]     && die "R2_ACCESS_KEY_ID belum diset."
  [ -z "${R2_SECRET_ACCESS_KEY:-}" ] && die "R2_SECRET_ACCESS_KEY belum diset."
  [ -z "${R2_ENDPOINT:-}" ]          && die "R2_ENDPOINT belum diset (contoh: https://<account_id>.r2.cloudflarestorage.com)."
  [ -z "${R2_BUCKET:-}" ]            && die "R2_BUCKET belum diset."
}

# Ekspor kredensial ke format yang dibaca AWS CLI
aws_env() {
  export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="auto"
  export AWS_REQUEST_CHECKSUM_CALCULATION="when_supported"
  export AWS_RETRY_MODE="standard"
  export AWS_MAX_ATTEMPTS="5"
}

# ------------------------------------------------------------
# Wrapper AWS CLI khusus R2
# ------------------------------------------------------------
r2api() { aws --endpoint-url "$R2_ENDPOINT" --region auto s3api "$@"; }
r2s3()  { aws --endpoint-url "$R2_ENDPOINT" --region auto s3 "$@"; }

# Masker kredensial untuk pesan error koneksi
mask_url() {
  printf '%s' "$1" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#g'
}

# ------------------------------------------------------------
# Notifikasi kegagalan (opsional)
# Format generik {"text":..,"content":..} — cocok untuk Slack & Discord.
# ------------------------------------------------------------
notify_failure() {
  local msg="${1:-Backup/restore DIDIQC gagal}"
  if [ -n "${BACKUP_ALERT_WEBHOOK:-}" ]; then
    local body
    body="$(printf '{"text":"%s","content":"%s","username":"DIDIQC Backup Bot"}' \
      "$(json_escape "$msg")" "$(json_escape "$msg")")"
    curl -sS -m 15 -X POST -H 'Content-Type: application/json' \
      -d "$body" "$BACKUP_ALERT_WEBHOOK" >/dev/null 2>&1 || true
    log "Notifikasi kegagalan dikirim ke BACKUP_ALERT_WEBHOOK."
  fi
}

# ------------------------------------------------------------
# Bersihkan direktori kerja sementara
# ------------------------------------------------------------
cleanup_tmp() {
  [ -n "$BACKUP_TMP_DIR" ] && [ -d "$BACKUP_TMP_DIR" ] && rm -rf "$BACKUP_TMP_DIR"
}

# ------------------------------------------------------------
# Ambil seluruh object key di bawah sebuah prefix (dukung paginasi
# via --start-after; output: daftar key satu per baris)
# ------------------------------------------------------------
r2_list_keys() {
  local prefix="$1" marker="" page=0
  while [ $page -lt 50 ]; do
    page=$((page+1))
    local json
    if [ -z "$marker" ]; then
      json="$(r2api list-objects-v2 --bucket "$R2_BUCKET" --prefix "$prefix" --output json)" || return 1
    else
      json="$(r2api list-objects-v2 --bucket "$R2_BUCKET" --prefix "$prefix" --start-after "$marker" --output json)" || return 1
    fi
    printf '%s\n' "$json" | grep -o '"Key": *"[^"]*"' | sed 's/"Key": *"//;s/"$//'
    marker="$(printf '%s\n' "$json" | grep -o '"Key": *"[^"]*"' | sed 's/"Key": *"//;s/"$//' | tail -1)"
    # Hentikan bila halaman tidak terpotong
    printf '%s\n' "$json" | grep -q '"IsTruncated": *true' || break
  done
  return 0
}

# ------------------------------------------------------------
# Ambil size object R2 (byte). Output: angka, kosong jika tidak ada.
# ------------------------------------------------------------
r2_head_size() {
  local key="$1"
  r2api head-object --bucket "$R2_BUCKET" --key "$key" --output json 2>/dev/null \
    | grep -o '"ContentLength": *[0-9]*' | head -1 | grep -o '[0-9]*'
}

# ------------------------------------------------------------
# Validasi file .dump: arsip pg_restore yang valid?
# Output: 0 = valid; cetak jumlah "TABLE DATA" ke variabel TABLE_DATA_COUNT
# ------------------------------------------------------------
verify_dump_file() {
  local file="$1"
  [ -s "$file" ] || { warn "File dump kosong: $file"; return 1; }
  local toc
  toc="$(pg_restore --list "$file" 2>&1)" || { warn "pg_restore --list gagal: $file"; return 1; }
  # Format baris TOC (pg15):  <id>; <cat1> <cat2> TYPE [schema] [name] [owner]
  TABLE_DATA_COUNT="$(printf '%s\n' "$toc" | awk '$4=="TABLE" && $5=="DATA"' | wc -l | tr -d ' ')"
  TABLE_LIST_COUNT="$(printf '%s\n' "$toc" | awk '$4=="TABLE" && $5!="DATA"' | wc -l | tr -d ' ')"
  DUMP_SOURCE_VERSION="$(printf '%s\n' "$toc" | grep -oE 'Dumped from database version: *[0-9.]+' | awk '{print $NF}')"
  DUMP_CLIENT_VERSION="$(printf '%s\n' "$toc" | grep -oE 'Dumped by pg_dump version: *[0-9.]+' | awk '{print $NF}')"
  [ -n "$DUMP_SOURCE_VERSION" ] || warn "Versi sumber dump tidak terbaca."
  return 0
}
