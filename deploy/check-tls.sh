#!/bin/sh
# TLS posture and certificate expiry for a live TruckAI host.
#
#   sh deploy/check-tls.sh api.truckai.uz
#   sh deploy/check-tls.sh api.staging.truckcontrol.local 443 --insecure
#
# Run it from cron once a day. It exits non-zero when the certificate has
# fewer than CERT_WARN_DAYS left, so a cron mail or an alerting wrapper picks
# it up while there is still time to renew — a certificate that expires on a
# Saturday takes the whole product down until someone notices.
#
# Exit codes:  0 healthy · 1 expiring or misconfigured · 2 could not connect
set -eu

HOST="${1:-}"
PORT="${2:-443}"
INSECURE=""
[ "${3:-}" = "--insecure" ] && INSECURE=1
WARN_DAYS="${CERT_WARN_DAYS:-21}"

if [ -z "$HOST" ]; then
  echo "usage: sh deploy/check-tls.sh <host> [port] [--insecure]" >&2
  exit 2
fi

PROBLEMS=0
fail() { echo "  FAIL  $*"; PROBLEMS=$((PROBLEMS + 1)); }
warn() { echo "  WARN  $*"; }
ok()   { echo "  ok    $*"; }

# `openssl s_client` needs stdin closed or it waits forever for a request.
sclient() { openssl s_client -connect "$HOST:$PORT" -servername "$HOST" "$@" </dev/null 2>/dev/null; }

echo "TLS check: $HOST:$PORT"
echo

# ---------------------------------------------------------------------------
# 1. Does it complete a handshake at all?
# ---------------------------------------------------------------------------
CERT="$(sclient -showcerts 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>/dev/null || true)"
if [ -z "$CERT" ]; then
  echo "  FAIL  no TLS handshake — host unreachable or not serving TLS"
  exit 2
fi
echo "$CERT" | sed 's/^/        /'
echo

# ---------------------------------------------------------------------------
# 2. Expiry
# ---------------------------------------------------------------------------
NOT_AFTER="$(sclient | openssl x509 -noout -enddate | cut -d= -f2)"
END_EPOCH="$(date -d "$NOT_AFTER" +%s 2>/dev/null || date -j -f '%b %d %T %Y %Z' "$NOT_AFTER" +%s 2>/dev/null || echo 0)"
NOW_EPOCH="$(date +%s)"
if [ "$END_EPOCH" -eq 0 ]; then
  warn "could not parse the expiry date ($NOT_AFTER)"
else
  DAYS=$(( (END_EPOCH - NOW_EPOCH) / 86400 ))
  if [ "$DAYS" -lt 0 ]; then
    fail "certificate EXPIRED ${DAYS#-} days ago"
  elif [ "$DAYS" -lt "$WARN_DAYS" ]; then
    fail "certificate expires in $DAYS days (threshold $WARN_DAYS) — renew now"
  else
    ok "certificate valid for $DAYS more days"
  fi
fi

# ---------------------------------------------------------------------------
# 3. Hostname must actually be covered by the certificate
# ---------------------------------------------------------------------------
if [ -z "$INSECURE" ]; then
  if sclient -verify_return_error >/dev/null 2>&1; then
    ok "chain verifies and the hostname matches"
  else
    fail "certificate does not verify for $HOST (wrong name, or an incomplete chain)"
  fi
else
  warn "verification skipped (--insecure) — staging self-signed certificate"
fi

# ---------------------------------------------------------------------------
# 4. Protocol floor: TLS 1.0/1.1 must be refused, 1.2 and 1.3 offered
# ---------------------------------------------------------------------------
for old in tls1 tls1_1; do
  if sclient "-$old" >/dev/null 2>&1; then
    fail "$old is still accepted"
  else
    ok "$old refused"
  fi
done
for good in tls1_2 tls1_3; do
  if sclient "-$good" >/dev/null 2>&1; then
    ok "$good offered"
  else
    warn "$good not offered"
  fi
done

# ---------------------------------------------------------------------------
# 5. Security headers and the plain-HTTP redirect
# ---------------------------------------------------------------------------
# Built with `set --` rather than a flag string: an unquoted "$FLAGS" containing
# `--noproxy *` gets the `*` glob-expanded to the working directory's file list,
# which silently turns every header check below into a false failure.
set -- -s -o /dev/null --max-time 10
[ -n "$INSECURE" ] && set -- "$@" -k --noproxy '*'

HEADERS="$(curl "$@" -D - "https://$HOST:$PORT/" 2>/dev/null || true)"
for header in Strict-Transport-Security X-Content-Type-Options X-Frame-Options Referrer-Policy; do
  if printf '%s' "$HEADERS" | grep -qi "^$header:"; then
    ok "$header present"
  else
    fail "$header missing"
  fi
done
if printf '%s' "$HEADERS" | grep -qi '^server: nginx/[0-9]'; then
  fail "the Server header advertises the nginx version (server_tokens off)"
else
  ok "no version disclosure in the Server header"
fi

REDIRECT="$(curl "$@" -w '%{http_code} %{redirect_url}' "http://$HOST/" 2>/dev/null || true)"
case "$REDIRECT" in
  30*https://*) ok "plain HTTP redirects to HTTPS" ;;
  '')           warn "port 80 not reachable from here — could not check the redirect" ;;
  *)            fail "plain HTTP does not redirect to HTTPS (got: $REDIRECT)" ;;
esac

echo
if [ "$PROBLEMS" -gt 0 ]; then
  echo "$PROBLEMS problem(s)."
  exit 1
fi
echo "TLS configuration is sound."
