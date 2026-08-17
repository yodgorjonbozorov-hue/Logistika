-- Row-Level Security: the third isolation layer promised by ARCHITECTURE.md.
--
-- Layers 1 (JWT companyId) and 2 (Prisma tenant extension) live in application
-- code, so a single missed filter — an `include` on a relation, a nested write,
-- a raw query — leaks another company's data. This layer moves the guarantee
-- into the database: a connection that has not declared which tenant it is
-- acting for sees nothing at all.
--
-- The tenant is declared per transaction with
--   SELECT set_config('app.company_id', '<uuid>', true)
-- which PrismaService does for every tenant-scoped query.
--
-- Existing rows: none are modified. Rows stay exactly as they are; only who may
-- read and write them changes.
--
-- FORCE is required: without it the table owner (which is what the application
-- role usually is) silently skips its own policies. Roles with BYPASSRLS or
-- SUPERUSER still bypass everything — that is deliberate, and is why migrations
-- and the seed run as a privileged role while the API must not (see
-- docs/DEPLOYMENT.md, "Baza rollari").
--
-- companies, refresh_tokens, audit_logs, tracking_links and sms_codes are
-- intentionally excluded: they are looked up before a tenant is known, or are
-- platform-wide by design (see tenant.extension.ts).

DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'users',
    'drivers',
    'vehicles',
    'clients',
    'trips',
    'trip_events',
    'expenses',
    'fuel_logs',
    'incomes',
    'gps_tracks',
    'gps_tracks_archive',
    'maintenance',
    'documents',
    'notifications',
    'stored_files'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tenant_table);
    -- company_id is text (Prisma String ids), so the setting is compared as
    -- text. NULLIF turns an unset setting into NULL, which matches no row —
    -- exactly the intended "no tenant declared, no data" behaviour.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (company_id = NULLIF(current_setting(''app.company_id'', true), ''''))
         WITH CHECK (company_id = NULLIF(current_setting(''app.company_id'', true), ''''))',
      tenant_table
    );
  END LOOP;
END
$$;
