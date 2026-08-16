#!/bin/sh
# Restore from a backup directory made by backup.sh:
#
#   docker compose -f docker-compose.prod.yml run --rm backup \
#     /scripts/restore.sh /backups/2026-08-16_0300
#
# It refuses to run without RESTORE_CONFIRM=yes, because this drops and
# recreates the schema of whatever database it is pointed at.
set -eu

SOURCE="${1:?usage: restore.sh /backups/<stamp>}"
[ -f "${SOURCE}/database.dump" ] || { echo "no database.dump in ${SOURCE}"; exit 1; }

if [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  echo "Refusing to restore over ${POSTGRES_DB}. Set RESTORE_CONFIRM=yes to proceed."
  exit 1
fi

echo "[restore] database from ${SOURCE}"
PGPASSWORD="${POSTGRES_PASSWORD}" pg_restore \
  --host="${POSTGRES_HOST:-postgres}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --clean --if-exists --no-owner \
  "${SOURCE}/database.dump"

if [ -d "${SOURCE}/files" ]; then
  echo "[restore] files from ${SOURCE}/files"
  mc alias set store "${MINIO_URL:-http://minio:9000}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null
  mc mb --ignore-existing "store/${MINIO_BUCKET:-truckcontrol}" >/dev/null
  mc mirror --overwrite --quiet "${SOURCE}/files" "store/${MINIO_BUCKET:-truckcontrol}"
fi

echo "[restore] done. Check a trip P&L and one receipt photo before trusting it."
