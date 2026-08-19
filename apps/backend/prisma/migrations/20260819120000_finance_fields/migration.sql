-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "fuel_deviation_percent" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "planned_total_km" INTEGER,
ADD COLUMN     "purchase_price" BIGINT;

