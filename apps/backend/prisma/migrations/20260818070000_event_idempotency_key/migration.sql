-- Per-tenant idempotency key for driver events (TASK-3.8).
--
-- client_event_id is what makes an offline resend safe: the phone keeps the id
-- it generated and the server recognises the second delivery. Two things were
-- wrong with how it was stored.
--
-- 1. NULLABLE. A key that may be absent deduplicates nothing, and Postgres
--    treats every NULL as distinct, so those rows had no protection at all.
--    The DTO has always required it, so this only closes the gap between what
--    the API accepts and what the table allows.
--
-- 2. GLOBALLY UNIQUE. One tenant's ids decided what another tenant could
--    store: a driver who learned an id belonging to another company could have
--    their own event reported as an already-seen duplicate and silently
--    dropped. The key is scoped to the company, like every other tenant key.
--
-- EXISTING ROWS: any row without a key gets one. A generated id matches no
-- phone's queue, so it can never collide with a resend — which is exactly the
-- behaviour those rows already had.
UPDATE "trip_events" SET "client_event_id" = gen_random_uuid()::text
WHERE "client_event_id" IS NULL;

-- Rows that already share a key across companies would block the new index.
-- (None exist today; this keeps the migration safe on any older database.)
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "company_id", "client_event_id" ORDER BY "created_at", id
         ) AS position
  FROM "trip_events"
)
UPDATE "trip_events" e
SET "client_event_id" = gen_random_uuid()::text
FROM duplicates d
WHERE e.id = d.id AND d.position > 1;

-- DropIndex
DROP INDEX "trip_events_client_event_id_key";

-- AlterTable
ALTER TABLE "trip_events" ALTER COLUMN "client_event_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "trip_events_company_id_client_event_id_key" ON "trip_events"("company_id", "client_event_id");
