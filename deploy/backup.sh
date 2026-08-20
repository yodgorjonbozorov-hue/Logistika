#!/bin/sh
# Encrypted PostgreSQL backup with retention and an optional offsite copy.
#
#   BACKUP_PASSPHRASE=… sh deploy/backup.sh
#
# Design notes:
#  * `--format=custom` (not plain SQL): it is compressed, and pg_restore can
#    restore selectively and in parallel from it.
#  * The dump is encrypted BEFORE it is written anywhere durable — a backup is a
#    complete copy of every tenant's data, and an unencrypted one on a mounted
#    volume or in an object bucket is a breach waiting for a misconfiguration.
#  * A dump is verified with `pg_restore --list` before the old ones are pruned:
#    deleting a good backup because a broken one replaced it is how a backup
#    strategy fails silently.
#  * Restore procedure: deploy/restore.sh (test it — see deploy/README.md).
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
# truckai_<date>_<timestamp>: the date is first so a plain `ls` sorts
# chronologically, and both halves are UTC so a backup taken either side of a
# clock change still lands in the right order.
STAMP="$(date -u +%Y%m%d_%H%M%SZ)"
BASENAME="truckai_${STAMP}.dump"
TMP_FILE="${BACKUP_DIR}/.${BASENAME}.partial"
PLAIN_FILE="${BACKUP_DIR}/${BASENAME}"
ENC_FILE="${PLAIN_FILE}.gpg"

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "BACKUP_PASSPHRASE is required — refusing to write an unencrypted backup" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

log() { echo "[backup $(date -u +%H:%M:%S)] $*"; }

# ---------------------------------------------------------------------------
# 1. Dump
# ---------------------------------------------------------------------------
log "dumping ${PGDATABASE:-?} from ${PGHOST:-?}"
pg_dump --format=custom --no-owner --no-acl --compress=9 --file "$TMP_FILE"

# ---------------------------------------------------------------------------
# 2. Verify the dump is readable before anything is pruned
# ---------------------------------------------------------------------------
if ! pg_restore --list "$TMP_FILE" >/dev/null 2>&1; then
  log "ERROR: dump failed verification, keeping previous backups and aborting"
  rm -f "$TMP_FILE"
  exit 1
fi
TABLE_COUNT="$(pg_restore --list "$TMP_FILE" | grep -c 'TABLE DATA' || true)"
log "dump verified: ${TABLE_COUNT} tables with data"
if [ "$TABLE_COUNT" -lt 5 ]; then
  log "ERROR: only ${TABLE_COUNT} tables in the dump — this does not look like a full database"
  rm -f "$TMP_FILE"
  exit 1
fi

mv "$TMP_FILE" "$PLAIN_FILE"

# ---------------------------------------------------------------------------
# 3. Encrypt, then remove the plaintext
# ---------------------------------------------------------------------------
log "encrypting"
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet \
  --passphrase-fd 0 --pinentry-mode loopback \
  --symmetric --cipher-algo AES256 --output "$ENC_FILE" "$PLAIN_FILE"
rm -f "$PLAIN_FILE"

SIZE="$(du -h "$ENC_FILE" | cut -f1)"
sha256sum "$ENC_FILE" > "${ENC_FILE}.sha256"
log "wrote ${ENC_FILE} (${SIZE})"

# ---------------------------------------------------------------------------
# 4. Offsite copy (optional but strongly recommended)
# ---------------------------------------------------------------------------
# A backup on the same host as the database survives a dropped table; it does
# not survive the host. Set BACKUP_S3_TARGET to an `mc` alias/bucket path.
if [ -n "${BACKUP_S3_TARGET:-}" ]; then
  if command -v mc >/dev/null 2>&1; then
    log "copying offsite to ${BACKUP_S3_TARGET}"
    mc cp "$ENC_FILE" "${BACKUP_S3_TARGET}/" && mc cp "${ENC_FILE}.sha256" "${BACKUP_S3_TARGET}/"
  else
    log "WARNING: BACKUP_S3_TARGET set but the mc client is not installed — local copy only"
  fi
else
  log "WARNING: no BACKUP_S3_TARGET configured — this backup exists only on this host"
fi

# ---------------------------------------------------------------------------
# 5. Retention — only after a successful, verified, encrypted backup
# ---------------------------------------------------------------------------
log "pruning backups older than ${RETENTION_DAYS} days"
# Both naming schemes are matched. Backups written before the rename are still
# perfectly restorable, and a retention pass that could not see them would
# either keep them forever or — worse, if the glob were simply replaced — leave
# them out of the "how many backups do we have" count that the operator reads.
for pattern in 'truckai_*.dump.gpg' 'truckcontrol-*.dump.gpg'; do
  find "$BACKUP_DIR" -name "$pattern" -mtime "+${RETENTION_DAYS}" -print -delete
  find "$BACKUP_DIR" -name "${pattern}.sha256" -mtime "+${RETENTION_DAYS}" -delete
done
find "$BACKUP_DIR" -name '.*.partial' -mtime +1 -delete

REMAINING="$(find "$BACKUP_DIR" \( -name 'truckai_*.dump.gpg' -o -name 'truckcontrol-*.dump.gpg' \) | wc -l)"
log "done — ${REMAINING} backups retained"
