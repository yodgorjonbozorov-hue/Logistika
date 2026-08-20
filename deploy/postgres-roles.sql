-- TruckAI — production PostgreSQL roles.
--
-- Two roles, because the application and the migrator need different powers
-- and giving the application the migrator's powers is how a compromised API
-- turns into a dropped database:
--
--   truckai_migrator  owns the schema. Runs `prisma migrate deploy`. DDL.
--   truckai_app       the API's runtime user. SELECT/INSERT/UPDATE/DELETE only.
--                     It cannot CREATE, ALTER or DROP anything — so no code
--                     path in the API, and no injection into one, can change
--                     the schema.
--
-- Neither is a SUPERUSER and neither may create databases or roles.
--
-- Run as a superuser against a freshly created, EMPTY database, BEFORE the
-- first `prisma migrate deploy`:
--
--   createdb truckai
--   psql … -f deploy/postgres-roles.sql -d truckai      # 1. roles
--   DATABASE_URL=<migrator url> npx prisma migrate deploy   # 2. schema
--   psql … -f deploy/postgres-roles.sql -d truckai      # 3. roles again
--
-- Order matters, and so does running it TWICE.
--
--   * Before the migration, because the migrator must own the schema before it
--     creates anything in it — otherwise every table is owned by whoever ran
--     the migration and the default privileges below never fire.
--   * After the migration, because `_prisma_migrations` does not exist on the
--     first pass, so the REVOKE that keeps the application out of the migration
--     bookkeeping cannot run until the table is there.
--
-- The file is idempotent; running it a third time changes nothing.
-- deploy/go-live.sh does both passes for you.
--
-- Passwords are passed as psql variables so they are never written into this
-- file and never reach the shell history of a `psql -c` invocation.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'truckai_migrator') THEN
    CREATE ROLE truckai_migrator LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'truckai_app') THEN
    CREATE ROLE truckai_app LOGIN;
  END IF;
END
$$;

ALTER ROLE truckai_migrator WITH PASSWORD :migrator_password NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE truckai_app      WITH PASSWORD :app_password      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- ---------------------------------------------------------------------------
-- Schema ownership
-- ---------------------------------------------------------------------------
-- PUBLIC can create objects in `public` by default on older clusters; revoking
-- it means an unprivileged role cannot plant a table (or a function that
-- shadows a built-in) in the search path.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO truckai_migrator;

GRANT USAGE ON SCHEMA public TO truckai_app;
GRANT CREATE, USAGE ON SCHEMA public TO truckai_migrator;

-- ---------------------------------------------------------------------------
-- Runtime privileges: data yes, structure no
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO truckai_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO truckai_app;

-- Tables a future migration creates must get the same grants automatically,
-- or the next deployment breaks the API at runtime instead of at migration
-- time — the worst possible moment to find out.
ALTER DEFAULT PRIVILEGES FOR ROLE truckai_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO truckai_app;
ALTER DEFAULT PRIVILEGES FOR ROLE truckai_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO truckai_app;

-- Prisma's migration bookkeeping table is written only by the migrator.
--
-- Guarded, because this file has to run BEFORE the first migration — that is
-- the whole point of it, since the migrator is what applies that migration —
-- and at that moment the table does not exist yet. Unguarded, the statement
-- aborts the script under ON_ERROR_STOP and every grant below it is silently
-- skipped, which is how a first deployment ends up with a migrator that cannot
-- migrate.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
  ) THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM truckai_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Connection privileges
-- ---------------------------------------------------------------------------
REVOKE CONNECT ON DATABASE truckai FROM PUBLIC;
GRANT CONNECT ON DATABASE truckai TO truckai_app, truckai_migrator;

-- CREATE on the DATABASE, for the migrator only.
--
-- Not optional and easy to miss: `prisma migrate deploy` issues
-- `CREATE SCHEMA IF NOT EXISTS "public"` on every run because the connection
-- string names a schema. Without this the very first production migration
-- fails with "permission denied for database" — and it fails on launch day,
-- because a database that was migrated by a superuser first never exercises
-- this path.
--
-- The application role is deliberately NOT granted it: creating a schema is
-- DDL, and DDL is the migrator's job.
GRANT CREATE ON DATABASE truckai TO truckai_migrator;
REVOKE CREATE ON DATABASE truckai FROM truckai_app;

-- ---------------------------------------------------------------------------
-- Verify (prints the state this file is supposed to produce)
-- ---------------------------------------------------------------------------
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole
FROM pg_roles
WHERE rolname IN ('truckai_app', 'truckai_migrator')
ORDER BY rolname;

SELECT
  has_schema_privilege('truckai_app', 'public', 'CREATE') AS app_can_create_in_schema,
  has_database_privilege('truckai_app', current_database(), 'CREATE') AS app_can_create_schema,
  has_database_privilege('truckai_migrator', current_database(), 'CREATE') AS migrator_can_migrate;
