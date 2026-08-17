/**
 * Row-level security (TASK-2.1) — the acceptance test for isolation layer 3.
 *
 * The point is not that the Prisma extension filters correctly (the isolation
 * suite covers that). The point is what happens when the extension is *wrong*:
 * a raw query, a nested include, a forgotten scope. This suite deliberately
 * goes around the extension, as a restricted database role, and proves the
 * database itself refuses to hand over another tenant's rows.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, testDatabaseUrl, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

const RESTRICTED_ROLE = 'truckcontrol_rls_test';
const RESTRICTED_PASSWORD = 'rls-test-password';

/** Tables that must carry a tenant_isolation policy (tenant.extension.ts). */
const TENANT_TABLES = [
  'users',
  'drivers',
  'vehicles',
  'clients',
  'trips',
  'trip_events',
  'expenses',
  'fuel_logs',
  'incomes',
  'gps_tracks',
  'gps_tracks_archive',
  'maintenance',
  'documents',
  'notifications',
  'stored_files',
  'ledger_entries',
];

describe('PostgreSQL row-level security (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  /** Connects as a role WITHOUT BYPASSRLS — what production must look like. */
  let restricted: PrismaClient;
  let alpha: TenantFixture;
  let beta: TenantFixture;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());

    // The suite's own database user is the owner (and usually a superuser),
    // which bypasses RLS by definition, so the proof needs a plain role.
    await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS ${RESTRICTED_ROLE}`);
    await prisma.$executeRawUnsafe(
      `CREATE ROLE ${RESTRICTED_ROLE} LOGIN PASSWORD '${RESTRICTED_PASSWORD}'`,
    );
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${RESTRICTED_ROLE}`);
    await prisma.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RESTRICTED_ROLE}`,
    );

    const url = new URL(testDatabaseUrl());
    url.username = RESTRICTED_ROLE;
    url.password = RESTRICTED_PASSWORD;
    restricted = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  });

  afterAll(async () => {
    await restricted?.$disconnect();
    await prisma.$executeRawUnsafe(
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${RESTRICTED_ROLE}`,
    );
    await prisma.$executeRawUnsafe(`REVOKE USAGE ON SCHEMA public FROM ${RESTRICTED_ROLE}`);
    await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS ${RESTRICTED_ROLE}`);
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    alpha = await createTenant(app, 'Alpha');
    beta = await createTenant(app, 'Beta');
  });

  /** Runs raw SQL as the restricted role with a declared tenant context. */
  async function asTenant<T>(companyId: string | null, sql: string): Promise<T> {
    const [, rows] = await restricted.$transaction([
      restricted.$executeRaw`SELECT set_config('app.company_id', ${companyId ?? ''}, true)`,
      restricted.$queryRawUnsafe<T>(sql),
    ]);
    return rows as T;
  }

  it('every tenant table has row-level security forced on', async () => {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname IN (${TENANT_TABLES.map((t) => `'${t}'`).join(', ')})`,
    );

    expect(rows).toHaveLength(TENANT_TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      // Without FORCE the owner silently skips its own policies.
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('a connection that declares no tenant reads nothing at all', async () => {
    const rows = await asTenant<Array<{ count: bigint }>>(null, 'SELECT count(*) FROM trips');
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('a raw query for another tenant returns zero rows, extension or not', async () => {
    // Exactly the query a buggy service would issue: correct SQL, wrong tenant.
    const stolen = await asTenant<Array<{ id: string }>>(
      beta.company.id,
      `SELECT id FROM trips WHERE id = '${alpha.trip.id}'`,
    );
    expect(stolen).toHaveLength(0);

    const own = await asTenant<Array<{ id: string }>>(
      alpha.company.id,
      `SELECT id FROM trips WHERE id = '${alpha.trip.id}'`,
    );
    expect(own).toHaveLength(1);
  });

  it('an unfiltered SELECT only ever returns the declared tenant rows', async () => {
    const rows = await asTenant<Array<{ company_id: string }>>(
      alpha.company.id,
      'SELECT company_id FROM trips',
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.company_id === alpha.company.id)).toBe(true);
  });

  it('writes cannot be stamped with another tenant id', async () => {
    await expect(
      restricted.$transaction([
        restricted.$executeRaw`SELECT set_config('app.company_id', ${beta.company.id}, true)`,
        restricted.$executeRawUnsafe(
          `INSERT INTO clients (id, company_id, name, balance, created_at)
             VALUES ('${randomUUID()}', '${alpha.company.id}', 'smuggled', 0, now())`,
        ),
      ]),
    ).rejects.toThrow();

    const leaked = await prisma.client.findFirst({ where: { name: 'smuggled' } });
    expect(leaked).toBeNull();
  });

  it('updates and deletes cannot reach another tenant rows', async () => {
    const updated = await asTenant<Array<unknown>>(
      beta.company.id,
      `UPDATE trips SET cargo_name = 'hijacked' WHERE id = '${alpha.trip.id}' RETURNING id`,
    );
    expect(updated).toHaveLength(0);

    const deleted = await asTenant<Array<unknown>>(
      beta.company.id,
      `DELETE FROM trips WHERE id = '${alpha.trip.id}' RETURNING id`,
    );
    expect(deleted).toHaveLength(0);

    const trip = await prisma.trip.findUnique({ where: { id: alpha.trip.id } });
    expect(trip).not.toBeNull();
    expect(trip?.cargoName).toBeNull();
  });

  it('the tenant context does not leak to the next query on a pooled connection', async () => {
    await asTenant(alpha.company.id, 'SELECT 1');
    // set_config(..., true) is transaction-local: the next transaction starts
    // with no tenant declared, and therefore sees nothing.
    const rows = await restricted.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT count(*) FROM trips',
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });
});
