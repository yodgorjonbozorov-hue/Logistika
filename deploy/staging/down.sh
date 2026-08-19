#!/usr/bin/env bash
# Stops the staging processes. Leaves the database alone — dropping it is a
# separate, deliberate act.
set -uo pipefail
ROOT="${STAGING_ROOT:-/tmp/truckcontrol-staging}"
[[ -f "$ROOT/nginx.pid" ]] && nginx -s quit -c "$ROOT/nginx.conf" -p "$ROOT" 2>/dev/null
[[ -f "$ROOT/api.pid" ]] && kill "$(cat "$ROOT/api.pid")" 2>/dev/null && rm -f "$ROOT/api.pid"
echo "staging stopped"
