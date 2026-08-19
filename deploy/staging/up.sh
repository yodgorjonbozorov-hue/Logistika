#!/usr/bin/env bash
#
# Brings up a real staging environment — PostgreSQL, Redis, MinIO, the built
# API and the built web bundle behind nginx with TLS — and leaves it running
# for `deploy/smoke-test.sh`.
#
# Nothing here is a simulation: the API is `node dist/main.js` with
# NODE_ENV=production, migrations are applied with `prisma migrate deploy`,
# and the edge is the production nginx configuration with the two staging
# substitutions documented in nginx.staging.conf.
#
# It refuses to run against a database whose name does not end in _staging, so
# a stray DATABASE_URL cannot point it at production.
set -euo pipefail

ROOT="${STAGING_ROOT:-/tmp/truckcontrol-staging}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_PORT="${API_PORT:-3100}"
ENV_FILE="${ENV_FILE:-$ROOT/.env.staging}"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31mFAIL\033[0m %s\n' "$*" >&2; exit 1; }

mkdir -p "$ROOT"/{logs,tmp,certs,minio-data}

# --------------------------------------------------------------------------
# 1. Configuration
# --------------------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  log "generating $ENV_FILE with fresh secrets"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
API_PORT=$API_PORT
DATABASE_URL=postgresql://tc_staging:$(openssl rand -hex 12)@127.0.0.1:5432/truckcontrol_staging?schema=public
REDIS_URL=redis://127.0.0.1:6379/3
JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_REFRESH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
WEB_URL=https://staging.truckcontrol.local
TRUST_PROXY=1
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9100
MINIO_ROOT_USER=tcstaging
MINIO_ROOT_PASSWORD=$(openssl rand -hex 16)
MINIO_BUCKET=truckcontrol-staging
MINIO_USE_SSL=false
EOF
  chmod 600 "$ENV_FILE"
fi
set -a; . "$ENV_FILE"; set +a

DB_NAME="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*/([^/?]+).*#\1#')"
[[ "$DB_NAME" == *_staging ]] || die "refusing to run against \"$DB_NAME\" — the database name must end in _staging"

# --------------------------------------------------------------------------
# 2. Dependencies must actually be reachable, not assumed
# --------------------------------------------------------------------------
log "checking PostgreSQL"
pg_isready -h 127.0.0.1 -p 5432 >/dev/null || die "PostgreSQL is not accepting connections"
log "checking Redis"
redis-cli -u "$REDIS_URL" ping >/dev/null || die "Redis is not answering PING"
log "checking MinIO"
curl -fsS "http://$MINIO_ENDPOINT:$MINIO_PORT/minio/health/live" -o /dev/null \
  || die "MinIO is not healthy on $MINIO_ENDPOINT:$MINIO_PORT"

# --------------------------------------------------------------------------
# 3. Build, migrate, seed
# --------------------------------------------------------------------------
log "building"
# VITE_API_URL is baked into the bundle at build time; without it the SPA would
# ask each visitor's own machine for data (vite.config.ts fails the build).
export VITE_API_URL="${VITE_API_URL:-https://api.staging.truckcontrol.local/api/v1}"
( cd "$REPO" && pnpm --filter shared build >/dev/null && pnpm --filter backend build >/dev/null \
  && pnpm --filter web build >/dev/null )

log "applying migrations"
( cd "$REPO/apps/backend" && npx prisma migrate deploy )

log "checking for drift"
( cd "$REPO/apps/backend" \
  && npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
       --to-schema-datamodel prisma/schema.prisma --script 2>/dev/null \
     | grep -q 'This is an empty migration' ) \
  || die "live schema has drifted from schema.prisma"

if [[ -n "${SUPERADMIN_PASSWORD:-}" ]]; then
  log "seeding the platform administrator"
  ( cd "$REPO/apps/backend" && npx prisma db seed )
fi

# --------------------------------------------------------------------------
# 4. TLS
# --------------------------------------------------------------------------
if [[ ! -f "$ROOT/certs/fullchain.pem" ]]; then
  log "issuing a self-signed certificate for the staging hostnames"
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
    -keyout "$ROOT/certs/privkey.pem" -out "$ROOT/certs/fullchain.pem" \
    -subj "/CN=staging.truckcontrol.local" \
    -addext "subjectAltName=DNS:staging.truckcontrol.local,DNS:api.staging.truckcontrol.local,IP:127.0.0.1" \
    2>/dev/null
fi

# --------------------------------------------------------------------------
# 5. Processes
# --------------------------------------------------------------------------
log "starting the API"
[[ -f "$ROOT/api.pid" ]] && kill "$(cat "$ROOT/api.pid")" 2>/dev/null || true
( cd "$REPO/apps/backend" && nohup node dist/main.js > "$ROOT/logs/api.log" 2>&1 & echo $! > "$ROOT/api.pid" )

for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null \
  || { tail -30 "$ROOT/logs/api.log"; die "the API did not become healthy"; }

log "starting nginx"
cp "$REPO/deploy/staging/security-headers.conf" "$ROOT/security-headers.conf"
sed -e "s#__ROOT__#$ROOT#g" \
    -e "s#__API_PORT__#$API_PORT#g" \
    -e "s#__WEB_ROOT__#$REPO/apps/web/dist#g" \
    "$REPO/deploy/staging/nginx.staging.conf" > "$ROOT/nginx.conf"
nginx -t -c "$ROOT/nginx.conf" -p "$ROOT" || die "nginx rejected the configuration"
[[ -f "$ROOT/nginx.pid" ]] && nginx -s quit -c "$ROOT/nginx.conf" -p "$ROOT" 2>/dev/null || true
sleep 1
# stdout/stderr go to a file: the daemonised master inherits whatever it is
# started with, and an inherited pipe keeps a caller like `up.sh | tail` open
# forever.
nginx -c "$ROOT/nginx.conf" -p "$ROOT" >> "$ROOT/logs/nginx.out" 2>&1

log "staging is up:"
printf '    web  https://staging.truckcontrol.local/\n'
printf '    api  https://api.staging.truckcontrol.local/api/v1/\n'
printf '    logs %s/logs/\n' "$ROOT"
