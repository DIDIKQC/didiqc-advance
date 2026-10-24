#!/usr/bin/env bash
# ============================================================
# db-retention.sh — Batasi jumlah backup harian di R2 (default: 15)
#
# ATURAN AMAN:
#   - Hapus HANYA key yang cocok pola KETAT:
#         ^database_didiqc/didiqc_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump$
#     beserta sidecar-nya: .sha256 dan .meta.json milik file yang dihapus.
#   - TIDAK menyentuh prefix lain (mis. database_didiqc_update/,
#     database_didiqc/status/, database_didiqc/pre-restore/) atau file lain.
#   - Backup terbaru tidak akan pernah dihapus.
#   - Dipanggil otomatis oleh db-backup.sh SETELAH backup baru
#     berhasil diunggah dan diverifikasi.
#
# Penggunaan:
#   bash db-retention.sh [--keep N] [--dry-run]
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep)    shift; RETENTION_KEEP="${1:-15}" ;;
    --dry-run) DRY_RUN=1 ;;
    *) die "Argumen tidak dikenal: $1" ;;
  esac
  shift
done

require_tools aws
require_r2_env
aws_env

case "$RETENTION_KEEP" in
  ''|*[!0-9]*) die "RETENTION_KEEP harus angka, dapat: $RETENTION_KEEP" ;;
esac
[ "$RETENTION_KEEP" -ge 1 ] || die "RETENTION_KEEP minimal 1"

# Pola ketat file backup harian + sidecar
PATTERN_DUMP='^'"$R2_PREFIX"'/didiqc_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump$'
PATTERN_SHA='^'"$R2_PREFIX"'/didiqc_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump\.sha256$'
PATTERN_META='^'"$R2_PREFIX"'/didiqc_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump\.meta\.json$'

log "=== RETENSI dimulai (bucket=$R2_BUCKET prefix=$R2_PREFIX keep=$RETENTION_KEEP dry_run=$DRY_RUN) ==="

# Ambil hanya file .dump yang cocok pola ketat, urut naik (nama memuat tanggal WIB)
ALL_KEYS="$(r2_list_keys "$R2_PREFIX/")" || die "Gagal list object R2."
DUMP_KEYS="$(printf '%s\n' "$ALL_KEYS" | grep -E "$PATTERN_DUMP" | sort | sed '/^$/d')"

TOTAL="$(printf '%s\n' "$DUMP_KEYS" | sed '/^$/d' | wc -l | tr -d ' ')"
log "File backup harian ditemukan: $TOTAL (target keep: $RETENTION_KEEP)"

[ "$TOTAL" -le "$RETENTION_KEEP" ] && { log "Belum melebihi batas. Tidak ada yang dihapus."; exit 0; }

# Key terbaru (baris paling akhir) = yang di-keep, beserta N-1 sebelumnya
DELETE_KEYS="$(printf '%s\n' "$DUMP_KEYS" | sed '/^$/d' | head -n "-$RETENTION_KEEP" | sed '/^$/d')"
DELETE_COUNT="$(printf '%s\n' "$DELETE_KEYS" | sed '/^$/d' | wc -l | tr -d ' ')"
log "Akan dihapus: $DELETE_COUNT file lama (+ sidecar .sha256/.meta.json):"
printf '%s\n' "$DELETE_KEYS" | sed 's/^/  - /'

if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY-RUN: tidak ada file yang benar-benar dihapus."
  exit 0
fi

# Hapus satu per satu (hanya key yang lolos pola ketat — cek ulang sebelum delete)
DELETED=0
while IFS= read -r key; do
  [ -z "$key" ] && continue
  # Cek ulang pattern (belt & suspenders)
  printf '%s' "$key" | grep -qE "$PATTERN_DUMP" || { warn "Lewati (pattern tidak cocok): $key"; continue; }
  if r2api delete-object --bucket "$R2_BUCKET" --key "$key" >/dev/null 2>&1; then
    DELETED=$((DELETED+1))
    log "Hapus: $key"
  else
    warn "Gagal hapus: $key"
  fi
  # Sidecar
  for suffix in sha256 meta.json; do
    sidecar="$key.$suffix"
    case "$suffix" in
      sha256)   printf '%s' "$sidecar" | grep -qE "$PATTERN_SHA" || continue ;;
      meta.json) printf '%s' "$sidecar" | grep -qE "$PATTERN_META" || continue ;;
    esac
    r2api head-object --bucket "$R2_BUCKET" --key "$sidecar" >/dev/null 2>&1 || continue
    r2api delete-object --bucket "$R2_BUCKET" --key "$sidecar" >/dev/null 2>&1 && log "Hapus sidecar: $sidecar"
  done
done <<< "$DELETE_KEYS"

log "=== RETENSI SELESAI: $DELETED file dihapus, $RETENTION_KEEP terbaru disimpan ==="
exit 0
