-- Per-company, per-year trip number sequence (TASK-3.7).
--
-- trip_number was count() + 1: it repeats a number as soon as a trip is
-- removed, and two trips created in the same second both read the same count
-- and ask for the same number. The retry loop around it gave up after three
-- collisions, so a busy morning surfaced a raw unique-constraint error.
--
-- A counter that is incremented rather than counted cannot do either. The row
-- is locked for the length of the transaction that took a number, so a second
-- creator waits and receives the next one.

-- CreateTable
CREATE TABLE "trip_counters" (
    "company_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_counters_pkey" PRIMARY KEY ("company_id","year")
);

-- AddForeignKey
ALTER TABLE "trip_counters" ADD CONSTRAINT "trip_counters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A counter can only count up.
ALTER TABLE "trip_counters"
  ADD CONSTRAINT "trip_counters_last_number_nonnegative_check"
  CHECK ("last_number" >= 0);

-- EXISTING DATA: start each company's counter above the trips it already has
-- for that year, so the first new number continues the sequence instead of
-- colliding with one already in use.
INSERT INTO "trip_counters" ("company_id", "year", "last_number", "updated_at")
SELECT company_id,
       EXTRACT(YEAR FROM created_at)::int AS year,
       COUNT(*)::int,
       NOW()
FROM "trips"
GROUP BY company_id, EXTRACT(YEAR FROM created_at)::int;

-- Same tenant isolation every company-scoped table carries (TASK-2.1). The
-- counter reveals how many trips a company runs, which is exactly the number a
-- competitor would want.
ALTER TABLE "trip_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trip_counters" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "trip_counters";
CREATE POLICY tenant_isolation ON "trip_counters"
  USING (company_id = NULLIF(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), ''));
