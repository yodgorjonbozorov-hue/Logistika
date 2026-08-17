#!/bin/sh
# Runs once, when the postgres volume is created.
#
# The application must not connect as a superuser: PostgreSQL exempts one from
# row-level security no matter what the policies say, which would leave the
# third isolation layer installed but inert (docs/SECURITY.md F-4).
#
# So the stack keeps two roles. POSTGRES_USER stays the superuser and is used
# for administration and backups. The role created here owns the database and is
# what the backend connects with: an owner can still run `prisma migrate deploy`,
# and FORCE ROW LEVEL SECURITY makes the policies apply to an owner too.
set -e

if [ -z "$APP_DB_USER" ] || [ -z "$APP_DB_PASSWORD" ]; then
  echo "APP_DB_USER and APP_DB_PASSWORD must be set; refusing to leave the app on the superuser role." >&2
  exit 1
fi

# psql quotes the values itself, so a password with punctuation stays intact.
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" \
  -v app_password="$APP_DB_PASSWORD" \
  -v db_name="$POSTGRES_DB" <<'SQL'
CREATE ROLE :"app_user"
  LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

-- The app owns the schema, so migrations keep working; FORCE RLS in the
-- migration is what stops ownership from becoming an exemption.
ALTER DATABASE :"db_name" OWNER TO :"app_user";
ALTER SCHEMA public OWNER TO :"app_user";
GRANT ALL ON SCHEMA public TO :"app_user";
SQL
