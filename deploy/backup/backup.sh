#!/bin/sh
# Daily backup (TZ §9): the database as a compressed dump, the object store as
# a mirror. Both go into /backups/<date>/, and anything older than
# BACKUP_RETENTION_DAYS is removed afterwards.
#
# It exits non-zero on the first failure on purpose: a backup job that reports
# success after half a backup is worse than one that reports nothing.
set -eu

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y-%m-%d_%H%M)"
TARGET="/backups/${STAMP}"
mkdir -p "${TARGET}"

echo "[backup] ${STAMP} — database"
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  --host="${POSTGRES_HOST:-postgres}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --format=custom \
  --file="${TARGET}/database.dump"

echo "[backup] ${STAMP} — files"
mc alias set store "${MINIO_URL:-http://minio:9000}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null
mc mirror --overwrite --quiet "store/${MINIO_BUCKET:-truckcontrol}" "${TARGET}/files"

# A dump that cannot be listed is not a backup. This catches a truncated or
# corrupt file the same night, not on the day someone needs to restore it.
echo "[backup] ${STAMP} — verifying"
pg_restore --list "${TARGET}/database.dump" >/dev/null

SIZE="$(du -sh "${TARGET}" | cut -f1)"
echo "[backup] ${STAMP} — done (${SIZE})"

find /backups -maxdepth 1 -mindepth 1 -type d -mtime "+${RETENTION_DAYS}" -exec rm -rf {} +
