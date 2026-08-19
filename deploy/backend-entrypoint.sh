#!/bin/sh
# Backend container start-up: wait for the database, apply migrations, make sure
# a platform admin exists, then hand over to the app. Every step is idempotent,
# so restarting the container is always safe.
set -eu

cd /app/apps/backend

PRISMA="./node_modules/.bin/prisma"
ATTEMPTS="${DB_WAIT_ATTEMPTS:-30}"

echo "[entrypoint] waiting for the database…"
i=1
while [ "$i" -le "$ATTEMPTS" ]; do
  # `migrate status` also fails on pending migrations, so probe the connection
  # itself instead — this only checks that Postgres answers.
  if echo 'SELECT 1;' | "$PRISMA" db execute --stdin --schema prisma/schema.prisma >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq "$ATTEMPTS" ]; then
    echo "[entrypoint] database unreachable after ${ATTEMPTS} attempts" >&2
    exit 1
  fi
  i=$((i + 1))
  sleep 2
done

echo "[entrypoint] applying migrations…"
"$PRISMA" migrate deploy

echo "[entrypoint] checking the platform admin…"
node dist/scripts/bootstrap-superadmin.js

echo "[entrypoint] starting the API…"
exec "$@"
