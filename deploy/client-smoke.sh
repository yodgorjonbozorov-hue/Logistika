#!/usr/bin/env bash
#
# TruckAI — the client's journey, against a real deployment.
#
#   BASE_URL=https://truckai.uz \
#   ADMIN_EMAIL=admin@truckai.uz ADMIN_PASSWORD='…' \
#   bash deploy/client-smoke.sh
#
# `deploy/smoke-test.sh` answers "is this deployment wired up correctly" —
# services, TLS, headers, isolation at the edge. This one answers a different
# question: "can the customer actually run their business on it today?" It walks
# the twenty things a logistics firm does on day one, in order, each step using
# what the previous one produced — a trip really is created on a vehicle that
# was really created, and the finance total really is the money that was really
# booked against it.
#
# It creates a throwaway company, so it is safe to run against production. It
# does not delete anything: the rows it makes are evidence, and a company with
# a name starting "SMOKE " is obviously not a customer.
#
# Exit code is the number of failed steps.
set -uo pipefail

BASE_URL="${BASE_URL:-https://truckai.local}"
API="$BASE_URL/api/v1"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
CA_CERT="${CA_CERT:-}"

CURL=(curl --silent --show-error --noproxy '*' --max-time 25)
if [[ -n "$CA_CERT" && -f "$CA_CERT" ]]; then CURL+=(--cacert "$CA_CERT"); else CURL+=(-k); fi

PASS=0; FAIL=0; STEP=0
ok()  { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %-2s %s\n' "$STEP." "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %-2s %s\n' "$STEP." "$1"; [[ -n "${2:-}" ]] && printf '        %s\n' "${2:0:220}"; }
step(){ STEP=$((STEP+1)); }

jq_get() { python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: print(''); sys.exit()
for k in '$1'.split('.'):
    if d is None: break
    d = d.get(k) if isinstance(d,dict) else (d[int(k)] if isinstance(d,list) and k.isdigit() and int(k)<len(d) else None)
print('' if d is None else d)"; }

api() { # api <method> <path> [json] [token]
  local method="$1" path="$2" body="${3:-}" token="${4:-}"
  local args=(-X "$method" "$API$path" -H 'content-type: application/json')
  [[ -n "$token" ]] && args+=(-H "authorization: Bearer $token")
  [[ -n "$body"  ]] && args+=(-d "$body")
  "${CURL[@]}" "${args[@]}"
}
code_of() { # same arguments, returns the status code
  local method="$1" path="$2" body="${3:-}" token="${4:-}"
  local args=(-o /dev/null -w '%{http_code}' -X "$method" "$API$path" -H 'content-type: application/json')
  [[ -n "$token" ]] && args+=(-H "authorization: Bearer $token")
  [[ -n "$body"  ]] && args+=(-d "$body")
  "${CURL[@]}" "${args[@]}"
}

# Login is limited to five attempts a minute, per user and at the edge. This
# script signs in as several people, so a re-run inside the same minute WILL be
# throttled — that is the limiter working, not a fault. Wait it out rather than
# reporting a false failure.
login_as() { # login_as <identifier> <password> → prints the login response
  local response attempt
  for attempt in 1 2 3; do
    response="$(api POST /auth/login "{\"identifier\":\"$1\",\"password\":\"$2\"}")"
    [[ -n "$(printf '%s' "$response" | jq_get data.accessToken)" ]] && { printf '%s' "$response"; return; }
    [[ "$(printf '%s' "$response" | jq_get error.code)" == "RATE_LIMITED" ]] || { printf '%s' "$response"; return; }
    [[ $attempt -lt 3 ]] && { printf '  (login throttled — waiting 62s)\n' >&2; sleep 62; }
  done
  printf '%s' "$response"
}

printf '\n\033[1mTruckAI — client journey against %s\033[0m\n\n' "$BASE_URL"

[[ -n "$ADMIN_EMAIL" && -n "$ADMIN_PASSWORD" ]] || {
  echo "ADMIN_EMAIL and ADMIN_PASSWORD are required" >&2; exit 2; }

STAMP="$(date +%s)-$$"
OWNER_EMAIL="smoke-owner-$STAMP@truckai.invalid"
OWNER_PASSWORD="Smoke-Pass-$STAMP"
DRIVER_EMAIL="smoke-driver-$STAMP@truckai.invalid"

# ---------------------------------------------------------------------------
# Provision a throwaway company, the way an operator onboards a real customer.
# ---------------------------------------------------------------------------
ADMIN_TOKEN="$(login_as "$ADMIN_EMAIL" "$ADMIN_PASSWORD" | jq_get data.accessToken)"
[[ -n "$ADMIN_TOKEN" ]] || { echo "could not sign in as the administrator" >&2; exit 2; }

COMPANY="$(api POST /admin/companies \
  "{\"name\":\"SMOKE $STAMP\",\"owner\":{\"fullName\":\"Smoke Owner\",\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}}" \
  "$ADMIN_TOKEN")"
COMPANY_ID="$(printf '%s' "$COMPANY" | jq_get data.id)"
[[ -n "$COMPANY_ID" ]] || { echo "could not provision the test company: $COMPANY" >&2; exit 2; }

# ---------------------------------------------------------------------------
step; LOGIN="$(login_as "$OWNER_EMAIL" "$OWNER_PASSWORD")"
TOKEN="$(printf '%s' "$LOGIN" | jq_get data.accessToken)"
REFRESH="$(printf '%s' "$LOGIN" | jq_get data.refreshToken)"
if [[ -n "$TOKEN" ]]; then ok "Login — the owner signs in"; else bad "Login" "$LOGIN"; fi

step; ME="$(api GET /auth/me '' "$TOKEN")"
if [[ "$(printf '%s' "$ME" | jq_get data.email)" == "$OWNER_EMAIL" ]]; then
  ok "Session — the token identifies the right user"
else bad "Session identifies the user" "$ME"; fi

step; COMPANY_SELF="$(api GET /company '' "$TOKEN")"
if [[ "$(printf '%s' "$COMPANY_SELF" | jq_get data.id)" == "$COMPANY_ID" ]]; then
  ok "Company data — the owner sees their own firm"
else bad "Company data" "$COMPANY_SELF"; fi

step; DASH="$(api GET /finance/summary '' "$TOKEN")"
if [[ "$(printf '%s' "$DASH" | jq_get success)" == "True" ]]; then
  ok "Dashboard — the summary loads for a brand-new firm"
else bad "Dashboard" "$DASH"; fi

step; VEHICLE="$(api POST /vehicles "{\"plateNumber\":\"01A${STAMP: -5}\",\"type\":\"TRUCK\",\"fuelNormPer100km\":30}" "$TOKEN")"
VEHICLE_ID="$(printf '%s' "$VEHICLE" | jq_get data.id)"
if [[ -n "$VEHICLE_ID" ]]; then ok "Vehicle — a truck is registered"; else bad "Vehicle" "$VEHICLE"; fi

step; DRIVER="$(api POST /drivers "{\"fullName\":\"Smoke Haydovchi\"}" "$TOKEN")"
DRIVER_ID="$(printf '%s' "$DRIVER" | jq_get data.id)"
if [[ -n "$DRIVER_ID" ]]; then ok "Driver — a driver is registered"; else bad "Driver" "$DRIVER"; fi

step; ROUTE="$(api POST /routes "{\"name\":\"Toshkent-Samarqand $STAMP\",\"originName\":\"Toshkent\",\"destinationName\":\"Samarqand\",\"plannedDistanceKm\":\"300.0\"}" "$TOKEN")"
ROUTE_ID="$(printf '%s' "$ROUTE" | jq_get data.id)"
if [[ -n "$ROUTE_ID" ]]; then ok "Route — a lane is defined"; else bad "Route" "$ROUTE"; fi

step; TRIP="$(api POST /trips "{\"vehicleId\":\"$VEHICLE_ID\",\"driverId\":\"$DRIVER_ID\",\"routeId\":\"$ROUTE_ID\",\"cargoName\":\"Paxta\",\"agreedPrice\":\"900000000\"}" "$TOKEN")"
TRIP_ID="$(printf '%s' "$TRIP" | jq_get data.id)"
if [[ -n "$TRIP_ID" ]]; then ok "Trip — a job is created at 9 000 000 so'm"; else bad "Trip" "$TRIP"; fi

step
# The lifecycle has explicit endpoints rather than a free-form status field, so
# an invalid transition is impossible to express — assign, then start.
ASSIGNED="$(api POST "/trips/$TRIP_ID/assign" "{\"vehicleId\":\"$VEHICLE_ID\",\"driverId\":\"$DRIVER_ID\"}" "$TOKEN")"
STARTED="$(api POST "/trips/$TRIP_ID/start" '{}' "$TOKEN")"
if [[ "$(printf '%s' "$ASSIGNED" | jq_get data.status)" == "ASSIGNED" \
   && "$(printf '%s' "$STARTED"  | jq_get data.status)" == "IN_PROGRESS" ]]; then
  ok "Trip status — the job is assigned and then started"
else bad "Trip status" "assign=$ASSIGNED start=$STARTED"; fi

step; EXPENSE="$(api POST /expenses "{\"category\":\"FUEL\",\"amount\":\"300000000\",\"expenseDate\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"tripId\":\"$TRIP_ID\"}" "$TOKEN")"
if [[ -n "$(printf '%s' "$EXPENSE" | jq_get data.id)" ]]; then
  ok "Expense — 3 000 000 so'm of fuel is booked"
else bad "Expense" "$EXPENSE"; fi

step; INCOME="$(api POST /incomes "{\"amount\":\"900000000\",\"tripId\":\"$TRIP_ID\"}" "$TOKEN")"
if [[ -n "$(printf '%s' "$INCOME" | jq_get data.id)" ]]; then
  ok "Income — the customer payment is recorded"
else bad "Income" "$INCOME"; fi

step; FIN="$(api GET /finance/summary '' "$TOKEN")"
REV="$(printf '%s' "$FIN" | jq_get data.revenue)"
EXP="$(printf '%s' "$FIN" | jq_get data.expenses)"
# The figures must be exactly what was booked, in integer tiyin — this is the
# number the firm's owner will make decisions with.
if [[ "$REV" == "900000000" && "$EXP" == "300000000" ]]; then
  ok "Finance — revenue 9 000 000 and expenses 3 000 000, exactly as booked"
else bad "Finance figures" "revenue=$REV expenses=$EXP"; fi

step; MONTHLY="$(api GET /finance/monthly '' "$TOKEN")"
if [[ "$(printf '%s' "$MONTHLY" | jq_get success)" == "True" ]]; then
  ok "Monthly report — the month-by-month view loads"
else bad "Monthly report" "$MONTHLY"; fi

step; TRACK="$(api GET /tracking/live '' "$TOKEN")"
if [[ "$(printf '%s' "$TRACK" | jq_get success)" == "True" ]]; then
  ok "Tracking — the live map data loads"
else bad "Tracking" "$TRACK"; fi

step
# A real 1x1 PNG, so the magic-byte check is genuinely exercised.
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n\x2d\xb4\x00\x00\x00\x00IEND\xaeB\x60\x82' > /tmp/smoke-receipt.png
UPLOAD="$("${CURL[@]}" -X POST "$API/files/upload" -H "authorization: Bearer $TOKEN" -F 'file=@/tmp/smoke-receipt.png;type=image/png')"
FILE_ID="$(printf '%s' "$UPLOAD" | jq_get data.id)"
if [[ -n "$FILE_ID" ]]; then ok "File upload — a receipt photo is stored"; else bad "File upload" "$UPLOAD"; fi
rm -f /tmp/smoke-receipt.png

step; AI="$(api POST /ai/chat '{"question":"Bu oy qancha foyda qildik?","locale":"uz-latn"}' "$TOKEN")"
ANSWER="$(printf '%s' "$AI" | jq_get data.answer)"
# The assistant must quote the real profit — 6 000 000 so'm — not invent one.
if [[ "$ANSWER" == *"6"*"000"*"000"* ]]; then
  ok "AI chat — the assistant answers with the firm's real profit"
else bad "AI chat" "$ANSWER"; fi

step; INSIGHTS="$(api GET /ai/insights '' "$TOKEN")"
if [[ "$(printf '%s' "$INSIGHTS" | jq_get success)" == "True" ]]; then
  ok "AI insights — the dashboard strip is served"
else bad "AI insights" "$INSIGHTS"; fi

step
# A second firm, to prove one customer cannot see another's money.
OTHER_EMAIL="smoke-other-$STAMP@truckai.invalid"
api POST /admin/companies \
  "{\"name\":\"SMOKE OTHER $STAMP\",\"owner\":{\"fullName\":\"Other Owner\",\"email\":\"$OTHER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}}" \
  "$ADMIN_TOKEN" >/dev/null
OTHER_TOKEN="$(login_as "$OTHER_EMAIL" "$OWNER_PASSWORD" | jq_get data.accessToken)"
OTHER_TRIP_CODE="$(code_of GET "/trips/$TRIP_ID" '' "$OTHER_TOKEN")"
OTHER_FIN="$(api GET /finance/summary '' "$OTHER_TOKEN" | jq_get data.revenue)"
if [[ "$OTHER_TRIP_CODE" == "404" && "$OTHER_FIN" == "0" ]]; then
  ok "Tenant isolation — another firm sees neither the trip nor the money"
else bad "Tenant isolation" "trip=$OTHER_TRIP_CODE otherRevenue=$OTHER_FIN"; fi

step
api POST /users "{\"fullName\":\"Smoke Driver User\",\"email\":\"$DRIVER_EMAIL\",\"password\":\"$OWNER_PASSWORD\",\"role\":\"DRIVER\"}" "$TOKEN" >/dev/null
DRIVER_TOKEN="$(login_as "$DRIVER_EMAIL" "$OWNER_PASSWORD" | jq_get data.accessToken)"
FIN_CODE="$(code_of GET /finance/summary '' "$DRIVER_TOKEN")"
AI_CODE="$(code_of POST /ai/chat '{"question":"foyda?"}' "$DRIVER_TOKEN")"
if [[ "$FIN_CODE" == "403" && "$AI_CODE" == "403" ]]; then
  ok "RBAC — a driver cannot reach the firm's money or the assistant"
else bad "RBAC" "finance=$FIN_CODE ai=$AI_CODE"; fi

step
REFRESHED="$(api POST /auth/refresh "{\"refreshToken\":\"$REFRESH\"}")"
NEW_TOKEN="$(printf '%s' "$REFRESHED" | jq_get data.accessToken)"
if [[ -n "$NEW_TOKEN" && "$NEW_TOKEN" != "$TOKEN" ]]; then
  ok "Session persistence — the session refreshes and rotates its token"
else bad "Session refresh" "$REFRESHED"; fi

step
# Logout takes the REFRESH token, not the access token: it is the refresh
# family that has to be revoked, and the access token expires on its own.
NEW_REFRESH="$(printf '%s' "$REFRESHED" | jq_get data.refreshToken)"
LOGOUT="$(api POST /auth/logout "{\"refreshToken\":\"$NEW_REFRESH\"}")"
# And it must actually revoke: reusing the same refresh token afterwards fails.
AFTER="$(code_of POST /auth/refresh "{\"refreshToken\":\"$NEW_REFRESH\"}")"
if [[ "$(printf '%s' "$LOGOUT" | jq_get data.loggedOut)" == "True" && "$AFTER" == "401" ]]; then
  ok "Logout — the session ends and the refresh token stops working"
else bad "Logout" "logout=$LOGOUT reuseAfterLogout=$AFTER"; fi

printf '\n\033[1m%d/%d passed\033[0m' "$PASS" "$((PASS+FAIL))"
[[ $FAIL -gt 0 ]] && printf '  \033[31m(%d failed)\033[0m' "$FAIL"
printf '\n\nTest company: SMOKE %s (id %s)\n' "$STAMP" "$COMPANY_ID"
exit "$FAIL"
