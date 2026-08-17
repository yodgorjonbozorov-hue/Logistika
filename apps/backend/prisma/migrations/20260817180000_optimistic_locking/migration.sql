-- Optimistic locking and change timestamps (TASK-3.5, M-18).
--
-- Trip had neither updatedAt nor a version, so two parallel completes both
-- passed the status check and both wrote: finishedAt was overwritten,
-- actualDistanceKm recalculated, and after TASK-3.1 the client was invoiced
-- twice. `version` gives every guarded write something to compare against.
--
-- EXISTING ROWS: updated_at is backfilled from created_at — the best available
-- answer for "when was this last changed", and never a time in the future.
-- version starts at 0 for every row, which is exactly what a first write
-- expects to see.

ALTER TABLE "trips" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "trips" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "trips" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "trips" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "expenses" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "expenses" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "expenses" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "incomes" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "incomes" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "incomes" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "clients" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "clients" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "clients" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "drivers" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "drivers" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "drivers" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "vehicles" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "vehicles" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "vehicles" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "trip_events" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "trip_events" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "trip_events" ALTER COLUMN "updated_at" SET NOT NULL;
