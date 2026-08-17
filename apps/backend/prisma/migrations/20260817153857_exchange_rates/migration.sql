-- Multi-currency support (TASK-3.3).
--
-- Currency{UZS,USD,RUB,KZT} existed on every money table with no rate table and
-- no conversion code, so a report could add USD cents to UZS tiyin and produce
-- a number that means nothing.
--
-- EXISTING ROWS: every amount recorded so far is treated as UZS. That is true
-- of all data written before this migration — the UI only ever offered UZS and
-- `currency` defaults to it — so amount_base is backfilled from amount and
-- rate_used is left NULL to mark "no conversion happened", as opposed to a
-- conversion that used a rate of 1.

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "amount_base" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "rate_date" TIMESTAMP(3),
ADD COLUMN     "rate_used" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "incomes" ADD COLUMN     "amount_base" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "rate_date" TIMESTAMP(3),
ADD COLUMN     "rate_used" DECIMAL(18,6);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "currency" "currency" NOT NULL,
    "date" DATE NOT NULL,
    "rate_to_uzs" DECIMAL(18,6) NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exchange_rates_currency_date_idx" ON "exchange_rates"("currency", "date");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_currency_date_key" ON "exchange_rates"("currency", "date");

-- Backfill: pre-existing money is UZS, where base == amount by definition.
UPDATE "expenses" SET "amount_base" = "amount" WHERE "amount_base" = 0;
UPDATE "incomes"  SET "amount_base" = "amount" WHERE "amount_base" = 0;
