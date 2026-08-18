-- Corrections to an expense are a second row, not a negative amount (L-8).
--
-- Expense.amount is unsigned by design, and an approved expense is immutable
-- because it is part of the financial record — which together left no way at
-- all to correct one. A refund from a supplier, or a receipt entered as
-- 5 000 000 instead of 500 000, simply could not be recorded.
--
-- The fix is the pattern the ledger already uses: the original stays exactly as
-- it was written, and a mirrored row cancels it. A reversed pair sums to
-- nothing, so a cost report nets them out without needing a sign convention.
ALTER TABLE "expenses" ADD COLUMN "reversal_of_id" TEXT;

-- One reversal per expense: a second would cancel the same cost twice.
CREATE UNIQUE INDEX "expenses_reversal_of_id_key" ON "expenses" ("reversal_of_id");

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reversal_of_id_fkey"
  FOREIGN KEY ("reversal_of_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A row cannot cancel itself.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reversal_not_self_check"
  CHECK ("reversal_of_id" IS NULL OR "reversal_of_id" <> "id");
