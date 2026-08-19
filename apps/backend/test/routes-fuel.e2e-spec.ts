/**
 * Routes and fuel logs on real PostgreSQL.
 *
 * These two modules are what the finance rollups read from, so the guarantees
 * that matter are the ones that keep the numbers honest: a foreign key may
 * never point outside the caller's company, a retried refuel may not book the
 * litres twice, litres and money may not round-trip through a double, and a
 * deletion has to leave the whole row behind in the audit log.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  api,
  auth,
  createCompany,
  createTestApp,
  createUser,
  login,
  prisma,
  resetDatabase,
  resetRateLimits,
  uniqueSuffix,
  type TestUser,
} from './harness';

/** The audit writer is fire-and-forget; give it a tick to land. */
const settleAudit = () => new Promise((resolve) => setTimeout(resolve, 300));

interface Tenant {
  companyId: string;
  owner: TestUser;
  vehicleId: string;
  routeId: string;
}

async function seedTenant(app: NestExpressApplication, label: string): Promise<Tenant> {
  const company = await createCompany();
  const owner = await login(app, company.owner);
  const vehicle = await api(app)
    .post('/api/v1/vehicles')
    .set(auth(owner.accessToken))
    .send({ plateNumber: `01${label}${uniqueSuffix().slice(-4).toUpperCase()}` })
    .expect(201);
  const route = await api(app)
    .post('/api/v1/routes')
    .set(auth(owner.accessToken))
    .send({
      name: `Lane ${label}-${uniqueSuffix()}`,
      originName: 'Toshkent',
      destinationName: 'Nukus',
      plannedDistanceKm: '1210.5',
    })
    .expect(201);
  return {
    companyId: company.id,
    owner,
    vehicleId: vehicle.body.data.id,
    routeId: route.body.data.id,
  };
}

describe('Routes', () => {
  let app: NestExpressApplication;
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetRateLimits(app);
    a = await seedTenant(app, 'A');
    b = await seedTenant(app, 'B');
  });

  it('keeps the planned distance exact rather than rounding it through a double', async () => {
    const { body } = await api(app)
      .get(`/api/v1/routes/${a.routeId}`)
      .set(auth(a.owner.accessToken))
      .expect(200);
    expect(body.data.plannedDistanceKm).toBe('1210.5');

    const row = await prisma.route.findUniqueOrThrow({ where: { id: a.routeId } });
    expect(row.plannedDistanceKm?.toFixed(1)).toBe('1210.5');
  });

  it('rejects a distance with more precision than the column holds', async () => {
    await api(app)
      .post('/api/v1/routes')
      .set(auth(a.owner.accessToken))
      .send({
        name: `Too precise ${uniqueSuffix()}`,
        originName: 'A',
        destinationName: 'B',
        plannedDistanceKm: '100.55',
      })
      .expect(400);
  });

  it('refuses a duplicate route name inside one company', async () => {
    const name = `Duplicate ${uniqueSuffix()}`;
    const body = { name, originName: 'A', destinationName: 'B' };
    await api(app).post('/api/v1/routes').set(auth(a.owner.accessToken)).send(body).expect(201);
    await api(app).post('/api/v1/routes').set(auth(a.owner.accessToken)).send(body).expect(409);
  });

  it('allows the same route name in a different company', async () => {
    const name = `Shared name ${uniqueSuffix()}`;
    const body = { name, originName: 'A', destinationName: 'B' };
    await api(app).post('/api/v1/routes').set(auth(a.owner.accessToken)).send(body).expect(201);
    await api(app).post('/api/v1/routes').set(auth(b.owner.accessToken)).send(body).expect(201);
  });

  it("company B cannot read, edit or deactivate company A's route", async () => {
    await api(app).get(`/api/v1/routes/${a.routeId}`).set(auth(b.owner.accessToken)).expect(404);
    await api(app)
      .patch(`/api/v1/routes/${a.routeId}`)
      .set(auth(b.owner.accessToken))
      .send({ name: 'Hijacked' })
      .expect(404);
    await api(app).delete(`/api/v1/routes/${a.routeId}`).set(auth(b.owner.accessToken)).expect(404);

    // And the row is untouched.
    const row = await prisma.route.findUniqueOrThrow({ where: { id: a.routeId } });
    expect(row.name).not.toBe('Hijacked');
    expect(row.isActive).toBe(true);
  });

  it("company B's list never contains company A's routes", async () => {
    const { body } = await api(app)
      .get('/api/v1/routes')
      .set(auth(b.owner.accessToken))
      .expect(200);
    expect(body.data.map((r: { id: string }) => r.id)).not.toContain(a.routeId);
    expect(body.data).toHaveLength(1);
  });

  it('deactivates rather than deletes, so historical reports keep their grouping', async () => {
    await api(app).delete(`/api/v1/routes/${a.routeId}`).set(auth(a.owner.accessToken)).expect(200);

    const row = await prisma.route.findUnique({ where: { id: a.routeId } });
    expect(row).not.toBeNull();
    expect(row!.isActive).toBe(false);

    const all = await api(app).get('/api/v1/routes').set(auth(a.owner.accessToken)).expect(200);
    expect(all.body.data.map((r: { id: string }) => r.id)).toContain(a.routeId);

    const active = await api(app)
      .get('/api/v1/routes')
      .query({ onlyActive: 'true' })
      .set(auth(a.owner.accessToken))
      .expect(200);
    expect(active.body.data.map((r: { id: string }) => r.id)).not.toContain(a.routeId);
  });

  it('records create, update and deactivate in the audit log', async () => {
    await api(app)
      .patch(`/api/v1/routes/${a.routeId}`)
      .set(auth(a.owner.accessToken))
      .send({ name: `Renamed ${uniqueSuffix()}` })
      .expect(200);
    await api(app).delete(`/api/v1/routes/${a.routeId}`).set(auth(a.owner.accessToken)).expect(200);

    await settleAudit();
    const entries = await prisma.auditLog.findMany({
      where: { entityType: 'Route', entityId: a.routeId },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((e) => e.action)).toEqual(['CREATE', 'UPDATE', 'DEACTIVATE']);
    expect(entries.every((e) => e.companyId === a.companyId)).toBe(true);
    expect(entries[1]!.userId).toBe(a.owner.id);
  });

  it('lets a trip be created on a route and reports it back', async () => {
    const trip = await api(app)
      .post('/api/v1/trips')
      .set(auth(a.owner.accessToken))
      .send({ routeId: a.routeId, vehicleId: a.vehicleId, agreedPrice: '500000000' })
      .expect(201);
    expect(trip.body.data.routeId).toBe(a.routeId);

    const filtered = await api(app)
      .get('/api/v1/trips')
      .query({ routeId: a.routeId })
      .set(auth(a.owner.accessToken))
      .expect(200);
    expect(filtered.body.data.map((t: { id: string }) => t.id)).toEqual([trip.body.data.id]);
  });

  it("refuses a trip pointed at another company's route", async () => {
    await api(app)
      .post('/api/v1/trips')
      .set(auth(a.owner.accessToken))
      .send({ routeId: b.routeId, vehicleId: a.vehicleId, agreedPrice: '500000000' })
      .expect(404);
  });

  it('is closed to a DRIVER', async () => {
    const driver = await login(app, await createUser(a.companyId, 'DRIVER'));
    await api(app).get('/api/v1/routes').set(auth(driver.accessToken)).expect(403);
    await api(app)
      .post('/api/v1/routes')
      .set(auth(driver.accessToken))
      .send({ name: 'X', originName: 'A', destinationName: 'B' })
      .expect(403);
  });

  it('lets an ACCOUNTANT read but not write', async () => {
    const accountant = await login(app, await createUser(a.companyId, 'ACCOUNTANT'));
    await api(app).get('/api/v1/routes').set(auth(accountant.accessToken)).expect(200);
    await api(app)
      .post('/api/v1/routes')
      .set(auth(accountant.accessToken))
      .send({ name: `Nope ${uniqueSuffix()}`, originName: 'A', destinationName: 'B' })
      .expect(403);
  });
});

describe('Fuel logs', () => {
  let app: NestExpressApplication;
  let a: Tenant;
  let b: Tenant;

  const refuel = (overrides: Record<string, unknown> = {}) => ({
    vehicleId: a.vehicleId,
    liters: '302.55',
    pricePerLiter: '1250',
    refuelTime: new Date().toISOString(),
    ...overrides,
  });

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetRateLimits(app);
    a = await seedTenant(app, 'C');
    b = await seedTenant(app, 'D');
  });

  it('derives the total from litres × price in integers', async () => {
    const { body } = await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel())
      .expect(201);

    // 302.55 L × 1250 tiyin = 378 187.5 tiyin → 378 188 (half away from zero).
    // 302.55 is not representable as a double: 302.55 * 1250 is 378187.49999…
    // in floating point, which truncates to 378 187 — one tiyin short.
    expect(body.data.totalAmount).toBe('378188');
    expect(body.data.liters).toBe('302.55');

    const row = await prisma.fuelLog.findUniqueOrThrow({ where: { id: body.data.id } });
    expect(row.totalAmount).toBe(378_188n);
    expect(row.liters.toFixed(2)).toBe('302.55');
  });

  it('takes an explicit total over the derived one', async () => {
    const { body } = await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel({ totalAmount: '400000' }))
      .expect(201);
    expect(body.data.totalAmount).toBe('400000');
  });

  it('rejects litres sent as a JSON number, and litres with too much precision', async () => {
    await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel({ liters: 302.55 }))
      .expect(400);
    await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel({ liters: '302.555' }))
      .expect(400);
  });

  it('books a retried POST exactly once', async () => {
    const clientTxId = `refuel-${uniqueSuffix()}`;
    const first = await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel({ clientTxId }))
      .expect(201);
    const retry = await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel({ clientTxId }))
      .expect(201);

    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await prisma.fuelLog.count({ where: { companyId: a.companyId } })).toBe(1);
  });

  it('survives a genuinely concurrent double submit', async () => {
    const clientTxId = `double-tap-${uniqueSuffix()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api(app)
          .post('/api/v1/fuel-logs')
          .set(auth(a.owner.accessToken))
          .send(refuel({ clientTxId })),
      ),
    );
    for (const result of results) expect(result.status).toBe(201);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);

    const rows = await prisma.fuelLog.findMany({ where: { companyId: a.companyId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalAmount).toBe(378_188n);
  });

  it('scopes the idempotency key per company', async () => {
    const clientTxId = `shared-key-${uniqueSuffix()}`;
    await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel({ clientTxId }))
      .expect(201);
    await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(b.owner.accessToken))
      .send(refuel({ clientTxId, vehicleId: b.vehicleId }))
      .expect(201);

    expect(await prisma.fuelLog.count({ where: { companyId: a.companyId } })).toBe(1);
    expect(await prisma.fuelLog.count({ where: { companyId: b.companyId } })).toBe(1);
  });

  it('without a key, two posts are two genuine refuels', async () => {
    await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel())
      .expect(201);
    await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel())
      .expect(201);
    expect(await prisma.fuelLog.count({ where: { companyId: a.companyId } })).toBe(2);
  });

  it("refuses a refuel pointed at another company's vehicle", async () => {
    await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel({ vehicleId: b.vehicleId }))
      .expect(404);
    expect(await prisma.fuelLog.count()).toBe(0);
  });

  it("refuses a refuel pointed at another company's trip", async () => {
    const trip = await api(app)
      .post('/api/v1/trips')
      .set(auth(b.owner.accessToken))
      .send({ vehicleId: b.vehicleId, agreedPrice: '100' })
      .expect(201);
    await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel({ tripId: trip.body.data.id }))
      .expect(404);
  });

  it("company B cannot list, edit or delete company A's refuel", async () => {
    const created = await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel())
      .expect(201);
    const id = created.body.data.id;

    const list = await api(app).get('/api/v1/fuel-logs').set(auth(b.owner.accessToken)).expect(200);
    expect(list.body.data).toHaveLength(0);

    await api(app)
      .patch(`/api/v1/fuel-logs/${id}`)
      .set(auth(b.owner.accessToken))
      .send({ liters: '1.00' })
      .expect(404);
    await api(app).delete(`/api/v1/fuel-logs/${id}`).set(auth(b.owner.accessToken)).expect(404);

    const row = await prisma.fuelLog.findUniqueOrThrow({ where: { id } });
    expect(row.liters.toFixed(2)).toBe('302.55');
  });

  it('recomputes the total when litres are edited', async () => {
    const created = await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel())
      .expect(201);
    const { body } = await api(app)
      .patch(`/api/v1/fuel-logs/${created.body.data.id}`)
      .set(auth(a.owner.accessToken))
      .send({ liters: '100.00', pricePerLiter: '1250' })
      .expect(200);
    expect(body.data.totalAmount).toBe('125000');
  });

  it('leaves the whole row behind in the audit log when deleted', async () => {
    const created = await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel({ stationName: 'UNG Toshkent' }))
      .expect(201);
    const id = created.body.data.id;

    await api(app)
      .patch(`/api/v1/fuel-logs/${id}`)
      .set(auth(a.owner.accessToken))
      .send({ stationName: 'Lukoil' })
      .expect(200);
    await api(app).delete(`/api/v1/fuel-logs/${id}`).set(auth(a.owner.accessToken)).expect(200);

    await settleAudit();
    const entries = await prisma.auditLog.findMany({
      where: { entityType: 'FuelLog', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((e) => e.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
    // Fuel is money: the deleted litres and total must still be recoverable.
    expect(entries[2]!.before).toMatchObject({
      liters: '302.55',
      totalAmount: '378188',
      stationName: 'Lukoil',
    });
    expect(entries[2]!.userId).toBe(a.owner.id);
    expect(await prisma.fuelLog.count()).toBe(0);
  });

  it('feeds the fuel rollup it is the source for', async () => {
    await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(a.owner.accessToken))
      .send(refuel({ liters: '100.00', totalAmount: '125000' }))
      .expect(201);

    const { body } = await api(app)
      .get('/api/v1/finance/fuel')
      .set(auth(a.owner.accessToken))
      .expect(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      vehicleId: a.vehicleId,
      refuels: 1,
      litres: '100.00',
      cost: '125000',
      // No trips, so no measured distance: a null consumption, not a fake one.
      consumption: null,
      deviationBp: null,
      overNorm: false,
    });
  });

  it('is closed to a DRIVER', async () => {
    const driver = await login(app, await createUser(a.companyId, 'DRIVER'));
    await api(app).get('/api/v1/fuel-logs').set(auth(driver.accessToken)).expect(403);
    await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(driver.accessToken))
      .send(refuel())
      .expect(403);
  });
});
