-- Denormalised last known position, and indexes for the history query (TASK-4.1).
--
-- MEASURED BEFORE, on 40 vehicles x 90 days x one point per 30s = 10 368 000
-- rows (3.8 GB):
--
--   live()     Parallel Seq Scan + Sort of the whole table, cost 2 122 483,
--              no LIMIT. Prisma's `distinct` de-duplicates in the client, so
--              all 10.4M rows cross the wire to produce 40. The query did not
--              finish in ten minutes. The map polls it every thirty seconds.
--   history()  Index Scan, 258 759 rows for one vehicle over 90 days, in one
--              unpaginated JSON response.
--
-- The five columns below are written once per vehicle at the end of each
-- position batch, so the map reads only `vehicles`: O(vehicles), not
-- O(all history).

ALTER TABLE "vehicles" ADD COLUMN "last_lat" DOUBLE PRECISION;
ALTER TABLE "vehicles" ADD COLUMN "last_lng" DOUBLE PRECISION;
ALTER TABLE "vehicles" ADD COLUMN "last_speed" DOUBLE PRECISION;
ALTER TABLE "vehicles" ADD COLUMN "last_seen_at" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN "last_trip_id" TEXT;

-- EXISTING ROWS: backfilled from the newest track per vehicle, so the map is
-- correct from the first request after deployment rather than blank until the
-- next position arrives.
UPDATE "vehicles" v
SET "last_lat" = t.lat, "last_lng" = t.lng, "last_speed" = t.speed,
    "last_seen_at" = t.recorded_at, "last_trip_id" = t.trip_id
FROM (
  SELECT DISTINCT ON (vehicle_id) vehicle_id, lat, lng, speed, recorded_at, trip_id
  FROM gps_tracks
  ORDER BY vehicle_id, recorded_at DESC
) t
WHERE t.vehicle_id = v.id;

-- history() reads one vehicle newest-first; the existing index leads with
-- company_id, which is right, but the archival job and the public tracking link
-- both look rows up by trip alone (L-5).
CREATE INDEX "gps_tracks_trip_id_idx" ON "gps_tracks" ("trip_id");
CREATE INDEX "gps_tracks_vehicle_id_recorded_at_idx"
  ON "gps_tracks" ("vehicle_id", "recorded_at" DESC);
