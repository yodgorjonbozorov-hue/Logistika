#!/bin/sh
# Proves a backup can actually be restored, by restoring it.
#
#   BACKUP_PASSPHRASE=… SOURCE_URL=postgresql://…/truckai \
#     sh deploy/backup-verify.sh [/backups/truckai_20260820_041500Z.dump.gpg]
#
# Run it weekly from cron. An untested backup is a belief, not a control: the
# ways a backup strategy fails — a passphrase nobody recorded, a dump that
# excludes a schema, a retention policy that pruned the only good copy, an
# archive truncated by a full disk — are all invisible until a restore is
# attempted, and the first attempt should not be during an outage.
#
# What it does:
#   1. picks the newest backup (or the one named on the command line)
#   2. checks the recorded sha256
#   3. creates a THROWAWAY database and restores into it
#   4. compares row counts and finance totals against the live source
#   5. checks the migration history and the tenant-safety indexes survived
#   6. checks no company's rows leaked into another company
#   7. drops the throwaway database
#
# It never writes to the source database and never touches the backup files.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
ARCHIVE="${1:-}"
SOURCE_URL="${SOURCE_URL:-}"
# A distinct name per run so two overlapping runs cannot fight over one database.
SCRATCH_DB="${SCRATCH_DB:-truckai_restore_check_$$}"
ADMIN_URL="${ADMIN_URL:-postgresql://postgres@127.0.0.1:5432/postgres}"

PROBLEMS=0
fail() { echo "  FAIL  $*"; PROBLEMS=$((PROBLEMS + 1)); }
ok()   { echo "  ok    $*"; }
warn() { echo "  WARN  $*"; }
log()  { echo "[verify $(date -u +%H:%M:%S)] $*"; }

[ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "BACKUP_PASSPHRASE is required" >&2; exit 2; }

# Prisma's ?schema= is not libpq syntax; strip it rather than make the caller.
strip_params() { printf '%s' "$1" | sed 's/?.*$//'; }
SOURCE_PSQL="$(strip_params "$SOURCE_URL")"

# ---------------------------------------------------------------------------
# 1. Which backup
# ---------------------------------------------------------------------------
if [ -z "$ARCHIVE" ]; then
  ARCHIVE="$(find "$BACKUP_DIR" \( -name 'truckai_*.dump.gpg' -o -name 'truckcontrol-*.dump.gpg' \) \
    -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n1 | cut -d' ' -f2-)"
fi
[ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ] || { echo "no backup found in $BACKUP_DIR" >&2; exit 2; }

AGE_HOURS=$(( ( $(date +%s) - $(date -r "$ARCHIVE" +%s) ) / 3600 ))
log "verifying $ARCHIVE (${AGE_HOURS}h old)"
if [ "$AGE_HOURS" -gt 48 ]; then
  fail "the newest backup is ${AGE_HOURS}h old — the daily backup is not running"
else
  ok "backup age ${AGE_HOURS}h"
fi

# ---------------------------------------------------------------------------
# 2. Integrity
# ---------------------------------------------------------------------------
if [ -f "${ARCHIVE}.sha256" ]; then
  if (cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256" >/dev/null 2>&1); then
    ok "sha256 matches"
  else
    fail "sha256 MISMATCH — the archive is corrupt"
    exit 1
  fi
else
  warn "no .sha256 recorded alongside the archive"
fi

# ---------------------------------------------------------------------------
# 3. Restore into a throwaway database
# ---------------------------------------------------------------------------
cleanup() {
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $SCRATCH_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

log "creating scratch database $SCRATCH_DB"
psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $SCRATCH_DB" >/dev/null 2>&1 || true
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $SCRATCH_DB" >/dev/null

SCRATCH_URL="$(printf '%s' "$ADMIN_URL" | sed "s#/postgres\$#/$SCRATCH_DB#")"

RESTORE_START="$(date +%s)"
if sh "$(dirname "$0")/restore.sh" "$ARCHIVE" "$SCRATCH_URL" >/tmp/restore-verify.$$.log 2>&1; then
  ok "restored in $(( $(date +%s) - RESTORE_START ))s"
else
  fail "restore failed"
  tail -20 /tmp/restore-verify.$$.log
  rm -f /tmp/restore-verify.$$.log
  exit 1
fi
rm -f /tmp/restore-verify.$$.log

q() { psql "$1" -tAc "$2" 2>/dev/null || echo "ERR"; }

# ---------------------------------------------------------------------------
# 4. Schema and migration history
# ---------------------------------------------------------------------------
SRC_MIGRATIONS="$(q "$SOURCE_PSQL" "select count(*) from _prisma_migrations where finished_at is not null")"
DST_MIGRATIONS="$(q "$SCRATCH_URL" "select count(*) from _prisma_migrations where finished_at is not null")"
if [ "$SRC_MIGRATIONS" = "$DST_MIGRATIONS" ] && [ "$DST_MIGRATIONS" != "ERR" ]; then
  ok "migration history restored ($DST_MIGRATIONS applied)"
else
  fail "migration history differs: source=$SRC_MIGRATIONS restored=$DST_MIGRATIONS"
fi

SRC_TABLES="$(q "$SOURCE_PSQL" "select count(*) from pg_tables where schemaname='public'")"
DST_TABLES="$(q "$SCRATCH_URL" "select count(*) from pg_tables where schemaname='public'")"
if [ "$SRC_TABLES" = "$DST_TABLES" ]; then
  ok "all $DST_TABLES tables present"
else
  fail "table count differs: source=$SRC_TABLES restored=$DST_TABLES"
fi

# The uniqueness guarantees the application relies on are enforced by indexes.
# A dump that lost one restores "successfully" and then lets a driver start two
# trips at once, so they are checked by name.
for index in trips_one_active_per_driver trips_one_active_per_vehicle expenses_company_id_client_tx_id_key; do
  if [ "$(q "$SCRATCH_URL" "select count(*) from pg_indexes where indexname='$index'")" = "1" ]; then
    ok "index $index restored"
  else
    fail "index $index MISSING after restore"
  fi
done

# ---------------------------------------------------------------------------
# 5. Data: counts must match exactly
# ---------------------------------------------------------------------------
for table in companies users drivers vehicles routes clients trips expenses incomes fuel_logs gps_tracks documents audit_logs; do
  SRC="$(q "$SOURCE_PSQL" "select count(*) from $table")"
  DST="$(q "$SCRATCH_URL" "select count(*) from $table")"
  if [ "$SRC" = "$DST" ] && [ "$DST" != "ERR" ]; then
    ok "$table: $DST rows"
  else
    fail "$table row count differs: source=$SRC restored=$DST"
  fi
done

# ---------------------------------------------------------------------------
# 6. Money: the totals, in integer tiyin, must be identical
# ---------------------------------------------------------------------------
# Summed in SQL as bigint. A restore that silently changed a numeric type would
# still produce matching row counts, so the money is compared on its own.
# `trips.agreed_price` is the booked revenue and `incomes.amount` is what was
# actually collected — both are money and both are compared, because a restore
# that lost one of them still balances if only the other is checked.
AGREED_SQL="select coalesce(sum(agreed_price),0)::text from trips"
INCOME_SQL="select coalesce(sum(amount),0)::text from incomes"
EXPENSE_SQL="select coalesce(sum(amount),0)::text from expenses"
FUEL_SQL="select coalesce(sum(total_amount),0)::text from fuel_logs"
LITRES_SQL="select coalesce(sum(liters),0)::text from fuel_logs"

for pair in "agreed revenue:$AGREED_SQL" "collected income:$INCOME_SQL" "expenses:$EXPENSE_SQL" "fuel cost:$FUEL_SQL" "fuel litres:$LITRES_SQL"; do
  label="${pair%%:*}"; sql="${pair#*:}"
  SRC="$(q "$SOURCE_PSQL" "$sql")"
  DST="$(q "$SCRATCH_URL" "$sql")"
  if [ "$SRC" = "$DST" ] && [ "$DST" != "ERR" ]; then
    ok "$label total identical ($DST)"
  else
    fail "$label total differs: source=$SRC restored=$DST"
  fi
done

# ---------------------------------------------------------------------------
# 7. Tenant integrity survived the round trip
# ---------------------------------------------------------------------------
# Every child row must still belong to the same company as its parent. A dump
# restored with rows re-parented (or a foreign key silently dropped) is a
# cross-tenant leak that no row count would reveal.
ORPHANS="$(q "$SCRATCH_URL" "
  select
    (select count(*) from trips t join vehicles v on v.id = t.vehicle_id
       where v.company_id <> t.company_id) +
    (select count(*) from expenses e join trips t on t.id = e.trip_id
       where t.company_id <> e.company_id) +
    (select count(*) from incomes i join trips t on t.id = i.trip_id
       where t.company_id <> i.company_id) +
    (select count(*) from fuel_logs f join vehicles v on v.id = f.vehicle_id
       where v.company_id <> f.company_id)
")"
if [ "$ORPHANS" = "0" ]; then
  ok "no row belongs to a different company than its parent"
else
  fail "$ORPHANS rows cross a company boundary after restore"
fi

COMPANIES="$(q "$SCRATCH_URL" "select count(*) from companies")"
ok "restored data spans $COMPANIES companies"

echo
if [ "$PROBLEMS" -gt 0 ]; then
  echo "RESTORE VERIFICATION FAILED — $PROBLEMS problem(s)."
  exit 1
fi
echo "RESTORE VERIFIED — this backup is recoverable."
