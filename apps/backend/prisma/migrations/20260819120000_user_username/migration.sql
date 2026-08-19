-- An optional login name, so an account with neither an e-mail nor a phone
-- (platform staff) can still sign in. Nullable, so no existing row changes.
ALTER TABLE "users" ADD COLUMN "username" TEXT;

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
