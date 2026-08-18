-- A vehicle, trailer or driver can only be on one trip at a time (TASK-3.10).
--
-- Nothing stopped a logist from starting a second trip on a truck that was
-- already halfway to Bukhara. Both trips then collected the same GPS track,
-- the same fuel and the same kilometres, and the per-trip profit of both was
-- wrong in a way no report could reveal.
--
-- The constraint is on IN_PROGRESS only, on purpose. Being *assigned* to
-- several trips is normal planning — the logist schedules tomorrow's run for
-- the truck that is driving today. Being *on* two trips is physically
-- impossible, and that is the line the database enforces.
--
-- Partial unique indexes rather than application checks, because two starts
-- arriving together both pass any check written in code. Prisma cannot express
-- a partial index in the schema, so these live only here — like the CHECK
-- constraints and the RLS policies.
--
-- Verified before writing: no existing row violates any of them.

CREATE UNIQUE INDEX "trips_one_active_per_driver_key"
  ON "trips" ("company_id", "driver_id")
  WHERE "status" = 'IN_PROGRESS' AND "driver_id" IS NOT NULL;

CREATE UNIQUE INDEX "trips_one_active_per_vehicle_key"
  ON "trips" ("company_id", "vehicle_id")
  WHERE "status" = 'IN_PROGRESS' AND "vehicle_id" IS NOT NULL;

CREATE UNIQUE INDEX "trips_one_active_per_trailer_key"
  ON "trips" ("company_id", "trailer_id")
  WHERE "status" = 'IN_PROGRESS' AND "trailer_id" IS NOT NULL;
