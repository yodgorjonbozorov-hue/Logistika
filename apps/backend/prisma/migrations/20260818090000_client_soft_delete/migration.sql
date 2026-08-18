-- Clients are retired, not deleted (TASK-3.11).
--
-- Every other catalogue in the product — drivers, vehicles — is soft-deleted so
-- the history keeps its names. Clients were hard-deleted. The foreign keys made
-- that fail once a trip or an income pointed at the client, which hid the
-- problem: it only succeeded for clients with nothing attached, and those
-- disappeared completely, leaving the audit `before` as the only trace that
-- they had ever existed.
--
-- Existing rows are all active: nobody could have been retired before the
-- column existed.

ALTER TABLE "clients" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- The list is filtered by it on every page load.
CREATE INDEX "clients_company_id_is_active_idx" ON "clients" ("company_id", "is_active");
