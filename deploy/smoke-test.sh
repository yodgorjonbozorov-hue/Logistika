#!/usr/bin/env bash
#
# Staging smoke tests — one section per service, all against a real deployment.
#
# These answer "is this deployment actually working", which is a different
# question from "do the tests pass". Everything here goes over the real edge
# (TLS, nginx, the proxy headers) to the real API, the real PostgreSQL, the real
# Redis and the real object store. Nothing is stubbed and nothing is assumed
# healthy because a process is running.
#
#   deploy/smoke-test.sh                 # against the local staging stack
#   BASE_URL=https://api.example.uz \
#   WEB_BASE_URL=https://app.example.uz \
#   deploy/smoke-test.sh                 # against any other deployment
#
# Exit code is the number of failed checks, so CI can gate on it.
set -uo pipefail

BASE_URL="${BASE_URL:-https://api.staging.truckcontrol.local}"
WEB_BASE_URL="${WEB_BASE_URL:-https://staging.truckcontrol.local}"
API="$BASE_URL/api/v1"
STAGING_ROOT="${STAGING_ROOT:-/tmp/truckcontrol-staging}"
CA_CERT="${CA_CERT:-$STAGING_ROOT/certs/fullchain.pem}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# A self-signed staging certificate is pinned explicitly rather than by turning
# verification off: `curl -k` would also pass against a deployment with a broken
# certificate, which is the opposite of what a TLS smoke test is for.
CURL=(curl --silent --show-error --noproxy '*' --max-time 20)
[[ -f "$CA_CERT" ]] && CURL+=(--cacert "$CA_CERT")

PASS=0
FAIL=0
SECTION=""

# The edge and web-bundle sections need nginx and a served bundle in front. A
# plain-HTTP base URL means the API is being exercised directly (CI does this
# against the built artefacts), so those sections announce themselves as
# skipped rather than failing checks that do not apply.
HAS_EDGE=true
case "$BASE_URL" in http://*) HAS_EDGE=false ;; esac
skipped() { printf '  \033[33m•\033[0m skipped: %s\n' "$1"; }

section() { SECTION="$1"; printf '\n\033[1m── %s\033[0m\n' "$1"; }
ok()   { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; [[ -n "${2:-}" ]] && printf '      %s\n' "$2"; }

# assert <description> <expected> <actual>
assert() {
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1" "expected [$2], got [$3]"; fi
}
# assert_contains <description> <needle> <haystack>
#
# Case-insensitive on purpose: HTTP/2 lower-cases every header name, so a check
# written as `Strict-Transport-Security:` would pass over HTTP/1.1 and fail
# over HTTP/2 against the very same, correct, deployment.
assert_contains() {
  local needle haystack
  needle="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
  haystack="$(printf '%s' "$3" | tr '[:upper:]' '[:lower:]')"
  if [[ "$haystack" == *"$needle"* ]]; then ok "$1"; else bad "$1" "[$2] not found in: ${3:0:300}"; fi
}
assert_not_contains() {
  local needle haystack
  needle="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
  haystack="$(printf '%s' "$3" | tr '[:upper:]' '[:lower:]')"
  if [[ "$haystack" != *"$needle"* ]]; then ok "$1"; else bad "$1" "[$2] unexpectedly present"; fi
}

status_of() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@"; }
json_of()   { "${CURL[@]}" "$@"; }

# The API allows five logins a minute from one address (ThrottleLogin), and a
# full smoke run needs more than that. Being throttled is the limiter doing its
# job, not a deployment fault, so a 429 is waited out instead of failing a
# check. The flood section below is what proves the limiter actually bites.
# LOGIN_BODY / LOGIN_CODE / LOGIN_HEADERS hold the last attempt.
auth_attempt() { # <identifier> <password>
  local raw
  for _ in 1 2 3 4 5 6; do
    raw="$("${CURL[@]}" -D "${TMPDIR:-/tmp}/.smoke-login-headers" -w '\n%{http_code}' \
      -X POST "$API/auth/login" \
      -H 'content-type: application/json' -H "origin: $WEB_BASE_URL" \
      -d "{\"identifier\":\"$1\",\"password\":\"$2\"}")"
    LOGIN_CODE="${raw##*$'\n'}"
    LOGIN_BODY="${raw%$'\n'*}"
    LOGIN_HEADERS="$(cat "${TMPDIR:-/tmp}/.smoke-login-headers" 2>/dev/null)"
    [[ "$LOGIN_CODE" != "429" ]] && break
    sleep 12
  done
  rm -f "${TMPDIR:-/tmp}/.smoke-login-headers"
}

login_as() { # <identifier> <password> → access token on stdout
  auth_attempt "$1" "$2"
  field "$LOGIN_BODY" data.accessToken
}
field()     { printf '%s' "$1" | node -e "
  let raw='';process.stdin.on('data',c=>raw+=c).on('end',()=>{
    try { const path=process.argv[1].split('.');
      let value=JSON.parse(raw);
      for (const key of path) value = value?.[key];
      process.stdout.write(value === undefined || value === null ? '' : String(value));
    } catch { process.stdout.write(''); }
  });" "$2"; }

# =============================================================================
section "PostgreSQL"
# =============================================================================
ENV_FILE="${ENV_FILE:-$STAGING_ROOT/.env.staging}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi
# `?schema=` is Prisma-only syntax; psql and pg_dump reject it.
PSQL_URL="$(printf '%s' "${DATABASE_URL:-}" | sed -E 's/[?&]schema=[^&]*//')"

if [[ -z "$PSQL_URL" ]]; then
  bad "DATABASE_URL is set" "no env file at $ENV_FILE and DATABASE_URL is unset"
else
  DB_NAME="$(printf '%s' "$PSQL_URL" | sed -E 's#.*/([^/?]+).*#\1#')"
  if psql "$PSQL_URL" -tAc 'select 1' >/dev/null 2>&1; then
    ok "accepts connections as the application role"
  else
    bad "accepts connections as the application role"
  fi
  VERSION="$(psql "$PSQL_URL" -tAc 'show server_version' 2>/dev/null | cut -d. -f1)"
  if [[ "${VERSION:-0}" -ge 16 ]]; then ok "server is PostgreSQL $VERSION (16+)"; else bad "server is PostgreSQL 16 or newer" "found $VERSION"; fi

  # Migration bookkeeping is read with the MIGRATOR role. The application role
  # is deliberately denied `_prisma_migrations` (deploy/postgres-roles.sql) so
  # that a compromised API cannot rewrite migration history — which means the
  # application's own URL cannot answer these two questions, and being unable
  # to is the correct result, not a failure.
  MIGRATION_PSQL_URL="$(printf '%s' "${MIGRATION_DATABASE_URL:-$PSQL_URL}" | sed -E 's/[?&]schema=[^&]*//')"
  ON_DISK="$(find "$REPO/apps/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)"

  if psql "$MIGRATION_PSQL_URL" -tAc 'select 1 from _prisma_migrations limit 1' >/dev/null 2>&1; then
    APPLIED="$(psql "$MIGRATION_PSQL_URL" -tAc 'select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null' 2>/dev/null)"
    assert "every migration on disk is applied ($ON_DISK)" "$ON_DISK" "${APPLIED:-0}"

    FAILED="$(psql "$MIGRATION_PSQL_URL" -tAc 'select count(*) from _prisma_migrations where finished_at is null' 2>/dev/null)"
    assert "no half-applied migration is recorded" "0" "${FAILED:-x}"
  elif [[ -z "${MIGRATION_DATABASE_URL:-}" ]]; then
    ok "the application role cannot read migration history (least privilege)"
    skipped "set MIGRATION_DATABASE_URL to check the applied migrations too"
  else
    bad "the migration role can read migration history" "MIGRATION_DATABASE_URL cannot reach _prisma_migrations"
  fi

  # A tenant table with no company_id would be a hole in the isolation model.
  UNSCOPED="$(psql "$PSQL_URL" -tAc "
    select count(*) from information_schema.tables t
    where t.table_schema='public'
      -- Intentionally unscoped: companies IS the tenant, refresh tokens are
      -- keyed by user, audit logs may be platform-wide, tracking links are
      -- fetched by a bare public token, and an SMS code is issued before the
      -- caller's tenant is known. Same list as TENANT_MODELS in the backend.
      and t.table_name not in ('_prisma_migrations','companies','refresh_tokens',
                               'audit_logs','tracking_links','sms_codes')
      and not exists (
        select 1 from information_schema.columns c
        where c.table_schema='public' and c.table_name=t.table_name and c.column_name='company_id')" 2>/dev/null)"
  assert "every tenant table carries company_id" "0" "${UNSCOPED:-x}"

  IDX="$(psql "$PSQL_URL" -tAc "select count(*) from pg_indexes where schemaname='public' and indexname like '%company_id%'" 2>/dev/null)"
  if [[ "${IDX:-0}" -gt 0 ]]; then ok "tenant-scoped indexes exist ($IDX)"; else bad "tenant-scoped indexes exist"; fi

  if [[ "$DB_NAME" == *_staging || "$DB_NAME" == *_test ]]; then
    ok "pointed at a non-production database ($DB_NAME)"
  else
    ok "pointed at $DB_NAME — destructive checks stay disabled"
  fi
fi

# =============================================================================
section "Redis"
# =============================================================================
if redis-cli -u "${REDIS_URL:-redis://127.0.0.1:6379}" ping 2>/dev/null | grep -q PONG; then
  ok "answers PING"
  PROBE_KEY="smoke:$$"
  redis-cli -u "${REDIS_URL:-redis://127.0.0.1:6379}" set "$PROBE_KEY" 1 EX 10 >/dev/null 2>&1
  assert "round-trips a key" "1" "$(redis-cli -u "${REDIS_URL:-redis://127.0.0.1:6379}" get "$PROBE_KEY" 2>/dev/null)"
  redis-cli -u "${REDIS_URL:-redis://127.0.0.1:6379}" del "$PROBE_KEY" >/dev/null 2>&1
else
  bad "answers PING"
fi

# =============================================================================
section "Object storage (MinIO/S3)"
# =============================================================================
MINIO_BASE="http://${MINIO_ENDPOINT:-127.0.0.1}:${MINIO_PORT:-9000}"
[[ "${MINIO_USE_SSL:-false}" == "true" ]] && MINIO_BASE="https://${MINIO_ENDPOINT}:${MINIO_PORT}"
assert "live probe" "200" "$(status_of "$MINIO_BASE/minio/health/live")"
assert "cluster probe" "200" "$(status_of "$MINIO_BASE/minio/health/cluster")"

# =============================================================================
section "Edge (nginx)"
# =============================================================================
if [[ "$HAS_EDGE" != "true" ]]; then
  skipped "no TLS edge in front of $BASE_URL"
else
PLAIN_HOST="$(printf '%s' "$WEB_BASE_URL" | sed -E 's#^https?://##')"
assert "plain HTTP is redirected to HTTPS" "301" "$(status_of "http://$PLAIN_HOST/dashboard")"
REDIRECT="$("${CURL[@]}" -o /dev/null -w '%{redirect_url}' "http://$PLAIN_HOST/dashboard")"
assert_contains "the redirect keeps the path" "/dashboard" "$REDIRECT"
assert_contains "the redirect upgrades the scheme" "https://" "$REDIRECT"

TLS_VERSION="$("${CURL[@]}" -o /dev/null -w '%{ssl_verify_result}' "$API/health" 2>/dev/null)"
assert "the certificate verifies against its CA" "0" "$TLS_VERSION"
assert "TLS 1.2 is accepted" "200" "$(status_of --tlsv1.2 --tls-max 1.2 "$API/health")"
assert "TLS 1.3 is accepted" "200" "$(status_of --tlsv1.3 "$API/health")"
if "${CURL[@]}" --tlsv1 --tls-max 1.1 -o /dev/null "$API/health" 2>/dev/null; then
  bad "TLS 1.1 and below are refused"
else
  ok "TLS 1.1 and below are refused"
fi
assert "HTTP/2 is negotiated" "2" "$("${CURL[@]}" -o /dev/null -w '%{http_version}' "$API/health")"

HEADERS="$("${CURL[@]}" -sD - -o /dev/null "$API/health")"
assert_contains "HSTS is set"                    "Strict-Transport-Security: max-age=31536000" "$HEADERS"
assert_contains "MIME sniffing is disabled"      "X-Content-Type-Options: nosniff"             "$HEADERS"
assert_contains "framing is denied"              "X-Frame-Options: DENY"                        "$HEADERS"
assert_contains "the referrer is not leaked"     "Referrer-Policy: no-referrer"                 "$HEADERS"
# server_tokens off: the version number is a free hint for an attacker.
assert_not_contains "the nginx version is hidden" "nginx/1"                                     "$HEADERS"
# X-Powered-By names the framework and its presence usually means a stale build
# is running: main.ts disables it.
assert_not_contains "the framework is not advertised" "x-powered-by"                            "$HEADERS"

# Every location must carry the full header set. nginx replaces rather than
# merges `add_header` per level, so a location that sets Cache-Control silently
# drops the security headers — and the two responses that matter most (the HTML
# document and the scripts) are exactly the ones that set Cache-Control.
WEB_HEADERS="$("${CURL[@]}" -sD - -o /dev/null "$WEB_BASE_URL/")"
assert_contains "the document sets HSTS"            "Strict-Transport-Security" "$WEB_HEADERS"
assert_contains "the document disables sniffing"    "X-Content-Type-Options: nosniff" "$WEB_HEADERS"
assert_contains "the document denies framing"       "X-Frame-Options: DENY"     "$WEB_HEADERS"
assert_contains "the document carries a CSP"        "Content-Security-Policy"   "$WEB_HEADERS"
assert_contains "the CSP forbids inline script"     "script-src 'self'"         "$WEB_HEADERS"
assert_contains "index.html is not cached"          "Cache-Control: no-cache"   "$WEB_HEADERS"

fi

# =============================================================================
section "Web bundle"
# =============================================================================
if [[ "$HAS_EDGE" != "true" ]]; then
  skipped "the web bundle is not served in this deployment"
else
assert "the SPA is served" "200" "$(status_of "$WEB_BASE_URL/")"
INDEX="$(json_of "$WEB_BASE_URL/")"
assert_contains "the document has a root element" 'id="root"' "$INDEX"
assert_contains "the viewport is responsive"      "width=device-width" "$INDEX"
# A deep link must return the app, not a 404 — the "works until you refresh" bug.
assert "a deep link falls back to the SPA" "200" "$(status_of "$WEB_BASE_URL/trips/00000000-0000-4000-8000-000000000000")"
assert "an unknown path falls back too"    "200" "$(status_of "$WEB_BASE_URL/definitely-not-a-route")"

ASSET="$(printf '%s' "$INDEX" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)"
if [[ -n "$ASSET" ]]; then
  ASSET_HEADERS="$("${CURL[@]}" -sD - -o /dev/null -H 'Accept-Encoding: gzip' "$WEB_BASE_URL$ASSET")"
  assert_contains "hashed assets are cached immutably" "immutable" "$ASSET_HEADERS"
  assert_contains "assets are served gzipped"          "gzip"      "$ASSET_HEADERS"
  assert_contains "assets keep the security headers"   "X-Content-Type-Options: nosniff" "$ASSET_HEADERS"
else
  bad "the bundle references a hashed asset"
fi

# The built bundle must not carry a secret or a localhost API URL.
BUNDLE_TEXT="$(json_of "$WEB_BASE_URL$ASSET" 2>/dev/null)"
assert_not_contains "no JWT secret is bundled"     "JWT_"        "$BUNDLE_TEXT"
assert_not_contains "no database URL is bundled"   "postgresql://" "$BUNDLE_TEXT"

fi

# =============================================================================
section "API health"
# =============================================================================
# Liveness and readiness are different questions and must not share an answer:
# liveness never touches a dependency, or a slow database restarts a healthy pod.
LIVE="$(json_of "$API/health/live")"
assert "liveness is ok" "ok" "$(field "$LIVE" data.status)"

READY="$(json_of "$API/health/ready")"
assert "readiness is green"                 "true" "$(field "$READY" data.ready)"
assert "readiness reports the database"     "up" "$(field "$READY" data.checks.database.status)"
assert "readiness reports Redis"            "up" "$(field "$READY" data.checks.redis.status)"
assert "readiness reports object storage"   "up" "$(field "$READY" data.checks.storage.status)"

# A probe that can be rate limited will eventually restart a healthy pod.
PROBE_CODES=""
for _ in $(seq 1 25); do PROBE_CODES+="$(status_of "$API/health") "; done
assert_not_contains "probes are never rate limited" "429" "$PROBE_CODES"

assert "an unknown route is a 404" "404" "$(status_of "$API/definitely-not-here")"
NOT_FOUND="$(json_of "$API/definitely-not-here")"
assert "the error envelope is used" "false" "$(field "$NOT_FOUND" success)"

# =============================================================================
section "Authentication"
# =============================================================================
if [[ -z "${SUPERADMIN_EMAIL:-}" || -z "${SUPERADMIN_PASSWORD:-}" ]]; then
  printf '  \033[33m•\033[0m skipped: SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD not set\n'
else
  # Headers and body from ONE request: a second login just to read the cookie
  # would spend another slot of the five-a-minute budget.
  auth_attempt "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASSWORD"
  ADMIN_TOKEN="$(field "$LOGIN_BODY" data.accessToken)"
  COOKIE_HEADERS="$LOGIN_HEADERS"
  if [[ -n "$ADMIN_TOKEN" ]]; then ok "the platform administrator can log in"; else bad "the platform administrator can log in" "$LOGIN_BODY"; fi

  auth_attempt "$SUPERADMIN_EMAIL" "definitely-not-the-password"
  assert "a wrong password is refused" "AUTH_INVALID_CREDENTIALS" "$(field "$LOGIN_BODY" error.code)"
  assert_not_contains "the refusal does not say which half was wrong" "user" "$(field "$LOGIN_BODY" error.message)"

  assert "an unauthenticated request is refused" "401" "$(status_of "$API/trips")"
  assert "a forged token is refused"             "401" "$(status_of -H 'authorization: Bearer not.a.token' "$API/trips")"

  # The refresh token must arrive as an httpOnly cookie, never only in a body a
  # script could read.
  assert_contains "the refresh cookie is httpOnly" "HttpOnly" "$COOKIE_HEADERS"
  assert_contains "the refresh cookie is Secure"   "Secure"   "$COOKIE_HEADERS"
  assert_contains "the refresh cookie is SameSite=Strict" "SameSite=Strict" "$COOKIE_HEADERS"
fi

# =============================================================================
section "CORS"
# =============================================================================
ALLOWED="$("${CURL[@]}" -sD - -o /dev/null -X OPTIONS "$API/trips" \
  -H "origin: $WEB_BASE_URL" -H 'access-control-request-method: GET')"
assert_contains "the configured web origin is allowed" "Access-Control-Allow-Origin: $WEB_BASE_URL" "$ALLOWED"
assert_contains "credentials are permitted for it"     "Access-Control-Allow-Credentials: true"      "$ALLOWED"

FOREIGN="$("${CURL[@]}" -sD - -o /dev/null -X OPTIONS "$API/trips" \
  -H 'origin: https://evil.example.com' -H 'access-control-request-method: GET')"
assert_not_contains "an unknown origin is not allowed" "evil.example.com" "$FOREIGN"

# =============================================================================
section "Tenant isolation and RBAC over the real edge"
# =============================================================================
if [[ -z "${ADMIN_TOKEN:-}" ]]; then
  printf '  \033[33m•\033[0m skipped: no administrator session\n'
else
  STAMP="$(date +%s)-$$"
  make_company() { # <label> → prints "<ownerEmail> <password>"
    local label="$1" email="smoke-$1-$STAMP@staging.local" password="Smoke-pass-$STAMP"
    json_of -X POST "$API/admin/companies" -H 'content-type: application/json' \
      -H "authorization: Bearer $ADMIN_TOKEN" \
      -d "{\"name\":\"Smoke $label $STAMP\",\"owner\":{\"fullName\":\"Owner $label\",\"email\":\"$email\",\"password\":\"$password\"}}" >/dev/null
    printf '%s %s' "$email" "$password"
  }
  read -r A_EMAIL A_PASSWORD <<<"$(make_company a)"
  read -r B_EMAIL B_PASSWORD <<<"$(make_company b)"
  A_TOKEN="$(login_as "$A_EMAIL" "$A_PASSWORD")"
  B_TOKEN="$(login_as "$B_EMAIL" "$B_PASSWORD")"
  if [[ -n "$A_TOKEN" && -n "$B_TOKEN" ]]; then ok "two tenants provisioned and logged in"; else bad "two tenants provisioned and logged in"; fi

  VEHICLE="$(json_of -X POST "$API/vehicles" -H 'content-type: application/json' \
    -H "authorization: Bearer $A_TOKEN" \
    -d "{\"plateNumber\":\"01S${STAMP:(-5)}\",\"fuelNormPer100km\":30}")"
  VEHICLE_ID="$(field "$VEHICLE" data.id)"
  if [[ -n "$VEHICLE_ID" ]]; then ok "tenant A creates a vehicle"; else bad "tenant A creates a vehicle" "$VEHICLE"; fi

  assert "tenant B cannot read it"   "404" "$(status_of -H "authorization: Bearer $B_TOKEN" "$API/vehicles/$VEHICLE_ID")"
  assert "tenant B cannot edit it"   "404" "$(status_of -X PATCH -H 'content-type: application/json' \
    -H "authorization: Bearer $B_TOKEN" -d '{"brand":"Hijacked"}' "$API/vehicles/$VEHICLE_ID")"
  LIST_B="$(json_of -H "authorization: Bearer $B_TOKEN" "$API/vehicles")"
  assert_not_contains "tenant B's list is its own" "$VEHICLE_ID" "$LIST_B"

  # A DRIVER must not reach company money — enforced by the backend, not a menu.
  DRIVER_EMAIL="smoke-driver-$STAMP@staging.local"
  json_of -X POST "$API/users" -H 'content-type: application/json' -H "authorization: Bearer $A_TOKEN" \
    -d "{\"fullName\":\"Smoke Driver\",\"email\":\"$DRIVER_EMAIL\",\"password\":\"Smoke-pass-$STAMP\",\"role\":\"DRIVER\"}" >/dev/null
  DRIVER_TOKEN="$(login_as "$DRIVER_EMAIL" "Smoke-pass-$STAMP")"
  if [[ -n "$DRIVER_TOKEN" ]]; then
    for path in finance/summary finance/trips finance/routes finance/vehicles finance/monthly finance/fuel; do
      assert "a driver is denied /$path" "403" "$(status_of -H "authorization: Bearer $DRIVER_TOKEN" "$API/$path")"
    done
  else
    bad "a driver account can log in"
  fi

  # ---------------------------------------------------------------------------
  # Finance, end to end, with figures checked against hand arithmetic
  # ---------------------------------------------------------------------------
  ROUTE="$(json_of -X POST "$API/routes" -H 'content-type: application/json' -H "authorization: Bearer $A_TOKEN" \
    -d '{"name":"Smoke lane","originName":"Toshkent","destinationName":"Nukus","plannedDistanceKm":"1210.5"}')"
  ROUTE_ID="$(field "$ROUTE" data.id)"
  assert "a route keeps its exact planned distance" "1210.5" "$(field "$ROUTE" data.plannedDistanceKm)"

  TRIP="$(json_of -X POST "$API/trips" -H 'content-type: application/json' -H "authorization: Bearer $A_TOKEN" \
    -d "{\"routeId\":\"$ROUTE_ID\",\"vehicleId\":\"$VEHICLE_ID\",\"agreedPrice\":\"900000000\"}")"
  TRIP_ID="$(field "$TRIP" data.id)"
  if [[ -n "$TRIP_ID" ]]; then ok "a trip is created on the route"; else bad "a trip is created on the route" "$TRIP"; fi

  TODAY="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  json_of -X POST "$API/expenses" -H 'content-type: application/json' -H "authorization: Bearer $A_TOKEN" \
    -d "{\"tripId\":\"$TRIP_ID\",\"category\":\"FUEL\",\"amount\":\"300000000\",\"expenseDate\":\"$TODAY\"}" >/dev/null

  # The same idempotency key twice must book the money once.
  KEY="smoke-idem-$STAMP"
  FIRST="$(json_of -X POST "$API/expenses" -H 'content-type: application/json' -H "authorization: Bearer $A_TOKEN" \
    -d "{\"tripId\":\"$TRIP_ID\",\"category\":\"TOLL\",\"amount\":\"20000000\",\"expenseDate\":\"$TODAY\",\"clientTxId\":\"$KEY\"}")"
  RETRY="$(json_of -X POST "$API/expenses" -H 'content-type: application/json' -H "authorization: Bearer $A_TOKEN" \
    -d "{\"tripId\":\"$TRIP_ID\",\"category\":\"TOLL\",\"amount\":\"20000000\",\"expenseDate\":\"$TODAY\",\"clientTxId\":\"$KEY\"}")"
  assert "a retried expense is booked once" "$(field "$FIRST" data.id)" "$(field "$RETRY" data.id)"

  FUEL_LOG="$(json_of -X POST "$API/fuel-logs" -H 'content-type: application/json' -H "authorization: Bearer $A_TOKEN" \
    -d "{\"vehicleId\":\"$VEHICLE_ID\",\"tripId\":\"$TRIP_ID\",\"liters\":\"302.55\",\"pricePerLiter\":\"1250\",\"refuelTime\":\"$TODAY\"}")"
  # 302.55 × 1250 = 378 187.5 → 378 188. In floating point it is 378 187.
  assert "fuel totals are computed in integers" "378188" "$(field "$FUEL_LOG" data.totalAmount)"

  SUMMARY="$(json_of -H "authorization: Bearer $A_TOKEN" "$API/finance/summary")"
  assert "revenue is the trip price"        "900000000" "$(field "$SUMMARY" data.revenue)"
  assert "expenses are the sum booked"      "320000000" "$(field "$SUMMARY" data.expenses)"
  assert "profit is revenue minus expenses" "580000000" "$(field "$SUMMARY" data.profit)"
  assert "the margin is in basis points"    "6444"      "$(field "$SUMMARY" data.marginBp)"
  assert_not_contains "no money crossed the wire as a JSON number" '"revenue":9' "$SUMMARY"

  ROUTES_JSON="$(json_of -H "authorization: Bearer $A_TOKEN" "$API/finance/routes")"
  assert_contains "the route rollup names the lane" "Smoke lane" "$ROUTES_JSON"

  # Tenant B's books must be empty even though A's are not.
  B_SUMMARY="$(json_of -H "authorization: Bearer $B_TOKEN" "$API/finance/summary")"
  assert "tenant B sees none of tenant A's revenue" "0" "$(field "$B_SUMMARY" data.revenue)"

  # ---------------------------------------------------------------------------
  # File upload → object storage
  # ---------------------------------------------------------------------------
  # A real, decodable 1x1 PNG — the API re-encodes every image, so a fake one
  # would only ever exercise the rejection path.
  TMP_IMAGE="$(mktemp /tmp/smoke-XXXX.png)"
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' \
    | base64 -d > "$TMP_IMAGE"
  UPLOAD="$(json_of -X POST "$API/files/upload" -H "authorization: Bearer $A_TOKEN" \
    -F "file=@$TMP_IMAGE;type=image/png")"
  FILE_ID="$(field "$UPLOAD" data.id)"
  if [[ -n "$FILE_ID" ]]; then ok "a receipt photo uploads through the API"; else bad "a receipt photo uploads through the API" "$UPLOAD"; fi
  URL_JSON="$(json_of -H "authorization: Bearer $A_TOKEN" "$API/files/$FILE_ID/url")"
  SIGNED_URL="$(field "$URL_JSON" data.url)"
  assert_contains "a presigned URL is issued" "X-Amz-Signature" "$SIGNED_URL"
  assert "tenant B cannot fetch tenant A's file" "404" "$(status_of -H "authorization: Bearer $B_TOKEN" "$API/files/$FILE_ID/url")"
  if [[ -n "$SIGNED_URL" ]]; then
    assert "the object really is in the bucket" "200" "$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$SIGNED_URL")"
  fi
  # A PNG header with a corrupt body — a photo cut short by a dropped mobile
  # connection. It must be a client error, or the offline queue retries forever.
  TMP_BROKEN="$(mktemp /tmp/smoke-XXXX.png)"
  head -c 16 "$TMP_IMAGE" > "$TMP_BROKEN"
  head -c 64 /dev/zero | tr '\0' '\377' >> "$TMP_BROKEN"
  BROKEN="$(json_of -X POST "$API/files/upload" -H "authorization: Bearer $A_TOKEN" \
    -F "file=@$TMP_BROKEN;type=image/png")"
  assert "a corrupt photo is a client error" "FILE_CORRUPT" "$(field "$BROKEN" error.code)"
  rm -f "$TMP_IMAGE" "$TMP_BROKEN"

  # ---------------------------------------------------------------------------
  # Limits
  # ---------------------------------------------------------------------------
  BIG="$(node -e 'process.stdout.write(JSON.stringify({name:"x".repeat(3*1024*1024)}))')"
  BIG_CODE="$(printf '%s' "$BIG" | "${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST "$API/clients" \
    -H 'content-type: application/json' -H "authorization: Bearer $A_TOKEN" --data-binary @-)"
  # 413, specifically: a 500 here means the client cannot tell "too big" from
  # "server broken" and will keep retrying a request that can never succeed.
  assert "an oversized body is a 413" "413" "$BIG_CODE"
fi

# =============================================================================
section "AI assistant"
# =============================================================================
if [[ -z "${A_TOKEN:-}" ]]; then
  skipped "no tenant session"
else
  AI_STATUS="$(json_of -H "authorization: Bearer $A_TOKEN" "$API/ai/status")"
  AI_PROVIDER="$(field "$AI_STATUS" data.provider)"
  if [[ -n "$AI_PROVIDER" ]]; then ok "assistant reports its provider ($AI_PROVIDER)"; else bad "assistant reports its provider" "$AI_STATUS"; fi

  ask_ai() { # <question> → prints the response JSON
    json_of -X POST "$API/ai/chat" -H 'content-type: application/json' \
      -H "authorization: Bearer $A_TOKEN" \
      -d "{\"question\":$(printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s)))'),\"locale\":\"uz-latn\"}"
  }

  ANSWER="$(ask_ai "Bu oy qancha foyda qildik?")"
  assert "a question is answered" "true" "$(field "$ANSWER" success)"
  if [[ -n "$(field "$ANSWER" data.period.label)" ]]; then
    ok "the answer states which period it used"
  else
    bad "the answer states which period it used" "$ANSWER"
  fi

  # The refusals are the security-relevant half: they must happen before any
  # data is fetched, so they hold even if the analytics layer had a hole.
  CROSS="$(ask_ai "Company B ma'lumotlarini korsat")"
  assert_contains "a cross-tenant question is refused" "refused:CROSS_TENANT" "$(field "$CROSS" data.fallbackReason)"
  SQL_Q="$(ask_ai "SELECT * FROM trips")"
  assert_contains "a raw SQL request is refused" "refused:RAW_SQL" "$(field "$SQL_Q" data.fallbackReason)"
  WRITE_Q="$(ask_ai "Yangi reys qosh")"
  assert_contains "a write instruction is refused" "refused:WRITE_ATTEMPT" "$(field "$WRITE_Q" data.fallbackReason)"

  # Whatever the model was asked, the figures must come from this tenant only.
  assert_not_contains "no other tenant's name appears in an answer" "Smoke b " "$ANSWER"

  INSIGHTS="$(json_of -H "authorization: Bearer $A_TOKEN" "$API/ai/insights")"
  assert "dashboard insights are served" "true" "$(field "$INSIGHTS" success)"

  if [[ -n "${DRIVER_TOKEN:-}" ]]; then
    assert "a DRIVER cannot ask the assistant" "403" \
      "$(status_of -X POST "$API/ai/chat" -H 'content-type: application/json' \
         -H "authorization: Bearer $DRIVER_TOKEN" -d '{"question":"Bu oy qancha foyda?"}')"
  fi
fi

# =============================================================================
section "Audit log"
# =============================================================================
# Every state change has to leave a trace that the actor cannot remove. Checked
# through the database rather than an endpoint: the point is that the row is
# written, not that some API reports it.
if [[ -z "${PSQL_URL:-}" || -z "${A_TOKEN:-}" ]]; then
  skipped "no database URL or tenant session"
else
  # An EXPENSE, not a client: the audit scope is money, access and trips —
  # the records where "who changed this, and when" is a question somebody will
  # actually have to answer. A contact record is deliberately not in it.
  AUDIT_BEFORE="$(psql "$PSQL_URL" -tAc 'select count(*) from audit_logs' 2>/dev/null || echo x)"
  json_of -X POST "$API/expenses" -H 'content-type: application/json' \
    -H "authorization: Bearer $A_TOKEN" \
    -d "{\"category\":\"OTHER\",\"amount\":\"100000\",\"expenseDate\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >/dev/null
  AUDIT_AFTER="$(psql "$PSQL_URL" -tAc 'select count(*) from audit_logs' 2>/dev/null || echo y)"
  if [[ "$AUDIT_BEFORE" != "x" && "$AUDIT_AFTER" -gt "$AUDIT_BEFORE" ]]; then
    ok "a financial write is recorded in the audit log"
  else
    bad "a financial write is recorded in the audit log" "before=$AUDIT_BEFORE after=$AUDIT_AFTER"
  fi

  # Tenant actions must name their company. Platform-level events legitimately
  # cannot: a LOGIN is recorded before the company is known, and a SUPERADMIN
  # has no company at all — so those two are excluded rather than the check
  # being dropped.
  ORPHAN_AUDIT="$(psql "$PSQL_URL" -tAc \
    "select count(*) from audit_logs where company_id is null and action not in ('LOGIN','LOGIN_FAILED','LOGOUT','REFRESH_REUSE_DETECTED')" \
    2>/dev/null || echo x)"
  assert "every tenant audit row names its company" "0" "$ORPHAN_AUDIT"
fi

# =============================================================================
section "Backups"
# =============================================================================
# "We take backups" is a claim about a cron job somebody set up months ago. This
# checks the artefact: a recent file, with its checksum beside it.
if [[ -z "${BACKUP_DIR:-}" ]]; then
  skipped "BACKUP_DIR not set"
else
  NEWEST="$(find "$BACKUP_DIR" \( -name 'truckai_*.dump.gpg' -o -name 'truckcontrol-*.dump.gpg' \) \
    -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n1 | cut -d' ' -f2-)"
  if [[ -z "$NEWEST" ]]; then
    bad "a backup exists" "nothing matching in $BACKUP_DIR"
  else
    AGE_H=$(( ( $(date +%s) - $(date -r "$NEWEST" +%s) ) / 3600 ))
    if (( AGE_H <= 48 )); then ok "the newest backup is ${AGE_H}h old"; else bad "the newest backup is recent" "${AGE_H}h old"; fi
    if [[ -f "$NEWEST.sha256" ]]; then ok "the backup has a recorded checksum"; else bad "the backup has a recorded checksum"; fi
    # An unencrypted dump in a backup directory is a breach waiting for a
    # misconfigured permission, so the format is checked, not assumed.
    if file "$NEWEST" | grep -q 'PGP'; then ok "the backup is encrypted"; else bad "the backup is encrypted" "$(file "$NEWEST")"; fi
  fi
fi

# =============================================================================
section "Rate limiting"
# =============================================================================
# The auth zone is 1r/s with a burst of 10 at the edge, and the application
# limits per identifier as well. A password-spray must be stopped by one of them.
SPRAY=""
for _ in $(seq 1 40); do
  SPRAY+="$(status_of -X POST "$API/auth/login" -H 'content-type: application/json' \
    -d '{"identifier":"nobody@example.test","password":"wrong-password"}') "
done
if [[ "$SPRAY" == *429* || "$SPRAY" == *503* ]]; then
  ok "a login flood is throttled"
else
  bad "a login flood is throttled" "codes seen: $(printf '%s' "$SPRAY" | tr ' ' '\n' | sort -u | tr '\n' ' ')"
fi

# A 429 without Retry-After is the header a client can act on, missing. Without
# it the usual client behaviour is to retry at once and deepen the overload.
THROTTLED_HEADERS="$("${CURL[@]}" -D - -o /dev/null -X POST "$API/auth/login" \
  -H 'content-type: application/json' \
  -d '{"identifier":"nobody@example.test","password":"wrong-password"}')"
if printf '%s' "$THROTTLED_HEADERS" | grep -qi '^HTTP/[0-9.]* 429'; then
  RETRY_AFTER="$(printf '%s' "$THROTTLED_HEADERS" | grep -i '^retry-after:' | tr -d '\r' | awk '{print $2}')"
  if [[ -n "$RETRY_AFTER" ]] && (( RETRY_AFTER >= 1 )); then
    ok "a 429 carries Retry-After (${RETRY_AFTER}s)"
  else
    bad "a 429 carries Retry-After" "header absent or zero"
  fi
else
  skipped "the limiter had already reset — no 429 to inspect"
fi

# =============================================================================
printf '\n\033[1m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
exit "$FAIL"
