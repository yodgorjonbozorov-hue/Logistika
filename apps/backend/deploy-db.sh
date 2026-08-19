#!/bin/bash
#
# Database step of a Vercel deploy.
#
# The build container is the only place with network access to the database in
# some environments, so migrations run here rather than from a workstation.
# `prisma migrate deploy` only applies migrations that have not run yet — it
# never resets, drops or rewrites existing data — so repeating it on every
# deploy is safe and usually a no-op.
#
# Migrations need a direct connection: DDL cannot go through a transaction
# pooler. Supabase supplies that as POSTGRES_URL_NON_POOLING; the running app
# keeps using the pooled DATABASE_URL.
set -euo pipefail

DIRECT="${POSTGRES_URL_NON_POOLING:-${DIRECT_DATABASE_URL:-}}"

if [ -z "$DIRECT" ]; then
  echo "deploy-db: no direct database URL set, skipping migrations"
  exit 0
fi

echo "deploy-db: applying pending migrations"
DATABASE_URL="$DIRECT" npx prisma migrate deploy

# Opt-in and idempotent: does nothing unless the SEED_SUPERADMIN_* pair is set
# and no SUPERADMIN exists yet. See src/scripts/bootstrap-superadmin.ts.
echo "deploy-db: checking platform administrator"
DATABASE_URL="$DIRECT" node dist/scripts/bootstrap-superadmin.js
