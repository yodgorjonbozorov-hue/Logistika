# Deployment

Production runbook for TruckControl AI. Everything here is a real, tested
procedure — the migration, seed and backup/restore paths are exercised by
`apps/backend/test/migration-seed.e2e-spec.ts` on every CI run.

## Shape

| Component  | Where                    | Notes                                      |
| ---------- | ------------------------ | ------------------------------------------ |
| Web        | Vercel (`apps/web`)      | `vercel.json` — SPA rewrites, CSP, caching |
| API        | Docker (`apps/backend`)  | `docker-compose.prod.yml`, behind nginx    |
| PostgreSQL | Docker volume or managed | the only stateful component that matters   |
| Redis      | Docker                   | shared rate-limit counters across replicas |
| MinIO      | Docker or S3-compatible  | receipt photos and documents               |

## First deployment

```bash
cp .env.example .env.production          # then fill it in — see below
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

The `migrate` service applies migrations and exits; `api` only starts once it
has succeeded. Then create the first platform administrator:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  -e SUPERADMIN_EMAIL=admin@yourdomain.uz \
  -e SUPERADMIN_PASSWORD="$(openssl rand -base64 24)" \
  api npx prisma db seed
```

The seed is idempotent and refuses weak or placeholder passwords. Record the
generated password in your password manager — it is never printed again.

## Secrets

Generate real values; the API refuses to boot in production on a placeholder:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET  (must differ from the refresh one)
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 32   # MINIO_ROOT_PASSWORD
openssl rand -base64 32   # BACKUP_PASSPHRASE
```

`apps/backend/src/config/env.validation.ts` enforces, in production only:
minimum secret length, distinct access/refresh secrets, an `https://` `WEB_URL`,
a real MinIO password, and no sample password left in `DATABASE_URL`.

## Migrations

**Migrations never run as part of a build, and never on API startup.**

- CI applies them in a dedicated `migrate` job gated on the `production-database`
  environment, so a human approves each schema change.
- The job first checks for drift and fails if the live schema differs from
  `schema.prisma`; applying migrations onto an unexpected schema is how data is
  lost.
- `prisma db push` is never used against production — it has no history and
  will happily drop a column.

Manual application, if you must:

```bash
DATABASE_URL=… pnpm --filter backend exec prisma migrate deploy
```

## Backups

`deploy/backup.sh` runs nightly at 02:00 UTC in the `backup` service. Each run:

1. `pg_dump --format=custom`
2. verifies the dump with `pg_restore --list` and refuses to continue if it
   looks truncated
3. encrypts with AES-256 (GPG, `BACKUP_PASSPHRASE`) and deletes the plaintext
4. writes a `.sha256` alongside it
5. copies offsite when `BACKUP_S3_TARGET` is set
6. **only then** prunes anything older than `BACKUP_RETENTION_DAYS`

Set `BACKUP_S3_TARGET`. A backup that lives on the same host as the database
survives a dropped table but not the host.

### Restoring

```bash
BACKUP_PASSPHRASE=… sh deploy/restore.sh \
  /backups/truckcontrol-20260819T020000Z.dump.gpg \
  postgresql://user:pass@host:5432/truckcontrol_restored
```

Note the URL has **no** `?schema=public`: that is Prisma-only syntax and libpq
rejects it. The script checks for it, verifies the checksum, refuses to
overwrite a populated database unless `RESTORE_ALLOW_OVERWRITE=true`, and prints
row counts, migration history and index checks afterwards.

**Test your restore on a schedule.** An untested backup is a hypothesis:

```bash
createdb restore_drill
BACKUP_PASSPHRASE=… sh deploy/restore.sh <latest-backup> postgresql://…/restore_drill
# check the row counts it prints, then
dropdb restore_drill
```

## Health probes

| Path                   | Question                           | Use for   |
| ---------------------- | ---------------------------------- | --------- |
| `/api/v1/health/live`  | is the process alive?              | liveness  |
| `/api/v1/health/ready` | can it serve? (DB + Redis + MinIO) | readiness |

Liveness touches no dependency on purpose: a slow database must not trigger a
restart loop. Readiness answers **503** while any dependency is down.

Neither is rate limited — a throttled probe reads as "unhealthy" and would
restart healthy pods — so nginx restricts them to private networks instead.

## Scaling

`API_REPLICAS` controls the API count. Everything that needs coordinating
already does:

- rate limits share Redis, so N replicas mean one limit rather than N
- the GPS archive cron takes a PostgreSQL advisory lock, so it runs once
- trip numbers come from an atomic counter, not `count() + 1`
- one driver or vehicle can hold only one in-progress trip, enforced by a
  partial unique index rather than by application timing

Set `TRUST_PROXY` to the number of proxies in front of the API (1 for the nginx
in this compose file). Leave it at 0 if the API is exposed directly: with it on,
a client can forge `X-Forwarded-For` and walk straight past the IP rate limits.

## TLS

Put real certificates in `deploy/certs/{fullchain.pem,privkey.pem}`. For
Let's Encrypt, point certbot's webroot at the `/.well-known/acme-challenge/`
location already configured in `deploy/nginx.conf`.

## Web build configuration

`VITE_API_URL` is baked into the bundle at build time and **must** be set for a
production build:

```
VITE_API_URL=https://api.truckcontrol.uz/api/v1
```

On Vercel it belongs in the project's environment variables. The build refuses
to run without it (`apps/web/vite.config.ts`) — the client's fallback is
`http://localhost:3000/api/v1`, so a bundle built without it asks each
visitor's own machine for data over plain HTTP, fails for everyone, and looks
perfectly healthy from the build log.

The origin in `VITE_API_URL` must also appear in the `connect-src` directive of
the CSP in `apps/web/vercel.json`, and in the API's `WEB_URL` (which is the only
origin CORS allows).

## Staging

`deploy/staging/` brings up a complete, production-shaped environment on one
host: PostgreSQL, Redis, MinIO, the built API (`node dist/main.js`, not
`nest start`), the built web bundle, and nginx with TLS in front of both.

```bash
# hostnames used by the staging vhosts
echo "127.0.0.1 staging.truckcontrol.local api.staging.truckcontrol.local" >> /etc/hosts

SUPERADMIN_EMAIL=admin@staging.local SUPERADMIN_PASSWORD="$(openssl rand -base64 24)" \
  bash deploy/staging/up.sh          # generates secrets on first run
bash deploy/staging/down.sh
```

`up.sh` refuses to run against a database whose name does not end in
`_staging`, checks every dependency is genuinely reachable before building,
applies migrations, verifies there is no drift, and waits for the API's own
readiness probe before starting nginx.

## Smoke tests

`deploy/smoke-test.sh` verifies a **running deployment**, which is a different
question from whether the tests pass. It covers PostgreSQL (connectivity,
migration state, every tenant table scoped), Redis, object storage, the TLS
edge (protocol versions, HTTP/2, security headers, the redirect), the web
bundle (SPA fallback, cache policy, no secrets), API health and readiness,
authentication (including the httpOnly/Secure/SameSite refresh cookie), CORS,
tenant isolation and RBAC over the wire, the finance figures, file upload
through to the object store, payload limits and rate limiting.

```bash
# against the local staging stack
SUPERADMIN_EMAIL=… SUPERADMIN_PASSWORD=… bash deploy/smoke-test.sh

# against any other deployment
BASE_URL=https://api.example.uz WEB_BASE_URL=https://app.example.uz \
  bash deploy/smoke-test.sh
```

The exit code is the number of failed checks. A plain-HTTP `BASE_URL` means the
API is being exercised directly, and the edge/bundle sections announce
themselves as skipped rather than failing checks that do not apply — that is how
the `deployment-smoke` CI job runs it against the built artefacts.

For the browser half — the shipped bundle actually reaching the shipped API
across origins, with the CSP and the refresh cookie in play — run:

```bash
STAGING_WEB_URL=https://staging.truckcontrol.local \
STAGING_EMAIL=… STAGING_PASSWORD=… STAGING_BROWSER_DIRECT=1 \
  pnpm --filter web exec playwright test --project=staging
```

## Migration and rollback drill

Rehearsed on staging, not assumed:

1. Restore the previous release's backup into a scratch database.
2. `prisma migrate deploy` — confirm every pre-existing row is unchanged.
3. Roll back by restoring the pre-migration backup: the migration history goes
   back to its previous length and the new tables disappear.
4. `prisma migrate deploy` again to roll forward.

Prisma has no down-migrations, so **restore-from-backup is the rollback path**.
That is only true if the backup is fresh, which is why the migrate job warns
when a pending migration contains `DROP TABLE`, `DROP COLUMN` or `TRUNCATE`.

An additive migration (a new table, nullable columns) is rollback-safe in a
second sense: the previous application version keeps running against the new
schema, so the code can be rolled back without touching the database at all.
