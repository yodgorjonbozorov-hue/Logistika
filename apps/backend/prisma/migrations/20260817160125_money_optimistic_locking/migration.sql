-- Optimistic lock for money rows (TASK-3.5).
--
-- Expense and Income are edited the same read-then-write way Trip was: read the
-- row, decide it may be changed, write it back. Between the read and the write
-- an approval or a second correction can land, and the second writer overwrites
-- a decision it never saw. `version` gives those writes something to compare
-- against, so exactly one of two racing edits lands.
--
-- Every existing row starts at version 0, which is what a first write expects.

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "incomes" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;
