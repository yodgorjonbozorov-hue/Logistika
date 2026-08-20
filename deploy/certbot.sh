#!/bin/sh
# Let's Encrypt certificates for TruckAI, over the webroot (HTTP-01) challenge.
#
#   sh deploy/certbot.sh issue  api.truckai.uz admin@truckai.uz
#   sh deploy/certbot.sh renew
#   sh deploy/certbot.sh install-timer          # daily renewal via systemd
#
# Webroot rather than certbot's standalone mode: standalone needs port 80 to
# itself, so every renewal would stop nginx for a minute. `deploy/nginx.conf`
# already serves /.well-known/acme-challenge/ from /var/www/certbot on port 80
# — before the redirect to HTTPS, which matters, because Let's Encrypt follows
# the redirect but the file has to exist somewhere.
#
# DNS is the operator's job and this script cannot do it: A records for the API
# and app hostnames must already point at this host, or issuance fails with an
# unauthorized error that has nothing to do with this configuration.
set -eu

WEBROOT="${CERTBOT_WEBROOT:-/var/www/certbot}"
LIVE_DIR="${CERT_LIVE_DIR:-/etc/letsencrypt/live}"
NGINX_CERT_DIR="${NGINX_CERT_DIR:-/etc/nginx/certs}"

log() { echo "[certbot] $*"; }
die() { echo "[certbot] ERROR: $*" >&2; exit 1; }

command -v certbot >/dev/null 2>&1 || die "certbot is not installed (apt install certbot)"

case "${1:-}" in
  issue)
    DOMAIN="${2:-}"; EMAIL="${3:-}"
    [ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || die "usage: certbot.sh issue <domain> <email>"

    mkdir -p "$WEBROOT/.well-known/acme-challenge"

    # Prove the challenge path is actually reachable BEFORE asking Let's
    # Encrypt to look. A failed real issuance counts against the rate limit
    # (5 per domain per week); a failed local check costs nothing.
    TOKEN="preflight-$(date -u +%s)"
    echo "$TOKEN" > "$WEBROOT/.well-known/acme-challenge/$TOKEN"
    FETCHED="$(curl -fsS --max-time 10 "http://$DOMAIN/.well-known/acme-challenge/$TOKEN" || true)"
    rm -f "$WEBROOT/.well-known/acme-challenge/$TOKEN"
    [ "$FETCHED" = "$TOKEN" ] ||
      die "http://$DOMAIN/.well-known/acme-challenge/ does not serve $WEBROOT — check DNS and the port 80 server block"
    log "challenge path verified"

    certbot certonly \
      --webroot --webroot-path "$WEBROOT" \
      --domain "$DOMAIN" \
      --email "$EMAIL" \
      --agree-tos --no-eff-email \
      --keep-until-expiring \
      --rsa-key-size 4096

    # nginx reads fixed paths so the config never has to name a domain.
    mkdir -p "$NGINX_CERT_DIR"
    ln -sf "$LIVE_DIR/$DOMAIN/fullchain.pem" "$NGINX_CERT_DIR/fullchain.pem"
    ln -sf "$LIVE_DIR/$DOMAIN/privkey.pem"   "$NGINX_CERT_DIR/privkey.pem"
    nginx -t && nginx -s reload
    log "issued and installed for $DOMAIN"
    ;;

  renew)
    # `renew` is a no-op until a certificate is within 30 days of expiry, so it
    # is safe to run daily. The reload hook only fires when something was
    # actually renewed.
    certbot renew --webroot --webroot-path "$WEBROOT" \
      --deploy-hook 'nginx -t && nginx -s reload'
    ;;

  install-timer)
    # Twice a day at a minute nobody else picked: Let's Encrypt asks clients to
    # spread renewals, and every deployment running at 00:00 is what causes
    # their rate limiter to shed traffic.
    cat > /etc/systemd/system/truckai-certbot.service <<EOF
[Unit]
Description=Renew TruckAI TLS certificates
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh $(cd "$(dirname "$0")" && pwd)/certbot.sh renew
EOF
    cat > /etc/systemd/system/truckai-certbot.timer <<'EOF'
[Unit]
Description=Renew TruckAI TLS certificates twice daily

[Timer]
OnCalendar=*-*-* 03,15:17:00
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now truckai-certbot.timer
    systemctl list-timers truckai-certbot.timer --no-pager
    log "renewal timer installed"
    ;;

  *)
    echo "usage: sh deploy/certbot.sh {issue <domain> <email>|renew|install-timer}" >&2
    exit 2
    ;;
esac
