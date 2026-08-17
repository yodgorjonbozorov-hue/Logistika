-- Audit log immutability (TASK-2.9).
--
-- An audit trail that the application can edit is not evidence. The same
-- credentials that write "user X changed the salary" could rewrite that row
-- afterwards, so the database refuses UPDATE and DELETE outright.
--
-- Inserts stay allowed; retention/archival is a deliberate operation done as a
-- privileged role after disabling the trigger, and is documented in
-- docs/BUSINESS-RULES.md when that policy is set.
--
-- Existing rows: untouched. Only what may be done to them changes.

CREATE OR REPLACE FUNCTION audit_logs_are_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update ON "audit_logs";
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_immutable();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON "audit_logs";
CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_immutable();
