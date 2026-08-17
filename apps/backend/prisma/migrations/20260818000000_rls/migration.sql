-- Row Level Security: the third isolation layer (docs/SECURITY.md F-4,
-- docs/ARCHITECTURE.md «himoya qatlami #3»).
--
-- The application already scopes every query through the Prisma tenant
-- extension. This layer exists for what that extension cannot see: a model
-- someone forgets to add to TENANT_MODELS, and a nested write whose arguments
-- the extension deliberately does not rewrite. From here on the database
-- refuses those rows itself.
--
-- The tenant is carried in a transaction-local setting, so it never leaks
-- between pooled connections. When the setting is absent the policy allows
-- everything: that is the deliberate escape hatch for the paths that run
-- before a tenant is known — logging in by phone or e-mail, the nightly cron
-- jobs that walk every company, the public tracking link, the seed. Those all
-- use the bare Prisma client, which never sets the value.
--
-- FORCE is required because the application connects as the tables' owner, and
-- an owner is exempt from its own policies unless forced. A superuser is exempt
-- regardless — see docs/DEPLOY.md §3: the application must not connect as one.

CREATE OR REPLACE FUNCTION app_current_company() RETURNS text
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.company_id', true), '') $$;

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "drivers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drivers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "drivers"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vehicles"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clients"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trips" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "trips"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "trip_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trip_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "trip_events"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "expenses"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "fuel_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fuel_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fuel_logs"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "incomes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incomes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "incomes"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "gps_tracks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gps_tracks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "gps_tracks"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "gps_tracks_archive" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gps_tracks_archive" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "gps_tracks_archive"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "tracking_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracking_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tracking_links"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "maintenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "maintenance"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "documents"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "ai_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_settings"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "ai_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_requests"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "ai_insights" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_insights" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_insights"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "chat_messages"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "stored_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stored_files" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stored_files"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs"
  USING (app_current_company() IS NULL OR company_id = app_current_company())
  WITH CHECK (app_current_company() IS NULL OR company_id = app_current_company());
