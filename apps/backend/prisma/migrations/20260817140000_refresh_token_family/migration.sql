-- Refresh-token reuse detection (TASK-2.4).
--
-- Rotation alone is not enough: when a stolen token is replayed, the server has
-- to notice and kill the whole family, not just answer 401 (OWASP). Tracking
-- which token replaced which is what makes that possible.
--
-- Existing rows: keep their data. replaced_by_id stays NULL (their chain is
-- unknown, which is correct — they were issued before this was tracked), and
-- family_id defaults to the row's own id, making every existing token the root
-- of its own family.

ALTER TABLE "refresh_tokens" ADD COLUMN "replaced_by_id" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" TEXT;

UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;

-- The cleanup job deletes by expiry (L-3), and reuse detection revokes by family.
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
