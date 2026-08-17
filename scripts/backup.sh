#!/bin/sh
# Nightly database backup (TASK-2.8).
#
# Writes a compressed, dated pg_dump to /backups, uploads it to object storage
# when credentials are present, and prunes anything older than the retention
# window. Failure is loud: a silent backup failure is indistinguishable from a
# working backup right up until the restore.
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${PGPASSWORD:=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}}"
export PGPASSWORD

PGHOST="${POSTGRES_HOST:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/truckcontrol-${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] dumping ${POSTGRES_DB} from ${PGHOST}"
# --clean --if-exists so the dump can be restored over an existing database.
pg_dump --host="$PGHOST" --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
  --format=plain --clean --if-exists --no-owner \
  | gzip -9 > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"

SIZE="$(wc -c < "$FILE")"
# A dump smaller than this is not a database, it is an error message.
if [ "$SIZE" -lt 1024 ]; then
  echo "[backup] FAILED: dump is only ${SIZE} bytes" >&2
  exit 1
fi
echo "[backup] wrote ${FILE} (${SIZE} bytes)"

if [ -n "${MINIO_ENDPOINT:-}" ] && command -v mc >/dev/null 2>&1; then
  SCHEME="http"
  [ "${MINIO_USE_SSL:-false}" = "true" ] && SCHEME="https"
  mc alias set backup "${SCHEME}://${MINIO_ENDPOINT}:${MINIO_PORT:-9000}" \
    "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  mc mb --ignore-existing "backup/${BACKUP_BUCKET:-truckcontrol-backups}" >/dev/null
  mc cp "$FILE" "backup/${BACKUP_BUCKET:-truckcontrol-backups}/"
  echo "[backup] uploaded to object storage"
else
  echo "[backup] object storage not configured — local copy only" >&2
fi

find "$BACKUP_DIR" -name 'truckcontrol-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete
echo "[backup] done; retention ${RETENTION_DAYS} days"
