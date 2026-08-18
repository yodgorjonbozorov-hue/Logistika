-- TASK-4.5 (M-7): a GPS point is identified by vehicle and instant.
--
-- The phone acknowledges a batch and only then marks it sent. A phone that dies
-- in between re-sends the batch, and with nothing unique about a point the same
-- coordinates landed twice: every distance total was inflated and the drawn
-- route stuttered over doubled vertices.
--
-- Written by hand rather than generated, because the constraint cannot be added
-- until the duplicates already in the table are gone.

-- 1. Drop the duplicates, keeping the lowest id of each (company, vehicle,
--    instant). The rows are identical by definition of the problem, so which
--    survivor is kept does not matter — only that exactly one does.
DELETE FROM "gps_tracks" a
USING "gps_tracks" b
WHERE a.company_id = b.company_id
  AND a.vehicle_id = b.vehicle_id
  AND a.recorded_at = b.recorded_at
  AND a.id > b.id;

-- 2. The plain index on the same columns in the same order is superseded by the
--    unique one: every query it served is served identically, so keeping both
--    would only be a second index to maintain on the fastest-growing table.
DROP INDEX IF EXISTS "gps_tracks_company_id_vehicle_id_recorded_at_idx";

CREATE UNIQUE INDEX "gps_tracks_company_id_vehicle_id_recorded_at_key"
  ON "gps_tracks" ("company_id", "vehicle_id", "recorded_at");
