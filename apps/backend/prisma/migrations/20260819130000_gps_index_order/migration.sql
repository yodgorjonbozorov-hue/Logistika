-- GPS read-path index ordering.
--
-- The live map runs `DISTINCT ON (vehicle_id) … ORDER BY vehicle_id,
-- recorded_at DESC`. A btree on (company_id, vehicle_id, recorded_at ASC)
-- cannot produce that mixed ordering, so PostgreSQL sorted the entire table on
-- every request — EXPLAIN showed a Seq Scan + Sort at 60k rows and it only gets
-- worse. Matching the index order to the query order turns it into an index
-- scan that touches one row per vehicle.
--
-- The ASC indexes are dropped rather than kept alongside: gps_tracks is
-- insert-heavy and a redundant second index taxes every write. A DESC index is
-- scanned backwards for ascending range reads, so the route-history query is
-- still covered.

DROP INDEX IF EXISTS "gps_tracks_company_id_vehicle_id_recorded_at_idx";
DROP INDEX IF EXISTS "gps_tracks_company_id_trip_id_recorded_at_idx";

CREATE INDEX "gps_tracks_company_id_vehicle_id_recorded_at_idx"
  ON "gps_tracks"("company_id", "vehicle_id", "recorded_at" DESC);
CREATE INDEX "gps_tracks_company_id_trip_id_recorded_at_idx"
  ON "gps_tracks"("company_id", "trip_id", "recorded_at" DESC);
