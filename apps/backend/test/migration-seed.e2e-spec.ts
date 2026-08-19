/**
 * C-2 / C-3 — deployment-time database operations, run for real.
 *
 * These are the steps a deploy actually performs, so they are tested the way a
 * deploy performs them: a throwaway database, `prisma migrate deploy`, the seed
 * script as a subprocess, then pg_dump/pg_restore. Nothing here is simulated.
 *
 * The critical property is that the migrations are safe on a database that
 * ALREADY HOLDS DATA — the audit's hardest constraint ("data o'chirma").
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

const BACKEND_ROOT = resolve(__dirname, '..');
const ADMIN_URL = 'postgresql://truckcontrol:change-me@127.0.0.1:5432/postgres';

/** Prisma connection string — carries the Prisma-only `?schema=` parameter. */
const urlFor = (database: string) =>
  `postgresql://truckcontrol:change-me@127.0.0.1:5432/${database}?schema=public`;

/**
 * Plain libpq connection string for pg_dump/pg_restore.
 * `?schema=public` is a Prisma extension; libpq rejects it outright with
 * "invalid URI query parameter", which is exactly how a backup script written
 * against DATABASE_URL fails in production.
 */
const pgUrlFor = (database: string) =>
  `postgresql://truckcontrol:change-me@127.0.0.1:5432/${database}`;

async function withAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Convenience for the very common "one scalar row" case. */
async function queryOne<T = Record<string, unknown>>(database: string, sql: string): Promise<T> {
  const rows = await query<T>(database, sql);
  if (rows.length === 0) throw new Error(`Expected one row from: ${sql}`);
  return rows[0]!;
}

async function query<T = Record<string, unknown>>(database: string, sql: string): Promise<T[]> {
  const client = new Client({ connectionString: urlFor(database) });
  await client.connect();
  try {
    return (await client.query(sql)).rows as T[];
  } finally {
    await client.end();
  }
}

function prisma(args: string[], database: string, extraEnv: Record<string, string> = {}): string {
  return execFileSync('npx', ['prisma', ...args], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_URL: urlFor(database), ...extraEnv },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

/** Names are unique per run so a crashed run never poisons the next one. */
const stamp = Date.now().toString(36);
const FRESH_DB = `tc_migrate_fresh_${stamp}`;
const EXISTING_DB = `tc_migrate_existing_${stamp}`;
const RESTORE_DB = `tc_restore_${stamp}`;
const BACKUP_SRC_DB = `tc_backup_src_${stamp}`;

describe('Migrations, seed and backup/restore', () => {
  const databases = [FRESH_DB, EXISTING_DB, RESTORE_DB, BACKUP_SRC_DB];

  beforeAll(async () => {
    await withAdmin(async (client) => {
      for (const database of databases) {
        await client.query(`DROP DATABASE IF EXISTS "${database}"`);
        await client.query(`CREATE DATABASE "${database}" OWNER truckcontrol`);
      }
    });
  }, 120_000);

  afterAll(async () => {
    await withAdmin(async (client) => {
      for (const database of databases) {
        await client.query(`DROP DATABASE IF EXISTS "${database}"`);
      }
    });
  }, 120_000);

  describe('C-3 migrations', () => {
    it('migrate deploy builds the whole schema on an empty database', async () => {
      const output = prisma(['migrate', 'deploy'], FRESH_DB);
      expect(output).toContain('migrations have been successfully applied');

      const tables = await query<{ tablename: string }>(
        FRESH_DB,
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      const names = tables.map((t) => t.tablename);
      for (const expected of [
        'companies',
        'users',
        'drivers',
        'vehicles',
        'trips',
        'trip_events',
        'expenses',
        'incomes',
        'gps_tracks',
        'refresh_tokens',
        'audit_logs',
        '_prisma_migrations',
      ]) {
        expect(names).toContain(expected);
      }
    }, 120_000);

    it('leaves no drift between the migrations and schema.prisma', () => {
      const diff = prisma(
        [
          'migrate',
          'diff',
          '--from-schema-datasource',
          'prisma/schema.prisma',
          '--to-schema-datamodel',
          'prisma/schema.prisma',
          '--script',
        ],
        FRESH_DB,
      );
      expect(diff).toContain('This is an empty migration');
    }, 120_000);

    it('is idempotent — a second deploy is a no-op', () => {
      const output = prisma(['migrate', 'deploy'], FRESH_DB);
      expect(output).toContain('No pending migrations');
    }, 120_000);

    it('records every migration in the history table', async () => {
      const rows = await query<{ migration_name: string; finished_at: Date | null }>(
        FRESH_DB,
        `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(3);
      expect(rows[0]!.migration_name).toContain('init');
      for (const row of rows) expect(row.finished_at).not.toBeNull();
    });

    it('creates the tenant-safety indexes the application relies on', async () => {
      const indexes = await query<{ indexname: string }>(
        FRESH_DB,
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
      );
      const names = indexes.map((i) => i.indexname);
      for (const expected of [
        'trips_one_active_per_driver',
        'trips_one_active_per_vehicle',
        'expenses_company_id_client_tx_id_key',
        'incomes_company_id_client_tx_id_key',
        'trip_events_company_id_client_event_id_key',
      ]) {
        expect(names).toContain(expected);
      }
    });

    it('stores money as int8 and timestamps without a local timezone', async () => {
      const columns = await query<{ table_name: string; column_name: string; data_type: string }>(
        FRESH_DB,
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public'
           AND ((table_name = 'expenses' AND column_name = 'amount')
             OR (table_name = 'incomes' AND column_name = 'amount')
             OR (table_name = 'trips' AND column_name IN ('agreed_price', 'created_at')))`,
      );
      const byKey = new Map(columns.map((c) => [`${c.table_name}.${c.column_name}`, c.data_type]));
      expect(byKey.get('expenses.amount')).toBe('bigint');
      expect(byKey.get('incomes.amount')).toBe('bigint');
      expect(byKey.get('trips.agreed_price')).toBe('bigint');
      // UTC everywhere: never `timestamp with time zone` bound to a server TZ.
      expect(byKey.get('trips.created_at')).toBe('timestamp without time zone');
    });

    it('every tenant table carries a company_id', async () => {
      const tenantTables = [
        'users',
        'drivers',
        'vehicles',
        'clients',
        'trips',
        'trip_events',
        'expenses',
        'incomes',
        'gps_tracks',
        'stored_files',
      ];
      const rows = await query<{ table_name: string }>(
        FRESH_DB,
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'company_id'`,
      );
      const withTenant = new Set(rows.map((r) => r.table_name));
      for (const table of tenantTables) expect(withTenant.has(table)).toBe(true);
    });
  });

  describe('C-3 migrations are non-destructive on a populated database', () => {
    it('preserves existing rows and backfills the new columns correctly', async () => {
      // 1. Bring the database up to the ORIGINAL baseline only.
      prisma(['migrate', 'resolve', '--applied', '00000000000000_init'], EXISTING_DB);
      execFileSync(
        'npx',
        [
          'prisma',
          'db',
          'execute',
          '--file',
          'prisma/migrations/00000000000000_init/migration.sql',
          '--url',
          urlFor(EXISTING_DB),
        ],
        { cwd: BACKEND_ROOT, stdio: 'pipe' },
      );

      // 2. Fill it with production-shaped data.
      const client = new Client({ connectionString: urlFor(EXISTING_DB) });
      await client.connect();
      try {
        await client.query(`
          INSERT INTO companies (id, name, created_at) VALUES ('co-1', 'Legacy Co', now());
          INSERT INTO users (id, company_id, full_name, password_hash, role, created_at, updated_at)
            VALUES ('u-1', 'co-1', 'Legacy Owner', 'hash', 'OWNER', now(), now());
          INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
            VALUES ('rt-1', 'u-1', 'legacy-hash', now() + interval '1 day', now());
          INSERT INTO trips (id, company_id, trip_number, agreed_price, driver_advance, status, currency, created_at)
            VALUES ('t-1', 'co-1', '7', 500, 0, 'COMPLETED', 'UZS', now()),
                   ('t-2', 'co-1', '12', 900, 0, 'COMPLETED', 'UZS', now());
        `);
      } finally {
        await client.end();
      }

      // 3. Apply the hardening migrations on top of live data.
      const output = prisma(['migrate', 'deploy'], EXISTING_DB);
      expect(output).toContain('migrations have been successfully applied');

      // 4. Nothing was lost.
      const trips = await queryOne<{ count: string }>(
        EXISTING_DB,
        'SELECT count(*)::text AS count FROM trips',
      );
      expect(trips.count).toBe('2');
      const users = await queryOne<{ count: string }>(
        EXISTING_DB,
        'SELECT count(*)::text AS count FROM users',
      );
      expect(users.count).toBe('1');

      // 5. The NOT NULL column was backfilled rather than failing the deploy.
      const token = await queryOne<{ family_id: string }>(
        EXISTING_DB,
        `SELECT family_id FROM refresh_tokens WHERE id = 'rt-1'`,
      );
      expect(token.family_id).toBe('rt-1');

      // 6. The trip counter was seeded PAST the highest existing number, so the
      //    new allocator cannot reissue a number that is already in use.
      const company = await queryOne<{ next_trip_number: number }>(
        EXISTING_DB,
        `SELECT next_trip_number FROM companies WHERE id = 'co-1'`,
      );
      expect(company.next_trip_number).toBe(13);
    }, 180_000);

    it('contains no destructive statements in any migration', () => {
      // Comments are stripped first: the hardening migration deliberately
      // DOCUMENTS that it performs no DROP TABLE/TRUNCATE, and matching that
      // sentence would be a false positive.
      const output = execFileSync(
        'bash',
        [
          '-c',
          `cat prisma/migrations/*/migration.sql | sed 's/--.*$//' | ` +
            `grep -inE '(DROP TABLE|TRUNCATE|DROP DATABASE|DROP COLUMN|` +
            `DELETE FROM (companies|users|trips|expenses|incomes|drivers|vehicles))' || true`,
        ],
        { cwd: BACKEND_ROOT, encoding: 'utf8' },
      );
      expect(output.trim()).toBe('');
    });
  });

  describe('C-2 SUPERADMIN seed', () => {
    const SEED_EMAIL = 'bootstrap@truckcontrol.test';
    const SEED_PASSWORD = 'Str0ng-Bootstrap-Secret-2026';

    function seed(env: Record<string, string>): { ok: boolean; output: string } {
      try {
        const output = execFileSync('npx', ['prisma', 'db', 'seed'], {
          cwd: BACKEND_ROOT,
          env: { ...process.env, DATABASE_URL: urlFor(FRESH_DB), ...env },
          encoding: 'utf8',
          stdio: 'pipe',
        });
        return { ok: !output.includes('Seed failed'), output };
      } catch (error) {
        const err = error as { stdout?: string; stderr?: string };
        return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
      }
    }

    it('refuses to run without credentials in the environment', () => {
      const result = seed({ SUPERADMIN_EMAIL: '', SUPERADMIN_PASSWORD: '' });
      expect(result.ok).toBe(false);
      expect(result.output).toContain('SUPERADMIN_EMAIL is required');
    }, 120_000);

    it('refuses a weak password', () => {
      const result = seed({ SUPERADMIN_EMAIL: SEED_EMAIL, SUPERADMIN_PASSWORD: 'short' });
      expect(result.ok).toBe(false);
      expect(result.output).toContain('at least 12 characters');
    }, 120_000);

    it('refuses a well-known placeholder password', () => {
      const result = seed({ SUPERADMIN_EMAIL: SEED_EMAIL, SUPERADMIN_PASSWORD: 'changeme' });
      expect(result.ok).toBe(false);
    }, 120_000);

    it('creates exactly one SUPERADMIN with an argon2 hash', async () => {
      const result = seed({ SUPERADMIN_EMAIL: SEED_EMAIL, SUPERADMIN_PASSWORD: SEED_PASSWORD });
      expect(result.ok).toBe(true);

      const rows = await query<{
        email: string;
        role: string;
        password_hash: string;
        company_id: string | null;
      }>(
        FRESH_DB,
        `SELECT email, role, password_hash, company_id FROM users WHERE role = 'SUPERADMIN'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.email).toBe(SEED_EMAIL);
      expect(rows[0]!.company_id).toBeNull(); // platform staff, not a tenant
      expect(rows[0]!.password_hash.startsWith('$argon2id$')).toBe(true);
      expect(rows[0]!.password_hash).not.toContain(SEED_PASSWORD);
    }, 120_000);

    it('is idempotent — running it again creates no second account', async () => {
      const result = seed({ SUPERADMIN_EMAIL: SEED_EMAIL, SUPERADMIN_PASSWORD: SEED_PASSWORD });
      expect(result.ok).toBe(true);
      expect(result.output).toContain('already exists');

      const superadmins = await queryOne<{ count: string }>(
        FRESH_DB,
        `SELECT count(*)::text AS count FROM users WHERE role = 'SUPERADMIN'`,
      );
      expect(superadmins.count).toBe('1');
    }, 120_000);

    it('refuses to escalate an existing non-SUPERADMIN account', async () => {
      await query(
        FRESH_DB,
        `INSERT INTO users (id, full_name, email, password_hash, role, created_at, updated_at)
         VALUES ('victim', 'Existing Person', 'victim@truckcontrol.test', 'x', 'LOGIST', now(), now())`,
      );
      const result = seed({
        SUPERADMIN_EMAIL: 'victim@truckcontrol.test',
        SUPERADMIN_PASSWORD: SEED_PASSWORD,
      });

      expect(result.ok).toBe(false);
      expect(result.output).toContain('Refusing to escalate');
      const victim = await queryOne<{ role: string }>(
        FRESH_DB,
        `SELECT role FROM users WHERE id = 'victim'`,
      );
      expect(victim.role).toBe('LOGIST');
    }, 120_000);
  });

  describe('backup and restore', () => {
    let backupDir: string;

    // A self-contained source database: the restore test must not silently
    // depend on what an earlier test happened to leave behind.
    beforeAll(async () => {
      backupDir = mkdtempSync(join(tmpdir(), 'tc-backup-'));
      prisma(['migrate', 'deploy'], BACKUP_SRC_DB);
      const client = new Client({ connectionString: urlFor(BACKUP_SRC_DB) });
      await client.connect();
      try {
        await client.query(`
          INSERT INTO companies (id, name, next_trip_number, created_at)
            VALUES ('co-1', 'Backup Co', 13, now());
          INSERT INTO users (id, company_id, full_name, password_hash, role, created_at, updated_at)
            VALUES ('u-1', 'co-1', 'Backup Owner', 'hash', 'OWNER', now(), now());
          INSERT INTO drivers (id, company_id, full_name, created_at)
            VALUES ('d-1', 'co-1', 'Backup Driver', now());
          INSERT INTO trips (id, company_id, trip_number, agreed_price, driver_advance, status, currency, created_at)
            VALUES ('t-1', 'co-1', '7', 500, 0, 'COMPLETED', 'UZS', now()),
                   ('t-2', 'co-1', '12', 900, 0, 'COMPLETED', 'UZS', now());
          INSERT INTO expenses (id, company_id, trip_id, category, amount, currency, expense_date, created_at)
            VALUES ('e-1', 'co-1', 't-1', 'FUEL', 123456789, 'UZS', now(), now());
        `);
      } finally {
        await client.end();
      }
    }, 180_000);
    afterAll(() => rmSync(backupDir, { recursive: true, force: true }));

    it('a pg_dump backup restores into a clean database with identical data', async () => {
      const backupFile = join(backupDir, 'backup.dump');

      // Snapshot the source counts and a known row.
      const before = await query<{ table_name: string; rows: string }>(
        BACKUP_SRC_DB,
        `SELECT 'trips' AS table_name, count(*)::text AS rows FROM trips
         UNION ALL SELECT 'users', count(*)::text FROM users
         UNION ALL SELECT 'companies', count(*)::text FROM companies`,
      );

      execFileSync(
        'pg_dump',
        [
          '--format=custom',
          '--no-owner',
          '--no-acl',
          '--file',
          backupFile,
          pgUrlFor(BACKUP_SRC_DB),
        ],
        { stdio: 'pipe' },
      );

      execFileSync(
        'pg_restore',
        ['--no-owner', '--no-acl', '--dbname', pgUrlFor(RESTORE_DB), backupFile],
        { stdio: 'pipe' },
      );

      // Schema survived.
      const restoredTables = await query<{ tablename: string }>(
        RESTORE_DB,
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      expect(restoredTables.length).toBeGreaterThan(10);

      // Row counts match.
      const after = await query<{ table_name: string; rows: string }>(
        RESTORE_DB,
        `SELECT 'trips' AS table_name, count(*)::text AS rows FROM trips
         UNION ALL SELECT 'users', count(*)::text FROM users
         UNION ALL SELECT 'companies', count(*)::text FROM companies`,
      );
      expect(after).toEqual(before);

      // Critical data — not just counts — came back intact.
      const trip = await queryOne<{ trip_number: string; agreed_price: string }>(
        RESTORE_DB,
        `SELECT trip_number, agreed_price::text FROM trips WHERE id = 't-1'`,
      );
      expect(trip.trip_number).toBe('7');
      expect(trip.agreed_price).toBe('500');

      // Money keeps full BigInt precision through dump and restore.
      const expense = await queryOne<{ amount: string }>(
        RESTORE_DB,
        `SELECT amount::text AS amount FROM expenses WHERE id = 'e-1'`,
      );
      expect(expense.amount).toBe('123456789');

      // Indexes and constraints came back too, not just the rows.
      const restoredIndexes = await query<{ indexname: string }>(
        RESTORE_DB,
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
      );
      expect(restoredIndexes.map((i) => i.indexname)).toContain('trips_one_active_per_driver');

      // And the migration history, so the restored database can be migrated on.
      const migrations = await queryOne<{ count: string }>(
        RESTORE_DB,
        'SELECT count(*)::text AS count FROM _prisma_migrations',
      );
      expect(Number(migrations.count)).toBeGreaterThanOrEqual(3);
    }, 240_000);

    it('the restored database accepts a further migrate deploy without drift', () => {
      const output = prisma(['migrate', 'deploy'], RESTORE_DB);
      expect(output).toContain('No pending migrations');
    }, 120_000);
  });
});
