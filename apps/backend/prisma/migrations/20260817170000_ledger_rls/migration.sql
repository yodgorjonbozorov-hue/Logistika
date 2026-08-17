-- Row-level security and immutability for ledger_entries (TASK-3.1).
--
-- Every tenant table carries the tenant_isolation policy (TASK-2.1); a ledger
-- that leaked across companies would expose exactly the numbers a competitor
-- would want — who owes whom, and how much.
--
-- Existing rows: the table was created empty by the previous migration.

ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ledger_entries";
CREATE POLICY tenant_isolation ON "ledger_entries"
  USING (company_id = NULLIF(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), ''));

-- Append-only, like audit_logs: a mistake is corrected with a REVERSAL entry,
-- never by editing or deleting history. Reuses the trigger function created by
-- the audit-log migration.
DROP TRIGGER IF EXISTS ledger_entries_no_update ON "ledger_entries";
CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE OF amount, amount_base, direction, reason, company_id, client_id
  ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_immutable();

DROP TRIGGER IF EXISTS ledger_entries_no_delete ON "ledger_entries";
CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_immutable();
