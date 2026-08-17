#!/bin/sh
# Backup sidecar entrypoint: run backup.sh once a day, forever.
# Deliberately not cron — one process, one log stream, restarts with the stack.
set -eu

INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"

# apk is only present on the alpine-based postgres image; ignore if absent.
if ! command -v mc >/dev/null 2>&1; then
  apk add --no-cache minio-client >/dev/null 2>&1 || true
fi

while true; do
  if /scripts/backup.sh; then
    echo "[backup-loop] success at $(date -u +%FT%TZ)"
  else
    echo "[backup-loop] FAILURE at $(date -u +%FT%TZ)" >&2
  fi
  sleep "$INTERVAL_SECONDS"
done
