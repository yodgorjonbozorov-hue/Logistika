#!/bin/sh
# Refuses a production env file that was copied from the template and not
# finished.
#
#   sh deploy/check-production-env.sh /etc/truckai/.env.production
#
# The API applies most of these rules itself at boot (apps/backend/src/config/
# env.validation.ts). This script exists because "the API refuses to start" is
# a bad place to discover a typo: run it before the deploy, on the machine that
# holds the real file, and get every problem in one list.
#
# It reads the file; it never prints a secret's value.
set -eu

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "usage: sh deploy/check-production-env.sh <path-to-.env.production>" >&2
  exit 2
fi
if [ ! -f "$FILE" ]; then
  echo "no such file: $FILE" >&2
  exit 2
fi

PROBLEMS=0
fail() { echo "  FAIL  $*"; PROBLEMS=$((PROBLEMS + 1)); }
warn() { echo "  WARN  $*"; }
ok()   { echo "  ok    $*"; }

# Reads one key without sourcing the file — sourcing an untrusted env file
# executes whatever is in it.
get() { sed -n "s/^$1=//p" "$FILE" | head -n1 | sed 's/[[:space:]]*$//'; }

echo "TruckAI production environment check: $FILE"
echo

# ---------------------------------------------------------------------------
# 1. File permissions — this file is every credential the system has
# ---------------------------------------------------------------------------
MODE="$(stat -c '%a' "$FILE" 2>/dev/null || stat -f '%Lp' "$FILE" 2>/dev/null || echo '?')"
case "$MODE" in
  600|400) ok "permissions $MODE" ;;
  '?')     warn "could not read the file mode" ;;
  *)       fail "permissions $MODE — must be 600 (chmod 600 $FILE)" ;;
esac

# ---------------------------------------------------------------------------
# 2. Nothing left from the template
# ---------------------------------------------------------------------------
# Only the value side is scanned: a comment may legitimately say REPLACE_ME.
LEFTOVER="$(sed -n 's/^\([A-Z0-9_]*\)=.*\(REPLACE_ME\|change-me\|changeme\|replace-with\|placeholder\|example\.com\|yourdomain\).*/\1/p' "$FILE" || true)"
if [ -n "$LEFTOVER" ]; then
  for key in $LEFTOVER; do fail "$key still holds a template placeholder"; done
else
  ok "no template placeholders left"
fi

# ---------------------------------------------------------------------------
# 3. Required keys are present and non-empty
# ---------------------------------------------------------------------------
REQUIRED="NODE_ENV DATABASE_URL REDIS_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET WEB_URL MINIO_ENDPOINT MINIO_ROOT_USER MINIO_ROOT_PASSWORD MINIO_BUCKET TRUST_PROXY AI_PROVIDER"
for key in $REQUIRED; do
  if [ -z "$(get "$key")" ]; then fail "$key is missing or empty"; fi
done

# ---------------------------------------------------------------------------
# 4. The rules the API enforces at boot, checked here first
# ---------------------------------------------------------------------------
[ "$(get NODE_ENV)" = "production" ] || fail "NODE_ENV must be production (found: $(get NODE_ENV))"

WEB_URL="$(get WEB_URL)"
case "$WEB_URL" in
  https://*) ;;
  *) fail "WEB_URL must be https:// " ;;
esac
case "$WEB_URL" in
  *localhost*|*127.0.0.1*) fail "WEB_URL points at loopback — the browser cannot reach it" ;;
esac

ACCESS="$(get JWT_ACCESS_SECRET)"
REFRESH="$(get JWT_REFRESH_SECRET)"
[ "${#ACCESS}" -ge 32 ] || fail "JWT_ACCESS_SECRET is shorter than 32 characters"
[ "${#REFRESH}" -ge 32 ] || fail "JWT_REFRESH_SECRET is shorter than 32 characters"
[ "$ACCESS" != "$REFRESH" ] || fail "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are identical"

MINIO_PASS="$(get MINIO_ROOT_PASSWORD)"
[ "${#MINIO_PASS}" -ge 12 ] || fail "MINIO_ROOT_PASSWORD is shorter than 12 characters"

STORAGE_HOST="$(get MINIO_ENDPOINT)"
case "$STORAGE_HOST" in
  localhost|127.0.0.1|::1) ;;
  *) [ "$(get MINIO_USE_SSL)" = "true" ] ||
       fail "MINIO_USE_SSL must be true — $STORAGE_HOST is not loopback and the key would cross the network in clear text" ;;
esac

REDIS_URL="$(get REDIS_URL)"
case "$REDIS_URL" in
  *@*) ;;
  *localhost*|*127.0.0.1*) ;;
  *) fail "REDIS_URL has no credentials and is not loopback" ;;
esac

case "$(get TRUST_PROXY)" in
  0|1|2|3) ok "TRUST_PROXY set explicitly" ;;
  *) fail "TRUST_PROXY must be set explicitly (1 behind nginx, 0 when exposed directly)" ;;
esac

if [ "$(get AI_PROVIDER)" != "mock" ] && [ -z "$(get AI_API_KEY)" ]; then
  fail "AI_PROVIDER=$(get AI_PROVIDER) needs AI_API_KEY"
fi

# ---------------------------------------------------------------------------
# 5. Backups. Not required to boot; required to survive.
# ---------------------------------------------------------------------------
[ -n "$(get BACKUP_PASSPHRASE)" ] || fail "BACKUP_PASSPHRASE is empty — backup.sh refuses to write an unencrypted dump"
[ -n "$(get BACKUP_S3_TARGET)" ] ||
  warn "BACKUP_S3_TARGET is empty — backups will exist only on this host, so losing the host loses them"

# ---------------------------------------------------------------------------
# 6. The application database user must not be a superuser
# ---------------------------------------------------------------------------
if command -v psql >/dev/null 2>&1; then
  # Prisma's `?schema=public` is not a libpq parameter and psql rejects the
  # whole URI over it, so the query string is dropped for this probe.
  PSQL_URL="$(get DATABASE_URL | sed 's/?.*$//')"
  ROLE="$(psql "$PSQL_URL" -tAc \
    "select rolsuper::text || ' ' || rolcreatedb::text from pg_roles where rolname = current_user" \
    2>/dev/null || true)"
  case "$ROLE" in
    'false false') ok "database role is not a superuser and cannot create databases" ;;
    'true '*)      fail "the application database user is a SUPERUSER" ;;
    'false true')  warn "the application database user has CREATEDB (not needed at runtime)" ;;
    *)             warn "could not reach the database to check the role's privileges" ;;
  esac
else
  warn "psql not installed — skipped the database privilege check"
fi

echo
if [ "$PROBLEMS" -gt 0 ]; then
  echo "$PROBLEMS problem(s) — do not deploy with this file."
  exit 1
fi
echo "Environment file looks deployable."
