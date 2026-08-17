#!/bin/sh
# Restore a database backup (TASK-2.8).
#
#   ./scripts/restore.sh /backups/truckcontrol-20260817T030000Z.sql.gz
#
# A backup nobody has restored is a hope, not a backup — docs/DISASTER-RECOVERY.md
# asks for this to be exercised monthly against a scratch database.
set -eu

FILE="${1:?usage: restore.sh <backup.sql.gz> [target-database]}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${PGPASSWORD:=${POSTGRES_POSTGRES_PASSWORD:-${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}}}"
export PGPASSWORD

PGHOST="${POSTGRES_HOST:-postgres}"
TARGET="${2:-${POSTGRES_DB:?POSTGRES_DB is required}}"

[ -f "$FILE" ] || { echo "[restore] no such file: $FILE" >&2; exit 1; }

echo "[restore] about to overwrite database '${TARGET}' on ${PGHOST} from ${FILE}"
if [ "${RESTORE_ASSUME_YES:-}" != "true" ]; then
  printf '[restore] type the database name to confirm: '
  read -r CONFIRM
  [ "$CONFIRM" = "$TARGET" ] || { echo "[restore] aborted" >&2; exit 1; }
fi

gunzip -c "$FILE" | psql --host="$PGHOST" --username="$POSTGRES_USER" \
  --dbname="$TARGET" --set ON_ERROR_STOP=on --single-transaction

echo "[restore] done. Verify before sending traffic:"
echo "  psql -h ${PGHOST} -U ${POSTGRES_USER} -d ${TARGET} -c 'SELECT count(*) FROM trips;'"
echo "  and check that row-level security is still enabled (scripts/create-db-roles.sql)"
