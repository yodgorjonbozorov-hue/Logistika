#!/bin/sh
# Restore an encrypted backup produced by deploy/backup.sh.
#
#   BACKUP_PASSPHRASE=… sh deploy/restore.sh <backup.dump.gpg> <target-database-url>
#
# The target database URL must be a PLAIN libpq URL. Prisma's DATABASE_URL
# carries a `?schema=` parameter that libpq rejects outright — passing it
# straight through is the first thing that goes wrong when this is written in a
# hurry, so the script checks for it.
#
# Safety: refuses to restore over a database that already contains tables unless
# RESTORE_ALLOW_OVERWRITE=true is set explicitly. Restoring onto a live database
# is how a "recovery" turns into the actual outage.
set -eu

ARCHIVE="${1:-}"
TARGET_URL="${2:-}"

usage() {
  echo "usage: BACKUP_PASSPHRASE=… sh deploy/restore.sh <backup.dump.gpg> <postgresql://…>" >&2
  exit 2
}

[ -n "$ARCHIVE" ] && [ -n "$TARGET_URL" ] || usage
[ -f "$ARCHIVE" ] || { echo "no such backup: $ARCHIVE" >&2; exit 1; }
[ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "BACKUP_PASSPHRASE is required" >&2; exit 1; }

case "$TARGET_URL" in
  *\?schema=*|*\&schema=*)
    echo "ERROR: strip the '?schema=' parameter — that is Prisma-only syntax and libpq rejects it" >&2
    exit 1
    ;;
esac

log() { echo "[restore $(date -u +%H:%M:%S)] $*"; }

# ---------------------------------------------------------------------------
# 1. Integrity
# ---------------------------------------------------------------------------
if [ -f "${ARCHIVE}.sha256" ]; then
  log "checking sha256"
  (cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256")
else
  log "WARNING: no .sha256 alongside the archive — integrity not verified"
fi

# ---------------------------------------------------------------------------
# 2. Refuse to clobber a populated database by accident
# ---------------------------------------------------------------------------
EXISTING="$(psql "$TARGET_URL" -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null || echo 0)"
if [ "$EXISTING" -gt 0 ] && [ "${RESTORE_ALLOW_OVERWRITE:-false}" != "true" ]; then
  echo "ERROR: target already holds ${EXISTING} tables." >&2
  echo "Restore into a NEW database, or set RESTORE_ALLOW_OVERWRITE=true if you truly" >&2
  echo "mean to overwrite this one." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Decrypt to a private temporary file
# ---------------------------------------------------------------------------
WORK_DIR="$(mktemp -d)"
chmod 700 "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT INT TERM
PLAIN="${WORK_DIR}/restore.dump"

log "decrypting"
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet \
  --passphrase-fd 0 --pinentry-mode loopback \
  --decrypt --output "$PLAIN" "$ARCHIVE"

log "archive contains $(pg_restore --list "$PLAIN" | grep -c 'TABLE DATA' || true) tables with data"

# ---------------------------------------------------------------------------
# 4. Restore
# ---------------------------------------------------------------------------
log "restoring into the target database"
pg_restore --no-owner --no-acl --exit-on-error \
  ${RESTORE_ALLOW_OVERWRITE:+--clean --if-exists} \
  --dbname "$TARGET_URL" "$PLAIN"

# ---------------------------------------------------------------------------
# 5. Verify what actually landed
# ---------------------------------------------------------------------------
log "verifying"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 <<'SQL'
\echo '--- row counts ---'
SELECT 'companies' AS table, count(*) FROM companies
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'trips', count(*) FROM trips
UNION ALL SELECT 'expenses', count(*) FROM expenses
UNION ALL SELECT 'incomes', count(*) FROM incomes;

\echo '--- migration history ---'
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at;

\echo '--- tenant safety indexes ---'
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('trips_one_active_per_driver', 'trips_one_active_per_vehicle',
                    'expenses_company_id_client_tx_id_key');
SQL

log "restore complete — now run 'prisma migrate deploy' against the restored database"
