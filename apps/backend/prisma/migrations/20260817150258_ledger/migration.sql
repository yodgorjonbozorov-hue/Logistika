-- CreateEnum
CREATE TYPE "ledger_direction" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "ledger_reason" AS ENUM ('TRIP_INVOICED', 'PAYMENT_RECEIVED', 'ADJUSTMENT', 'REFUND', 'DRIVER_ADVANCE', 'REVERSAL');

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "client_id" TEXT,
    "driver_id" TEXT,
    "trip_id" TEXT,
    "income_id" TEXT,
    "expense_id" TEXT,
    "direction" "ledger_direction" NOT NULL,
    "reason" "ledger_reason" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" "currency" NOT NULL DEFAULT 'UZS',
    "amount_base" BIGINT NOT NULL,
    "rate_used" DECIMAL(18,6),
    "rate_date" TIMESTAMP(3),
    "reference" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_by_entry_id" TEXT,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reversed_by_entry_id_key" ON "ledger_entries"("reversed_by_entry_id");

-- CreateIndex
CREATE INDEX "ledger_entries_company_id_client_id_created_at_idx" ON "ledger_entries"("company_id", "client_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_company_id_trip_id_idx" ON "ledger_entries"("company_id", "trip_id");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversed_by_entry_id_fkey" FOREIGN KEY ("reversed_by_entry_id") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_income_id_fkey" FOREIGN KEY ("income_id") REFERENCES "incomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
