#!/usr/bin/env bash
# ============================================================
# db-compat-check.sh — Periksa kompatibilitas file .dump dengan database tujuan
#
# Yang diperiksa:
#   1. Versi pg_restore client vs versi dump
#   2. Versi PostgreSQL server tujuan vs versi server sumber (dump)
#   3. Ekstensi yang dibutuhkan dump vs yang tersedia di tujuan
#   4. Encoding database
#
# Aturan gagal (exit != 0):
#   - Server tujuan LEBIH LAMA dari server sumber dump  → hard fail
#   - pg_restore client lebih lama dari dump            → hard fail
#   - SCOPE=full tapi ekstensi tidak tersedia di tujuan → hard fail
#     (SCOPE=app tidak butuh ekstensi; hanya peringatan)
#
# Bypass: COMPAT_OVERRIDE=1 (hanya untuk target staging/custom —
#         TIDAK berlaku untuk target produksi InsForge)
#
# Penggunaan:
#   bash db-compat-check.sh --dump <file.dump> --target-url <url> [--scope app|full] [--label <nama>]
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

DUMP_FILE=""
TARGET_URL=""
SCOPE="app"
LABEL="target"

while [ $# -gt 0 ]; do
  case "$1" in
    --dump)       shift; DUMP_FILE="${1:-}" ;;
    --target-url) shift; TARGET_URL="${1:-}" ;;
    --scope)      shift; SCOPE="${1:-app}" ;;
    --label)      shift; LABEL="${1:-target}" ;;
    *) die "Argumen tidak dikenal: $1" ;;
  esac
  shift
done

require_tools pg_restore psql
[ -f "$DUMP_FILE" ] || die "File dump tidak ditemukan: $DUMP_FILE"
[ -n "$TARGET_URL" ] || die "TARGET_URL kosong."

export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}"

HARD_FAIL=0
WARNINGS=()

# ------------------------------------------------------------
# Baca header dump
# ------------------------------------------------------------
TOC="$(pg_restore --list "$DUMP_FILE" 2>&1)" || die "File dump tidak valid (pg_restore --list gagal)."
DUMP_SRC_VER="$(printf '%s\n' "$TOC" | grep -oE 'Dumped from database version: *[0-9.]+' | awk '{print $NF}')"
DUMP_CLI_VER="$(printf '%s\n' "$TOC" | grep -oE 'Dumped by pg_dump version: *[0-9.]+' | awk '{print $NF}')"
RESTORE_CLI_VER="$(pg_restore --version | grep -oE '[0-9]+\.[0-9]+')"
# Encoding: dari TOC bila ada, fallback dari SQL hasil pg_restore
DUMP_ENC="$(printf '%s\n' "$TOC" | grep -oE 'ENCODING [A-Z0-9]+' | awk '{print $2}')"
[ -n "$DUMP_ENC" ] || DUMP_ENC="$(pg_restore --file=- "$DUMP_FILE" 2>/dev/null | grep -m1 -oE "SET client_encoding = '[A-Z0-9]+'" | grep -oE "'[A-Z0-9]+'" | tr -d "'")" 

# Ekstensi yang muncul di dump (baris: <id>; <cat> EXTENSION - <nama>)
DUMP_EXTS="$(printf '%s\n' "$TOC" | awk '$4=="EXTENSION" {gsub(/\"/,"",$6); print $6}' | sort -u)"
DUMP_EXT_COUNT="$(printf '%s\n' "$DUMP_EXTS" | sed '/^$/d' | wc -l | tr -d ' ')"

major_of() { printf '%s' "$1" | cut -d. -f1; }
ver_ge() {  # ver_ge A B → "A >= B" secara versi numerik sederhana
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$2" ]
}

# ------------------------------------------------------------
# Server tujuan
# ------------------------------------------------------------
TARGET_VER="$(psql "$TARGET_URL" -tAc 'SHOW server_version;' 2>&1 | head -1 | tr -d ' ')" \
  || { echo "GAGAL: tidak dapat terhubung ke $LABEL ($(mask_url "$TARGET_URL"))"; exit 1; }
case "$TARGET_VER" in (*[!0-9.]*) echo "GAGAL: respons server tujuan tidak wajar: $TARGET_VER"; exit 1;; esac
TARGET_ENC="$(psql "$TARGET_URL" -tAc "SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname=current_database();" 2>/dev/null | tr -d ' ')"
TARGET_AVAILABLE_EXTS="$(psql "$TARGET_URL" -tAc "SELECT name FROM pg_available_extensions;" 2>/dev/null | tr -d ' ' | sort -u)"

# ------------------------------------------------------------
# Laporan
# ------------------------------------------------------------
echo "=============================================================="
echo " CEK KOMPATIBILITAS DUMP -> $LABEL"
echo "=============================================================="
printf ' Dump dibuat dari server : %s\n' "${DUMP_SRC_VER:-?}"
printf ' Dump dibuat oleh client : %s\n' "${DUMP_CLI_VER:-?}"
printf ' pg_restore client lokal : %s\n' "$RESTORE_CLI_VER"
printf ' Server tujuan           : %s\n' "$TARGET_VER"
printf ' Encoding dump / tujuan  : %s / %s\n' "${DUMP_ENC:-?}" "${TARGET_ENC:-?}"
printf ' Ekstensi di dump        : %s buku%s\n' "$DUMP_EXT_COUNT" "${DUMP_EXTS:+ ($(printf '%s' "$DUMP_EXTS" | tr '\n' ' '))}"

# 1) pg_restore client harus >= versi dump sumber
if [ -n "$DUMP_SRC_VER" ] && ! ver_ge "$RESTORE_CLI_VER" "$(major_of "$DUMP_SRC_VER").0"; then
  echo " GAGAL: pg_restore client ($RESTORE_CLI_VER) lebih lama dari dump ($DUMP_SRC_VER)."
  HARD_FAIL=1
fi

# 2) Server tujuan harus >= versi server sumber
if [ -n "$DUMP_SRC_VER" ] && [ "$(major_of "$TARGET_VER")" -lt "$(major_of "$DUMP_SRC_VER")" ]; then
  echo " GAGAL: server tujuan ($(major_of "$TARGET_VER")) lebih LAMA dari server sumber dump ($(major_of "$DUMP_SRC_VER"))."
  echo "        Dump dari PostgreSQL lebih baru tidak didukung untuk restore ke server lebih lama."
  HARD_FAIL=1
fi

# 3) Ekstensi
MISSING_EXTS=""
if [ -n "$(printf '%s' "$DUMP_EXTS" | sed '/^$/d')" ]; then
  while IFS= read -r e; do
    [ -z "$e" ] && continue
    printf '%s\n' "$TARGET_AVAILABLE_EXTS" | grep -qx "$e" || MISSING_EXTS="$MISSING_EXTS $e"
  done <<< "$DUMP_EXTS"
  if [ -n "$MISSING_EXTS" ]; then
    if [ "$SCOPE" = "full" ]; then
      echo " GAGAL: SCOPE=full membutuhkan ekstensi yang TIDAK tersedia di tujuan:$MISSING_EXTS"
      echo "        Gunakan --scope app (restore tabel aplikasi schema public saja)"
      echo "        atau pilih tujuan yang mendukung ekstensi tersebut."
      HARD_FAIL=1
    else
      WARNINGS+=("Ekstensi tidak tersedia di tujuan:$MISSING_EXTS — pada SCOPE=app ekstensi di-skip (tabel aplikasi DIDIQC tidak memakai ekstensi tersebut).")
    fi
  fi
fi

# 4) Encoding
if [ -n "$DUMP_ENC" ] && [ -n "$TARGET_ENC" ] && [ "$DUMP_ENC" != "$TARGET_ENC" ]; then
  WARNINGS+=("Encoding berbeda: dump=$DUMP_ENC tujuan=$TARGET_ENC (umumnya aman bila keduanya UTF-8).")
fi

for w in "${WARNINGS[@]:-}"; do
  [ -n "$w" ] && echo " PERINGATAN: $w"
done

# ------------------------------------------------------------
# Khusus Neon: info koneksi
# ------------------------------------------------------------
case "$(printf '%s' "$TARGET_URL" | sed -E 's#.*@##')" in
  *neon.tech*)
    if printf '%s' "$TARGET_URL" | grep -q -- "-pooler\."; then
      echo " PERINGATAN: URL memakai endpoint POOLER Neon (-pooler). Untuk pg_restore"
      echo "        gunakan endpoint LANGSUNG (direct), bukan pooler transaction mode."
    fi
    ;;
esac

echo "=============================================================="
if [ $HARD_FAIL -eq 1 ]; then
  if [ "${COMPAT_OVERRIDE:-0}" = "1" ]; then
    echo " HASIL: GAGAL — tetap dilanjutkan karena COMPAT_OVERRIDE=1."
    exit 0
  fi
  echo " HASIL: TIDAK KOMPATIBEL (lihat pesan GAGAL di atas)."
  exit 1
fi
echo " HASIL: KOMPATIBEL ✓"
exit 0
