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
-- Run as a superuser, once, before the first deployment:
--
--   psql -v app_password="'…'" -v migrator_password="'…'" \
--        -f deploy/postgres-roles.sql -d truckai
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
REVOKE ALL ON TABLE public._prisma_migrations FROM truckai_app;

-- ---------------------------------------------------------------------------
-- Connection privileges
-- ---------------------------------------------------------------------------
REVOKE CONNECT ON DATABASE truckai FROM PUBLIC;
GRANT CONNECT ON DATABASE truckai TO truckai_app, truckai_migrator;

-- ---------------------------------------------------------------------------
-- Verify (prints the state this file is supposed to produce)
-- ---------------------------------------------------------------------------
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole
FROM pg_roles
WHERE rolname IN ('truckai_app', 'truckai_migrator')
ORDER BY rolname;

SELECT
  has_schema_privilege('truckai_app', 'public', 'CREATE') AS app_can_create_in_schema,
  has_database_privilege('truckai_app', current_database(), 'CREATE') AS app_can_create_schema;
