-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "trip_status" ADD VALUE 'PARTIALLY_DELIVERED';
ALTER TYPE "trip_status" ADD VALUE 'RETURNED';
ALTER TYPE "trip_status" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "delivered_amount" BIGINT,
ADD COLUMN     "status_changed_at" TIMESTAMP(3),
ADD COLUMN     "status_reason" TEXT;
