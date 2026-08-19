#!/bin/sh
# Nightly database backup. Dumps in Postgres' custom format (restorable with
# pg_restore), keeps BACKUP_RETENTION_DAYS of history and runs the first dump
# immediately so a fresh deployment is covered from day one.
set -eu

DIR=/backups
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
HOUR="${BACKUP_HOUR_UTC:-22}"

mkdir -p "$DIR"

dump() {
  stamp=$(date -u +%Y%m%d-%H%M%S)
  file="$DIR/${PGDATABASE}-${stamp}.dump"
  echo "[backup] $(date -u +%FT%TZ) → $file"
  if pg_dump --format=custom --compress=9 --file="$file.part"; then
    mv "$file.part" "$file"
    # Retention is applied only after a successful dump, so a broken backup
    # run can never delete the last good copy.
    find "$DIR" -name "${PGDATABASE}-*.dump" -type f -mtime "+$RETENTION" -delete
    echo "[backup] done; keeping $RETENTION days"
  else
    rm -f "$file.part"
    echo "[backup] FAILED" >&2
  fi
}

# Strips leading zeros ("08" must not be read as octal, "00" must not be empty).
num() {
  n=$(echo "$1" | sed 's/^0*//')
  [ -z "$n" ] && n=0
  echo "$n"
}

seconds_until_hour() {
  now=$(( $(num "$(date -u +%H)") * 3600 + $(num "$(date -u +%M)") * 60 + $(num "$(date -u +%S)") ))
  target=$(( $(num "$HOUR") * 3600 ))
  diff=$(( target - now ))
  [ "$diff" -le 0 ] && diff=$(( diff + 86400 ))
  echo "$diff"
}

dump

while true; do
  wait_for=$(seconds_until_hour)
  echo "[backup] next run in ${wait_for}s (${HOUR}:00 UTC)"
  sleep "$wait_for"
  dump
done
