#!/bin/bash
#
# Production verification suite — functional and security regressions run against
# a live deployment over real HTTPS. Safe to run any time: it only reads, and the
# one write it makes (the cron endpoint) is idempotent by design.
#
#   scripts/prod-check.sh                       # uses the deployed defaults
#   API_URL=… WEB_URL=… scripts/prod-check.sh   # any other environment
#   CRON_SECRET=…  scripts/prod-check.sh        # also exercises the cron job
#
# Exits non-zero if any check fails, so CI can gate on it.

set -uo pipefail

API="${API_URL:-https://truck-control-ai-api.vercel.app}"
WEB="${WEB_URL:-https://truck-control-ai-web.vercel.app}"
CRON="${CRON_SECRET:-}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
ok() {
  printf 'PASS  %s\n' "$1"
  pass=$((pass + 1))
}
bad() {
  printf 'FAIL  %s  -- %s\n' "$1" "$2"
  fail=$((fail + 1))
}

# Retries three times: a transient network blip is not a deployment failure.
fetch() {
  local url="$1"
  shift
  CODE=000
  for _ in 1 2 3; do
    CODE=$(curl -sS -o "$TMP/body" -D "$TMP/hdr" -w "%{http_code}" --max-time 60 "$@" "$url" 2>/dev/null)
    [ "$CODE" != "000" ] && break
    sleep 3
  done
}

expect() { # name expected-status url [curl args...]
  local name="$1" want="$2" url="$3"
  shift 3
  fetch "$url" "$@"
  [ "$CODE" = "$want" ] && ok "$name" || bad "$name" "kutilgan $want, olindi $CODE"
}

echo "== API: $API"
echo "== WEB: $WEB"
echo
echo "--- Funksional ---"
expect "health 200" 200 "$API/api/v1/health"
grep -q '"status":"ok"' "$TMP/body" && ok "health javobi to'g'ri" || bad "health javobi" "$(head -c 80 "$TMP/body")"
expect "noma'lum yo'l 404" 404 "$API/api/v1/does-not-exist"

echo
echo "--- Autentifikatsiya chegaralari ---"
for route in trips vehicles drivers clients expenses incomes users company tracking/live; do
  expect "auth talab: /$route" 401 "$API/api/v1/$route"
done
expect "yaroqsiz token rad etiladi" 401 "$API/api/v1/trips" -H "authorization: Bearer not-a-real-token"

echo
echo "--- Cron himoyasi ---"
expect "cron sirsiz" 401 "$API/api/v1/cron/archive-gps"
expect "cron noto'g'ri sir" 401 "$API/api/v1/cron/archive-gps" -H "authorization: Bearer definitely-not-the-secret"
if [ -n "$CRON" ]; then
  fetch "$API/api/v1/cron/archive-gps" -H "authorization: Bearer $CRON"
  if [ "$CODE" = "200" ]; then
    ok "cron to'g'ri sir -> 200 ($(head -c 60 "$TMP/body"))"
  else
    bad "cron to'g'ri sir" "kutilgan 200, olindi $CODE — baza yetib bo'lmasa 500 bo'ladi"
  fi
else
  echo "SKIP  cron to'g'ri sir (CRON_SECRET berilmagan)"
fi

echo
echo "--- Ma'lumot sizishi ---"
fetch "$API/api/v1/trips"
grep -qiE "at [A-Za-z]+\.|node_modules|/vercel/path0|\"stack\"" "$TMP/body" &&
  bad "xato javobida stack trace" "$(head -c 80 "$TMP/body")" || ok "xato javobida stack trace yo'q"
fetch "$API/api/v1/health"
grep -qi '^x-powered-by:' "$TMP/hdr" &&
  bad "x-powered-by ochiq" "$(grep -i '^x-powered-by:' "$TMP/hdr" | tr -d '\r')" || ok "x-powered-by yashirilgan"

echo
echo "--- CORS ---"
fetch "$API/api/v1/health" -H "origin: $WEB"
grep -qi "^access-control-allow-origin: $WEB" "$TMP/hdr" &&
  ok "CORS: production origin ruxsat" || bad "CORS production origin" "ACAO yo'q"
for evil in "https://evil.uz" "https://evil-vercel.app" "null"; do
  fetch "$API/api/v1/health" -H "origin: $evil"
  grep -qi '^access-control-allow-origin:' "$TMP/hdr" &&
    bad "CORS rad etish: $evil" "ACAO qaytdi" || ok "CORS rad etish: $evil"
done
fetch "$API/api/v1/health"
grep -qi '^access-control-allow-origin: \*' "$TMP/hdr" &&
  bad "CORS wildcard + credentials" "ACAO=*" || ok "CORS wildcard ishlatilmagan"

echo
echo "--- Frontend ---"
expect "landing 200" 200 "$WEB/"
grep -q 'id="root"' "$TMP/body" && ok "SPA root mavjud" || bad "SPA root" "topilmadi"
asset=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' "$TMP/body" | head -1)
for h in x-content-type-options x-frame-options referrer-policy strict-transport-security; do
  grep -qi "^$h:" "$TMP/hdr" && ok "sarlavha: $h" || bad "sarlavha: $h" "yo'q"
done
expect "SPA fallback /login" 200 "$WEB/login"
expect "SPA fallback /trips/:id" 200 "$WEB/trips/00000000-0000-0000-0000-000000000000"

echo
echo "--- Bundle ---"
if [ -n "$asset" ]; then
  fetch "$WEB$asset"
  grep -q "$API/api/v1" "$TMP/body" && ok "bundle real API bazasini olib yuradi" || bad "bundle API bazasi" "topilmadi"
  grep -q 'localhost:3000' "$TMP/body" && bad "bundle'da localhost" "dev fallback qolgan" || ok "bundle'da localhost yo'q"
  leak=$(grep -ioE "JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|CRON_SECRET|MINIO_ROOT_PASSWORD|SMS_PROVIDER_TOKEN|postgresql://" "$TMP/body" | sort -u)
  [ -z "$leak" ] && ok "bundle'da server siri yo'q" || bad "bundle'da sir" "$leak"
else
  bad "bundle" "asset havolasi topilmadi"
fi

printf '\nJAMI: %d PASS, %d FAIL\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
