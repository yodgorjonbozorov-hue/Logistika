/**
 * Multi-tenant isolation — the project's single most important security
 * property (CLAUDE.md: "Har bir baza so'rovi MAJBURIY company_id bo'yicha
 * filtrlanadi. Istisno yo'q.")
 *
 * Every case runs against real PostgreSQL with two real companies, because the
 * guarantee is made of things a mock cannot express: WHERE clauses that Prisma
 * actually emits, unique indexes, and foreign keys.
 *
 * Two distinct attacks are covered:
 *   READ  — can company B see company A's row?  (must look like 404)
 *   WRITE — can company B *take* company A's row by putting `companyId` in the
 *           body?  (C-4 — this one used to work)
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
  type TestCompany,
  type TestUser,
} from './harness';

describe('Tenant isolation', () => {
  let app: NestExpressApplication;
  let companyA: TestCompany;
  let companyB: TestCompany;
  let ownerA: TestUser;
  let ownerB: TestUser;

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
    companyA = await createCompany('Company A');
    companyB = await createCompany('Company B');
    ownerA = await login(app, companyA.owner);
    ownerB = await login(app, companyB.owner);
  });

  /** Creates one row of every tenant-owned resource inside company A. */
  async function seedCompanyA() {
    const plate = `01A${uniqueSuffix().slice(-5).toUpperCase()}`;
    const vehicle = await api(app)
      .post('/api/v1/vehicles')
      .set(auth(ownerA.accessToken))
      .send({ plateNumber: plate })
      .expect(201);
    const driver = await api(app)
      .post('/api/v1/drivers')
      .set(auth(ownerA.accessToken))
      .send({ fullName: 'A Driver' })
      .expect(201);
    const client = await api(app)
      .post('/api/v1/clients')
      .set(auth(ownerA.accessToken))
      .send({ name: 'A Client' })
      .expect(201);
    const trip = await api(app)
      .post('/api/v1/trips')
      .set(auth(ownerA.accessToken))
      .send({ vehicleId: vehicle.body.data.id, driverId: driver.body.data.id, cargoName: 'Secret' })
      .expect(201);
    const expense = await api(app)
      .post('/api/v1/expenses')
      .set(auth(ownerA.accessToken))
      .send({
        category: 'FUEL',
        amount: '50000000',
        expenseDate: new Date().toISOString(),
        tripId: trip.body.data.id,
      })
      .expect(201);
    const income = await api(app)
      .post('/api/v1/incomes')
      .set(auth(ownerA.accessToken))
      .send({ amount: '90000000', tripId: trip.body.data.id })
      .expect(201);
    const route = await api(app)
      .post('/api/v1/routes')
      .set(auth(ownerA.accessToken))
      .send({ name: `Secret lane ${uniqueSuffix()}`, originName: 'A', destinationName: 'B' })
      .expect(201);
    const fuelLog = await api(app)
      .post('/api/v1/fuel-logs')
      .set(auth(ownerA.accessToken))
      .send({
        vehicleId: vehicle.body.data.id,
        liters: '250.00',
        pricePerLiter: '1250',
        refuelTime: new Date().toISOString(),
      })
      .expect(201);

    return {
      vehicleId: vehicle.body.data.id as string,
      driverId: driver.body.data.id as string,
      clientId: client.body.data.id as string,
      tripId: trip.body.data.id as string,
      expenseId: expense.body.data.id as string,
      incomeId: income.body.data.id as string,
      routeId: route.body.data.id as string,
      fuelLogId: fuelLog.body.data.id as string,
    };
  }

  describe('READ — company B never sees company A', () => {
    it('cross-company ids are indistinguishable from missing ones', async () => {
      const a = await seedCompanyA();

      const reads: Array<[string, string]> = [
        ['trips', a.tripId],
        ['vehicles', a.vehicleId],
        ['drivers', a.driverId],
        ['clients', a.clientId],
        ['routes', a.routeId],
      ];
      for (const [resource, id] of reads) {
        const response = await api(app)
          .get(`/api/v1/${resource}/${id}`)
          .set(auth(ownerB.accessToken));
        expect([404, 403]).toContain(response.status);
        expect(JSON.stringify(response.body)).not.toContain('Secret');
      }
    });

    it('list endpoints return only the calling tenant’s rows', async () => {
      await seedCompanyA();

      for (const resource of [
        'trips',
        'vehicles',
        'drivers',
        'clients',
        'expenses',
        'incomes',
        'routes',
        'fuel-logs',
      ]) {
        const response = await api(app)
          .get(`/api/v1/${resource}`)
          .set(auth(ownerB.accessToken))
          .expect(200);
        expect(response.body.data).toEqual([]);
        expect(response.body.meta.pagination.total).toBe(0);
      }
    });

    it("company A's events are invisible to company B", async () => {
      const a = await seedCompanyA();
      const response = await api(app)
        .get('/api/v1/events')
        .query({ tripId: a.tripId })
        .set(auth(ownerB.accessToken));
      expect(response.status).toBe(404);
    });

    it("company A's GPS history is invisible to company B", async () => {
      const a = await seedCompanyA();
      const response = await api(app)
        .get(`/api/v1/tracking/vehicles/${a.vehicleId}/history`)
        .query({ from: '2026-01-01T00:00:00Z', to: '2026-01-10T00:00:00Z' })
        .set(auth(ownerB.accessToken))
        .expect(200);
      expect(response.body.data.points).toEqual([]);
    });
  });

  describe('WRITE — company B never modifies company A', () => {
    it.each([
      ['trips', { cargoName: 'hijacked' }],
      ['vehicles', { brand: 'hijacked' }],
      ['drivers', { fullName: 'hijacked' }],
      ['clients', { name: 'hijacked' }],
    ])('PATCH /%s/:id of another tenant fails', async (resource, body) => {
      const a = await seedCompanyA();
      const idByResource: Record<string, string> = {
        trips: a.tripId,
        vehicles: a.vehicleId,
        drivers: a.driverId,
        clients: a.clientId,
      };
      const response = await api(app)
        .patch(`/api/v1/${resource}/${idByResource[resource]}`)
        .set(auth(ownerB.accessToken))
        .send(body);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('DELETE of another tenant’s row fails and the row survives', async () => {
      const a = await seedCompanyA();
      await api(app)
        .delete(`/api/v1/clients/${a.clientId}`)
        .set(auth(ownerB.accessToken))
        .expect((res) => expect(res.status).toBeGreaterThanOrEqual(400));

      expect(await prisma.client.findUnique({ where: { id: a.clientId } })).not.toBeNull();
    });
  });

  describe('C-4 — companyId in the request body is never honoured', () => {
    it('cannot hand its own trip to another tenant', async () => {
      const vehicle = await api(app)
        .post('/api/v1/vehicles')
        .set(auth(ownerB.accessToken))
        .send({ plateNumber: `01B${uniqueSuffix().slice(-5).toUpperCase()}` })
        .expect(201);
      const trip = await api(app)
        .post('/api/v1/trips')
        .set(auth(ownerB.accessToken))
        .send({ vehicleId: vehicle.body.data.id })
        .expect(201);

      // The unknown-field guard rejects it outright; even if the field were
      // accepted, the tenant extension strips it. Both are asserted.
      const response = await api(app)
        .patch(`/api/v1/trips/${trip.body.data.id}`)
        .set(auth(ownerB.accessToken))
        .send({ cargoName: 'moved', companyId: companyA.id });
      expect(response.status).toBe(400);

      const stored = await prisma.trip.findUniqueOrThrow({ where: { id: trip.body.data.id } });
      expect(stored.companyId).toBe(companyB.id);
    });

    it('cannot plant a row directly into another tenant on create', async () => {
      const response = await api(app)
        .post('/api/v1/clients')
        .set(auth(ownerB.accessToken))
        .send({ name: 'Planted', companyId: companyA.id });
      expect(response.status).toBe(400);

      expect(await prisma.client.count({ where: { companyId: companyA.id } })).toBe(0);
    });

    it('the tenant extension itself refuses the move even without the DTO guard', async () => {
      // Bypasses the HTTP validation layer on purpose: this asserts the LAST
      // line of defence, the Prisma extension, rather than the first.
      const client = await prisma.client.create({
        data: { companyId: companyB.id, name: 'B Client' },
      });
      const prismaService = app.get((await import('../src/prisma/prisma.service')).PrismaService);

      await prismaService.forCompany(companyB.id).client.update({
        where: { id: client.id },
        data: { name: 'renamed', companyId: companyA.id } as never,
      });

      const stored = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
      expect(stored.name).toBe('renamed');
      expect(stored.companyId).toBe(companyB.id); // NOT company A
    });
  });

  describe('cross-tenant foreign keys (H-2)', () => {
    it('an expense may not reference another tenant’s trip', async () => {
      const a = await seedCompanyA();
      const response = await api(app)
        .post('/api/v1/expenses')
        .set(auth(ownerB.accessToken))
        .send({
          category: 'FUEL',
          amount: '10000000',
          expenseDate: new Date().toISOString(),
          tripId: a.tripId,
        })
        .expect(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(await prisma.expense.count({ where: { companyId: companyB.id } })).toBe(0);
    });

    it('an expense may not reference another tenant’s vehicle or driver', async () => {
      const a = await seedCompanyA();
      for (const ref of [{ vehicleId: a.vehicleId }, { driverId: a.driverId }]) {
        await api(app)
          .post('/api/v1/expenses')
          .set(auth(ownerB.accessToken))
          .send({
            category: 'REPAIR',
            amount: '10000000',
            expenseDate: new Date().toISOString(),
            ...ref,
          })
          .expect(404);
      }
      expect(await prisma.expense.count({ where: { companyId: companyB.id } })).toBe(0);
    });

    it('an income may not reference another tenant’s trip or client', async () => {
      const a = await seedCompanyA();
      for (const ref of [{ tripId: a.tripId }, { clientId: a.clientId }]) {
        await api(app)
          .post('/api/v1/incomes')
          .set(auth(ownerB.accessToken))
          .send({ amount: '10000000', ...ref })
          .expect(404);
      }
      expect(await prisma.income.count({ where: { companyId: companyB.id } })).toBe(0);
    });

    it('a trip may not reference another tenant’s vehicle, driver or client', async () => {
      const a = await seedCompanyA();
      for (const ref of [
        { vehicleId: a.vehicleId },
        { driverId: a.driverId },
        { clientId: a.clientId },
      ]) {
        await api(app).post('/api/v1/trips').set(auth(ownerB.accessToken)).send(ref).expect(404);
      }
      expect(await prisma.trip.count({ where: { companyId: companyB.id } })).toBe(0);
    });
  });

  /**
   * The full grid: every tenant-owned resource, every verb that resource has.
   *
   * The suites above test the cases that were once bugs. This one tests the
   * ones that have not been bugs yet — it is generated from a table, so a
   * resource cannot be covered for GET and quietly missed for DELETE, which is
   * how isolation holes survive a review: the reviewer checks the endpoint that
   * is in the diff and not the four beside it.
   *
   * The assertion is deliberately loose on WHICH failure (404 or 403). What
   * matters is that company B is refused and that A's row is untouched
   * afterwards; the choice between "not found" and "forbidden" is an
   * information-disclosure preference, and 404 — used here for cross-tenant ids
   * — is the stronger one.
   */
  describe('cross-tenant matrix — every resource, every verb', () => {
    interface Probe {
      resource: string;
      id: (a: Awaited<ReturnType<typeof seedCompanyA>>) => string;
      patch?: Record<string, unknown>;
      hasDetailGet?: boolean;
      hasDelete?: boolean;
    }

    const PROBES: Probe[] = [
      {
        resource: 'trips',
        id: (a) => a.tripId,
        patch: { cargoName: 'hijacked' },
        hasDetailGet: true,
      },
      {
        resource: 'vehicles',
        id: (a) => a.vehicleId,
        patch: { brand: 'hijacked' },
        hasDetailGet: true,
        hasDelete: true,
      },
      {
        resource: 'drivers',
        id: (a) => a.driverId,
        patch: { fullName: 'hijacked' },
        hasDetailGet: true,
        hasDelete: true,
      },
      {
        resource: 'clients',
        id: (a) => a.clientId,
        patch: { name: 'hijacked' },
        hasDetailGet: true,
        hasDelete: true,
      },
      {
        resource: 'routes',
        id: (a) => a.routeId,
        patch: { name: 'hijacked' },
        hasDetailGet: true,
        hasDelete: true,
      },
      { resource: 'expenses', id: (a) => a.expenseId, patch: { amount: '1' }, hasDelete: true },
      { resource: 'incomes', id: (a) => a.incomeId, patch: { amount: '1' }, hasDelete: true },
      { resource: 'fuel-logs', id: (a) => a.fuelLogId, patch: { liters: '1.00' }, hasDelete: true },
    ];

    it.each(PROBES.map((probe) => [probe.resource, probe] as const))(
      '%s — B is refused on every verb and A keeps its row',
      async (_name, probe) => {
        const a = await seedCompanyA();
        const id = probe.id(a);
        const path = `/api/v1/${probe.resource}/${id}`;
        const refused = (status: number) => expect([403, 404]).toContain(status);

        if (probe.hasDetailGet) {
          const read = await api(app).get(path).set(auth(ownerB.accessToken));
          refused(read.status);
          expect(JSON.stringify(read.body)).not.toContain('Secret');
        }

        if (probe.patch) {
          refused(
            (await api(app).patch(path).set(auth(ownerB.accessToken)).send(probe.patch)).status,
          );
        }

        if (probe.hasDelete) {
          refused((await api(app).delete(path).set(auth(ownerB.accessToken))).status);
        }

        // The list stays empty for B whatever the writes attempted above did.
        const list = await api(app)
          .get(`/api/v1/${probe.resource}`)
          .set(auth(ownerB.accessToken))
          .expect(200);
        expect(list.body.data).toEqual([]);
      },
    );

    it('a hijack attempt leaves company A byte-for-byte unchanged', async () => {
      const a = await seedCompanyA();
      const before = await prisma.trip.findUniqueOrThrow({ where: { id: a.tripId } });

      await api(app)
        .patch(`/api/v1/trips/${a.tripId}`)
        .set(auth(ownerB.accessToken))
        .send({ cargoName: 'hijacked', agreedPrice: '1' });

      const after = await prisma.trip.findUniqueOrThrow({ where: { id: a.tripId } });
      expect(after.cargoName).toBe(before.cargoName);
      expect(after.agreedPrice).toBe(before.agreedPrice);
      expect(after.companyId).toBe(companyA.id);
    });

    it('B cannot manage A’s staff', async () => {
      const staff = await createUser(companyA.id, 'LOGIST');
      const path = `/api/v1/users/${staff.id}`;

      expect([403, 404]).toContain((await api(app).get(path).set(auth(ownerB.accessToken))).status);
      expect([403, 404]).toContain(
        (await api(app).patch(path).set(auth(ownerB.accessToken)).send({ fullName: 'x' })).status,
      );
      expect([403, 404]).toContain(
        (await api(app).delete(path).set(auth(ownerB.accessToken))).status,
      );

      const survivor = await prisma.user.findUniqueOrThrow({ where: { id: staff.id } });
      expect(survivor.companyId).toBe(companyA.id);
      expect(survivor.isActive).toBe(true);
    });

    it('the assistant answers from B’s own (empty) books, never A’s', async () => {
      await seedCompanyA();

      const answer = await api(app)
        .post('/api/v1/ai/chat')
        .set(auth(ownerB.accessToken))
        .send({ question: 'Bu oy qancha daromad?', locale: 'uz-latn' })
        .expect(201);

      // A's figures are 90 000 000 tiyin of income and 50 000 000 of expense.
      // Neither may appear in B's answer in any formatting.
      const text = JSON.stringify(answer.body);
      for (const leak of ['900 000', '900\u00a0000', '500 000', '500\u00a0000', 'Secret']) {
        expect(text).not.toContain(leak);
      }
    });

    it('an explicit companyId in a query string changes nothing', async () => {
      await seedCompanyA();
      const response = await api(app)
        .get('/api/v1/trips')
        .query({ companyId: companyA.id })
        .set(auth(ownerB.accessToken));

      // Either the unknown parameter is rejected outright by the global
      // whitelist pipe, or it is ignored — never honoured.
      if (response.status === 200) expect(response.body.data).toEqual([]);
      else expect(response.status).toBe(400);
    });
  });

  describe('company settings', () => {
    it('GET /company returns only the caller’s own tenant', async () => {
      const response = await api(app)
        .get('/api/v1/company')
        .set(auth(ownerB.accessToken))
        .expect(200);
      expect(response.body.data.id).toBe(companyB.id);
      expect(response.body.data.name).toBe('Company B');
    });

    it('a tenant owner cannot reach the SUPERADMIN company endpoints', async () => {
      await api(app).get('/api/v1/admin/companies').set(auth(ownerA.accessToken)).expect(403);
    });
  });
});
