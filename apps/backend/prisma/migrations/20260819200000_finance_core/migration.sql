-- Finance core (roadmap phase 7).
--
-- Purely additive: one new table, two nullable columns, and indexes. No column
-- is dropped or retyped, so it applies to a populated production database with
-- nothing to back-fill and nothing at risk.
--
-- `routes` exists because route analytics cannot be built on the free-text
-- loading/unloading addresses — three spellings of "Toshkent" would become
-- three routes and every per-route number would be wrong.

-- AlterTable
ALTER TABLE "fuel_logs" ADD COLUMN     "client_tx_id" TEXT,
ADD COLUMN     "created_by" TEXT;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "route_id" TEXT;

-- CreateTable
CREATE TABLE "routes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin_name" TEXT NOT NULL,
    "destination_name" TEXT NOT NULL,
    "planned_distance_km" DECIMAL(9,1),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "routes_company_id_is_active_idx" ON "routes"("company_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "routes_company_id_name_key" ON "routes"("company_id", "name");

-- CreateIndex
CREATE INDEX "expenses_company_id_vehicle_id_expense_date_idx" ON "expenses"("company_id", "vehicle_id", "expense_date");

-- CreateIndex
CREATE INDEX "expenses_company_id_category_expense_date_idx" ON "expenses"("company_id", "category", "expense_date");

-- CreateIndex
CREATE INDEX "fuel_logs_company_id_refuel_time_idx" ON "fuel_logs"("company_id", "refuel_time");

-- CreateIndex
CREATE INDEX "fuel_logs_company_id_trip_id_idx" ON "fuel_logs"("company_id", "trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_logs_company_id_client_tx_id_key" ON "fuel_logs"("company_id", "client_tx_id");

-- CreateIndex
CREATE INDEX "trips_company_id_route_id_status_idx" ON "trips"("company_id", "route_id", "status");

-- CreateIndex
CREATE INDEX "trips_company_id_finished_at_idx" ON "trips"("company_id", "finished_at");

-- CreateIndex
CREATE INDEX "trips_company_id_started_at_idx" ON "trips"("company_id", "started_at");

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

