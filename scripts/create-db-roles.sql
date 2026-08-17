-- Database roles for production (TASK-2.1, docs/DEPLOYMENT.md).
--
-- Row-level security is only a real boundary if the role the API connects with
-- cannot bypass it. Two roles, two jobs:
--
--   truckcontrol_migrator — runs migrations and the seed. Owns the schema and
--                           bypasses RLS, because DDL and bootstrap data are
--                           inherently cross-tenant.
--   truckcontrol_app      — serves API traffic. No BYPASSRLS, not a superuser,
--                           not the table owner: every tenant_isolation policy
--                           applies to it.
--
-- Run once as a superuser, with real passwords substituted:
--   psql "$ADMIN_DATABASE_URL" \
--     -v migrator_password="'…'" -v app_password="'…'" -v db=truckcontrol \
--     -f scripts/create-db-roles.sql

\set ON_ERROR_STOP on

CREATE ROLE truckcontrol_migrator LOGIN PASSWORD :migrator_password BYPASSRLS;
CREATE ROLE truckcontrol_app LOGIN PASSWORD :app_password;

GRANT CONNECT ON DATABASE :db TO truckcontrol_migrator, truckcontrol_app;
GRANT USAGE ON SCHEMA public TO truckcontrol_app;
GRANT ALL ON SCHEMA public TO truckcontrol_migrator;

-- The app reads and writes rows; it never changes the schema.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO truckcontrol_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO truckcontrol_app;

-- Tables created by future migrations inherit the same grants.
ALTER DEFAULT PRIVILEGES FOR ROLE truckcontrol_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO truckcontrol_app;
ALTER DEFAULT PRIVILEGES FOR ROLE truckcontrol_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO truckcontrol_app;

-- Verify: this must report bypassrls = false for the application role.
SELECT rolname, rolsuper, rolbypassrls
  FROM pg_roles
 WHERE rolname IN ('truckcontrol_migrator', 'truckcontrol_app');
