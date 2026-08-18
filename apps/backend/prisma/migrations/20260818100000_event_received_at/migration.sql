-- When the server accepted a driver event (TASK-3.12, M-5).
--
-- eventTime comes from the phone, whose clock the server does not control, and
-- an offline queue can hold an event for days. Without a server-side stamp
-- there is no way to tell a late sync from a wrong clock — both look like an
-- event dated last Tuesday.
--
-- EXISTING ROWS: backfilled from created_at, which is exactly when the server
-- accepted them.
ALTER TABLE "trip_events" ADD COLUMN "received_at" TIMESTAMP(3);
UPDATE "trip_events" SET "received_at" = "created_at" WHERE "received_at" IS NULL;
ALTER TABLE "trip_events" ALTER COLUMN "received_at" SET NOT NULL;
ALTER TABLE "trip_events" ALTER COLUMN "received_at" SET DEFAULT CURRENT_TIMESTAMP;
