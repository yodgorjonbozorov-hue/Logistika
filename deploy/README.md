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
