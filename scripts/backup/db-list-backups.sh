#!/usr/bin/env bash
# ============================================================
# db-list-backups.sh — Lihat daftar backup & status terakhir di Cloudflare R2
#
# Penggunaan:
#   bash db-list-backups.sh              # daftar backup harian + status
#   bash db-list-backups.sh --all        # termasuk pre-restore & laporan restore
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

SHOW_ALL=0
[ "${1:-}" = "--all" ] && SHOW_ALL=1

require_tools aws
require_r2_env
aws_env

log "=== DAFTAR BACKUP DIDIQC di s3://$R2_BUCKET/$R2_PREFIX/ ==="

ALL_KEYS="$(r2_list_keys "$R2_PREFIX/")" || die "Gagal list R2 (cek kredensial/endpoint)."

DAILY="$(printf '%s\n' "$ALL_KEYS" | grep -E "^$R2_PREFIX/didiqc_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump$" | sort | sed '/^$/d')"
COUNT="$(printf '%s\n' "$DAILY" | sed '/^$/d' | wc -l | tr -d ' ')"

if [ -z "$DAILY" ]; then
  echo "(belum ada backup harian)"
else
  echo ""
  echo "Backup harian ($COUNT / maks $RETENTION_KEEP, terbaru di bawah):"
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    size="$(r2_head_size "$key")"
    printf '  %-70s %s\n' "$(basename "$key")" "$(printf '%s' "$size" | awk '{printf "%.1f MB", $1/1024/1024}')"
  done <<< "$DAILY"
fi

if [ "$SHOW_ALL" -eq 1 ]; then
  PRE="$(printf '%s\n' "$ALL_KEYS" | grep -E "^$R2_PREFIX/pre-restore/.*\.dump$" | sort | sed '/^$/d')"
  if [ -n "$PRE" ]; then
    echo ""
    echo "Backup keselamatan pre-restore (tidak ikut retensi):"
    printf '%s\n' "$PRE" | sed 's/^/  - /'
  fi
  LOGS="$(printf '%s\n' "$ALL_KEYS" | grep -E "^$R2_PREFIX/status/restore-log/" | sort | sed '/^$/d')"
  if [ -n "$LOGS" ]; then
    echo ""
    echo "Laporan restore terakhir:"
    printf '%s\n' "$LOGS" | tail -5 | sed 's/^/  - /'
  fi
fi

echo ""
echo "=== STATUS BACKUP TERAKHIR ==="
STATUS_LOCAL="$(mktemp)"
if r2s3 cp "s3://$R2_BUCKET/$R2_PREFIX/status/backup-status.json" "$STATUS_LOCAL" >/dev/null 2>&1 && [ -s "$STATUS_LOCAL" ]; then
  cat "$STATUS_LOCAL"
  echo ""
else
  echo "(belum ada status backup)"
fi
rm -f "$STATUS_LOCAL"
exit 0
