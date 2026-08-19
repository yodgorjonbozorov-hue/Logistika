-- Production hardening migration.
--
-- Written to be safe on a database that ALREADY HOLDS DATA:
--   * new NOT NULL columns are added nullable, backfilled, then constrained;
--   * `companies.next_trip_number` is seeded from the existing trip numbers so
--     the new allocator never re-issues a number that is already in use;
--   * the new partial unique indexes fail LOUDLY with the conflicting ids
--     instead of silently dropping rows.
-- No DROP TABLE / DROP COLUMN / TRUNCATE is performed anywhere.

-- ---------------------------------------------------------------------------
-- H-6: per-company trip number counter (replaces count()+1)
-- ---------------------------------------------------------------------------
ALTER TABLE "companies" ADD COLUMN "next_trip_number" INTEGER NOT NULL DEFAULT 1;

-- Seed the counter past every trip number that already exists. Trip numbers are
-- text; only the purely numeric ones participate (others never collide with the
-- generated numeric sequence anyway).
UPDATE "companies" c
SET "next_trip_number" = sub.next_number
FROM (
  SELECT company_id, MAX(trip_number::bigint) + 1 AS next_number
  FROM "trips"
  WHERE trip_number ~ '^[0-9]+$'
  GROUP BY company_id
) sub
WHERE c.id = sub.company_id
  AND sub.next_number > c."next_trip_number";

-- ---------------------------------------------------------------------------
-- M-5: refresh token families (rotation reuse detection)
-- ---------------------------------------------------------------------------
ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" TEXT;
-- Existing tokens each become their own single-member family; they keep working
-- until they expire and join a real family on the next rotation.
UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- ---------------------------------------------------------------------------
-- H-3: financial idempotency keys, unique PER TENANT
-- ---------------------------------------------------------------------------
ALTER TABLE "expenses" ADD COLUMN "client_tx_id" TEXT;
ALTER TABLE "incomes" ADD COLUMN "client_tx_id" TEXT;
CREATE UNIQUE INDEX "expenses_company_id_client_tx_id_key" ON "expenses"("company_id", "client_tx_id");
CREATE UNIQUE INDEX "incomes_company_id_client_tx_id_key" ON "incomes"("company_id", "client_tx_id");

-- ---------------------------------------------------------------------------
-- Tenant-scoped event idempotency key.
-- The old GLOBAL unique index let company B's offline client UUID collide with
-- company A's row: the tenant-scoped duplicate probe could not see A's event,
-- so the insert blew up with a 500 instead of reporting a duplicate.
-- ---------------------------------------------------------------------------
DROP INDEX "trip_events_client_event_id_key";
CREATE UNIQUE INDEX "trip_events_company_id_client_event_id_key" ON "trip_events"("company_id", "client_event_id");

-- ---------------------------------------------------------------------------
-- M-13: one driver / one vehicle may hold only ONE in-flight trip at a time.
-- Fail loudly (with the offending ids) rather than let the index creation die
-- with a bare "could not create unique index".
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  conflict_ids TEXT;
BEGIN
  SELECT string_agg(DISTINCT driver_id, ', ') INTO conflict_ids
  FROM (
    SELECT driver_id FROM "trips"
    WHERE driver_id IS NOT NULL AND status = 'IN_PROGRESS'
    GROUP BY company_id, driver_id HAVING COUNT(*) > 1
  ) d;
  IF conflict_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce single in-progress trip per driver: drivers % already have more than one IN_PROGRESS trip. Resolve these trips, then re-run the migration.', conflict_ids;
  END IF;

  SELECT string_agg(DISTINCT vehicle_id, ', ') INTO conflict_ids
  FROM (
    SELECT vehicle_id FROM "trips"
    WHERE vehicle_id IS NOT NULL AND status = 'IN_PROGRESS'
    GROUP BY company_id, vehicle_id HAVING COUNT(*) > 1
  ) v;
  IF conflict_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce single in-progress trip per vehicle: vehicles % already have more than one IN_PROGRESS trip. Resolve these trips, then re-run the migration.', conflict_ids;
  END IF;
END $$;

CREATE UNIQUE INDEX "trips_one_active_per_driver"
  ON "trips"("company_id", "driver_id")
  WHERE status = 'IN_PROGRESS' AND driver_id IS NOT NULL;

CREATE UNIQUE INDEX "trips_one_active_per_vehicle"
  ON "trips"("company_id", "vehicle_id")
  WHERE status = 'IN_PROGRESS' AND vehicle_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Read-path indexes (performance audit)
-- ---------------------------------------------------------------------------
CREATE INDEX "audit_logs_company_id_entity_type_entity_id_idx" ON "audit_logs"("company_id", "entity_type", "entity_id");
CREATE INDEX "expenses_company_id_trip_id_idx" ON "expenses"("company_id", "trip_id");
CREATE INDEX "gps_tracks_company_id_trip_id_recorded_at_idx" ON "gps_tracks"("company_id", "trip_id", "recorded_at");
CREATE INDEX "incomes_company_id_trip_id_idx" ON "incomes"("company_id", "trip_id");
CREATE INDEX "incomes_company_id_client_id_status_idx" ON "incomes"("company_id", "client_id", "status");
CREATE INDEX "sms_codes_expires_at_idx" ON "sms_codes"("expires_at");
CREATE INDEX "trip_events_company_id_driver_id_event_time_idx" ON "trip_events"("company_id", "driver_id", "event_time");
CREATE INDEX "trips_company_id_driver_id_status_idx" ON "trips"("company_id", "driver_id", "status");
CREATE INDEX "trips_company_id_vehicle_id_status_idx" ON "trips"("company_id", "vehicle_id", "status");
