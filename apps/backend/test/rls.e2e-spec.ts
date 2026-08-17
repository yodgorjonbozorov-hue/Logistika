import { PrismaClient } from '@prisma/client';
import '../src/common/serialization';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Row-level security, proved against the database itself (docs/SECURITY.md F-4).
 *
 * The other e2e suites drive the application, so they prove the *application*
 * scopes its queries. This one deliberately does the opposite: it uses a bare
 * Prisma client with no tenant extension, asks for rows with no company filter
 * at all, and expects PostgreSQL to withhold them. That is the whole point of a
 * third layer — it has to hold when the application layer does not.
 *
 * A superuser is exempt from row-level security no matter what the policies say,
 * so when the connection happens to be one, the suite makes itself a restricted
 * role and uses that instead — otherwise it would pass while proving nothing.
 *
 *   docker compose up -d postgres
 *   DATABASE_URL=... pnpm --filter backend test:e2e
 */
const admin = new PrismaClient();

const RLS_ROLE = 'truckcontrol_rls_test';
const RLS_PASSWORD = 'rls-test-password';

const A = {
  company: '00000000-0000-4000-8000-00000000000d',
  vehicle: '00000000-0000-4000-8000-0000000000d1',
  trip: '00000000-0000-4000-8000-0000000000d2',
};
const B = {
  company: '00000000-0000-4000-8000-00000000000e',
  vehicle: '00000000-0000-4000-8000-0000000000e1',
  trip: '00000000-0000-4000-8000-0000000000e2',
};

/** The same database, reached as a role that policies actually apply to. */
function restrictedUrl(): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.username = RLS_ROLE;
  url.password = RLS_PASSWORD;
  return url.toString();
}

/**
 * Returns a client the policies apply to.
 *
 * When the suite already runs as a restricted role — how CI runs it, and how a
 * production deployment connects — that client is simply the one we have. When
 * it runs as a superuser (a plain local database, a CI service container), the
 * policies would be bypassed and prove nothing, so a restricted role is made on
 * the spot and used instead.
 */
async function restrictedClient(): Promise<PrismaClient> {
  const [role] = await admin.$queryRaw<Array<{ exempt: boolean }>>`
    SELECT (rolsuper OR rolbypassrls) AS exempt FROM pg_roles WHERE rolname = current_user
  `;
  if (!role?.exempt) return admin;

  await admin.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${RLS_ROLE}') THEN
        CREATE ROLE ${RLS_ROLE} LOGIN PASSWORD '${RLS_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;
  `);
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${RLS_ROLE}`);
  await admin.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RLS_ROLE}`,
  );
  return new PrismaClient({ datasources: { db: { url: restrictedUrl() } } });
}

async function wipe(): Promise<void> {
  const companies = [A.company, B.company];
  await admin.trackingLink.deleteMany({ where: { companyId: { in: companies } } });
  await admin.trip.deleteMany({ where: { companyId: { in: companies } } });
  await admin.vehicle.deleteMany({ where: { companyId: { in: companies } } });
  await admin.company.deleteMany({ where: { id: { in: companies } } });
}

async function seed(): Promise<void> {
  await admin.company.createMany({
    data: [
      { id: A.company, name: 'RLS A' },
      { id: B.company, name: 'RLS B' },
    ],
  });
  await admin.vehicle.createMany({
    data: [
      { id: A.vehicle, companyId: A.company, plateNumber: '01 D 111 DD' },
      { id: B.vehicle, companyId: B.company, plateNumber: '01 E 111 EE' },
    ],
  });
  await admin.trip.createMany({
    data: [
      { id: A.trip, companyId: A.company, tripNumber: 'RLS-A-1' },
      { id: B.trip, companyId: B.company, tripNumber: 'RLS-B-1' },
    ],
  });
  const expiresAt = new Date(Date.now() + 86_400_000);
  await admin.trackingLink.createMany({
    data: [
      { companyId: A.company, tripId: A.trip, token: 'rls-token-a', expiresAt },
      { companyId: B.company, tripId: B.trip, token: 'rls-token-b', expiresAt },
    ],
  });
}

describe('row-level security (docs/SECURITY.md F-4)', () => {
  let restricted: PrismaClient;

  beforeAll(async () => {
    restricted = await restrictedClient();
    await wipe();
    await seed();
  });

  afterAll(async () => {
    if (restricted !== admin) await restricted?.$disconnect();
    await wipe();
    await admin.$disconnect();
  });

  /** Runs a query with the tenant setting PostgreSQL's policies read. */
  function asCompany<T>(companyId: string, operation: () => Promise<T>): Promise<T> {
    return restricted
      .$transaction([
        restricted.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`,
        operation() as unknown as ReturnType<PrismaClient['$executeRaw']>,
      ])
      .then(([, result]) => result as T);
  }

  it('hides another company even when the query asks for everything', async () => {
    const rows = await asCompany(B.company, () => restricted.vehicle.findMany());
    // No `where` at all — the filter came from the database, not the caller.
    expect(rows.map((row) => row.id)).toEqual([B.vehicle]);
  });

  it("hides another company's row when it is asked for by primary key", async () => {
    const row = await asCompany(B.company, () =>
      restricted.vehicle.findUnique({ where: { id: A.vehicle } }),
    );
    expect(row).toBeNull();
  });

  it('refuses to write a row into another company', async () => {
    // This is the nested-write hole the tenant extension does not close: it
    // rewrites top-level arguments only, so a company_id that slips through
    // has to be stopped here.
    await expect(
      asCompany(B.company, () =>
        restricted.vehicle.create({
          data: { companyId: A.company, plateNumber: 'SMUGGLED' },
        }),
      ),
    ).rejects.toThrow();
    expect(await admin.vehicle.count({ where: { plateNumber: 'SMUGGLED' } })).toBe(0);
  });

  it("changes nothing when it updates or deletes another company's rows", async () => {
    const updated = await asCompany(B.company, () =>
      restricted.vehicle.updateMany({
        where: { id: A.vehicle },
        data: { plateNumber: 'STOLEN' },
      }),
    );
    expect(updated.count).toBe(0);

    const deleted = await asCompany(B.company, () =>
      restricted.vehicle.deleteMany({ where: { id: A.vehicle } }),
    );
    expect(deleted.count).toBe(0);

    const survivor = await admin.vehicle.findUnique({ where: { id: A.vehicle } });
    expect(survivor?.plateNumber).toBe('01 D 111 DD');
  });

  it('leaves the tenant-free paths unrestricted', async () => {
    // Logging in, the nightly cron jobs and the seed all run before a tenant is
    // known. They use the bare client, set nothing, and must still see the
    // fleet — the escape hatch is deliberate, so it is tested, not assumed.
    const rows = await restricted.vehicle.findMany({
      where: { companyId: { in: [A.company, B.company] } },
    });
    expect(rows).toHaveLength(2);
  });

  it('is fed by the tenant extension, on a model the extension does not filter', async () => {
    // TrackingLink is outside TENANT_MODELS on purpose — it is looked up by a
    // bare public token — so `forCompany()` adds no company filter to this
    // query. All it contributes is the setting. Getting one row back therefore
    // proves two things at once: the extension really does send the tenant to
    // PostgreSQL, and the policy catches a model the extension leaves alone.
    // That second case is exactly the "forgotten model" this layer exists for.
    const service =
      restricted === admin
        ? new PrismaService()
        : new PrismaService({ datasources: { db: { url: restrictedUrl() } } });
    try {
      const links = await service.forCompany(B.company).trackingLink.findMany();
      expect(links.map((link) => link.token)).toEqual(['rls-token-b']);
    } finally {
      await service.$disconnect();
    }
  });

  it('does not carry one tenant into the next query on the same connection', async () => {
    // The setting is transaction-local. If it were not, a pooled connection
    // would hand the previous request's tenant to the next one.
    await asCompany(A.company, () => restricted.vehicle.findMany());
    const rows = await restricted.$queryRaw<Array<{ value: string | null }>>`
      SELECT nullif(current_setting('app.company_id', true), '') AS value
    `;
    expect(rows[0]?.value).toBeNull();
  });
});
