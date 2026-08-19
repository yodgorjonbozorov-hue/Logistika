/**
 * Trip lifecycle under real concurrency.
 *
 * Everything here is a race or a database constraint, so it is exercised
 * against real PostgreSQL with genuinely parallel requests. A mocked Prisma
 * cannot fail these tests — which is exactly why the bugs shipped.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  api,
  auth,
  createCompany,
  createTestApp,
  login,
  prisma,
  resetDatabase,
  resetRateLimits,
  uniqueSuffix,
  type TestUser,
} from './harness';

describe('Trip lifecycle concurrency', () => {
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

  async function makeVehicle(): Promise<string> {
    const response = await api(app)
      .post('/api/v1/vehicles')
      .set(auth(owner.accessToken))
      .send({ plateNumber: `01T${uniqueSuffix().slice(-5).toUpperCase()}` })
      .expect(201);
    return response.body.data.id;
  }

  async function makeDriver(): Promise<string> {
    const response = await api(app)
      .post('/api/v1/drivers')
      .set(auth(owner.accessToken))
      .send({ fullName: `Driver ${uniqueSuffix()}` })
      .expect(201);
    return response.body.data.id;
  }

  async function makeTrip(vehicleId?: string, driverId?: string): Promise<string> {
    const response = await api(app)
      .post('/api/v1/trips')
      .set(auth(owner.accessToken))
      .send({ vehicleId, driverId })
      .expect(201);
    return response.body.data.id;
  }

  describe('H-6 trip number allocation', () => {
    it('20 trips created in parallel get 20 distinct sequential numbers', async () => {
      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          api(app).post('/api/v1/trips').set(auth(owner.accessToken)).send({}),
        ),
      );

      for (const response of responses) expect(response.status).toBe(201);
      const numbers = responses.map((r) => Number(r.body.data.tripNumber)).sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(20);
      expect(numbers).toEqual(Array.from({ length: 20 }, (_unused, i) => i + 1));
    });

    it('numbering is per tenant — two companies both start at 1', async () => {
      const other = await createCompany();
      resetRateLimits(app);
      const otherOwner = await login(app, other.owner);

      const mine = await api(app).post('/api/v1/trips').set(auth(owner.accessToken)).send({});
      const theirs = await api(app)
        .post('/api/v1/trips')
        .set(auth(otherOwner.accessToken))
        .send({});

      expect(mine.body.data.tripNumber).toBe('1');
      expect(theirs.body.data.tripNumber).toBe('1');
    });

    it('the counter never rewinds after a trip is deleted', async () => {
      await api(app).post('/api/v1/trips').set(auth(owner.accessToken)).send({}).expect(201);
      await prisma.trip.deleteMany({ where: { companyId } });

      const next = await api(app).post('/api/v1/trips').set(auth(owner.accessToken)).send({});
      // count()+1 would have reissued "1" and collided with history.
      expect(next.body.data.tripNumber).toBe('2');
    });
  });

  describe('H-5 atomic status transitions', () => {
    it('two concurrent completes: exactly one wins, the other gets 409', async () => {
      const tripId = await makeTrip(await makeVehicle(), await makeDriver());
      await api(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .set(auth(owner.accessToken))
        .send({ startOdometer: 1000 })
        .expect(200);

      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          api(app)
            .post(`/api/v1/trips/${tripId}/complete`)
            .set(auth(owner.accessToken))
            .send({ endOdometer: 1500 }),
        ),
      );

      const ok = results.filter((r) => r.status === 200);
      const conflicts = results.filter((r) => r.status === 409);
      expect(ok).toHaveLength(1);
      expect(conflicts).toHaveLength(5);
      for (const conflict of conflicts) {
        expect(['CONFLICT', 'TRIP_INVALID_STATUS']).toContain(conflict.body.error.code);
      }

      // Exactly one STATUS_CHANGE → COMPLETED was recorded.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const audits = await prisma.auditLog.findMany({
        where: { entityId: tripId, action: 'STATUS_CHANGE' },
      });
      expect(audits.filter((a) => JSON.stringify(a.after).includes('COMPLETED'))).toHaveLength(1);
    });

    it('a stale client cannot re-complete an already completed trip', async () => {
      const tripId = await makeTrip(await makeVehicle(), await makeDriver());
      await api(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .set(auth(owner.accessToken))
        .send({})
        .expect(200);
      await api(app)
        .post(`/api/v1/trips/${tripId}/complete`)
        .set(auth(owner.accessToken))
        .send({})
        .expect(200);

      const again = await api(app)
        .post(`/api/v1/trips/${tripId}/complete`)
        .set(auth(owner.accessToken))
        .send({})
        .expect(409);
      expect(again.body.error.code).toBe('TRIP_INVALID_STATUS');
    });
  });

  describe('H-4 odometer validation', () => {
    it('rejects an end reading below the start reading', async () => {
      const tripId = await makeTrip(await makeVehicle(), await makeDriver());
      await api(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .set(auth(owner.accessToken))
        .send({ startOdometer: 1000 })
        .expect(200);

      const response = await api(app)
        .post(`/api/v1/trips/${tripId}/complete`)
        .set(auth(owner.accessToken))
        .send({ endOdometer: 500 })
        .expect(400);

      expect(response.body.error.code).toBe('ODOMETER_INVALID');
      const stored = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(stored.status).toBe('IN_PROGRESS'); // not completed, not corrupted
      expect(stored.actualDistanceKm).toBeNull();
    });

    it('accepts an equal reading as a zero-distance trip', async () => {
      const tripId = await makeTrip(await makeVehicle(), await makeDriver());
      await api(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .set(auth(owner.accessToken))
        .send({ startOdometer: 1000 })
        .expect(200);

      await api(app)
        .post(`/api/v1/trips/${tripId}/complete`)
        .set(auth(owner.accessToken))
        .send({ endOdometer: 1000 })
        .expect(200);

      const stored = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(Number(stored.actualDistanceKm)).toBe(0);
    });

    it('a negative distance can never reach the database', async () => {
      const tripId = await makeTrip(await makeVehicle(), await makeDriver());
      await api(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .set(auth(owner.accessToken))
        .send({ startOdometer: 900_000 })
        .expect(200);
      await api(app)
        .post(`/api/v1/trips/${tripId}/complete`)
        .set(auth(owner.accessToken))
        .send({ endOdometer: 1 })
        .expect(400);

      const negatives = await prisma.trip.count({ where: { actualDistanceKm: { lt: 0 } } });
      expect(negatives).toBe(0);
    });
  });

  describe('M-13 one active trip per driver / vehicle', () => {
    it('a driver cannot be started on two trips at once', async () => {
      const driverId = await makeDriver();
      const tripA = await makeTrip(await makeVehicle(), driverId);
      const tripB = await makeTrip(await makeVehicle(), driverId);

      await api(app)
        .post(`/api/v1/trips/${tripA}/start`)
        .set(auth(owner.accessToken))
        .send({})
        .expect(200);
      const second = await api(app)
        .post(`/api/v1/trips/${tripB}/start`)
        .set(auth(owner.accessToken))
        .send({})
        .expect(409);

      expect(second.body.error.code).toBe('RESOURCE_BUSY');
      expect(await prisma.trip.count({ where: { driverId, status: 'IN_PROGRESS' } })).toBe(1);
    });

    it('a vehicle cannot be started on two trips at once', async () => {
      const vehicleId = await makeVehicle();
      const tripA = await makeTrip(vehicleId, await makeDriver());
      const tripB = await makeTrip(vehicleId, await makeDriver());

      await api(app)
        .post(`/api/v1/trips/${tripA}/start`)
        .set(auth(owner.accessToken))
        .send({})
        .expect(200);
      await api(app)
        .post(`/api/v1/trips/${tripB}/start`)
        .set(auth(owner.accessToken))
        .send({})
        .expect(409);

      expect(await prisma.trip.count({ where: { vehicleId, status: 'IN_PROGRESS' } })).toBe(1);
    });

    it('holds under a concurrent double start (the DB index decides, not a pre-check)', async () => {
      const driverId = await makeDriver();
      const trips = await Promise.all([
        makeTrip(await makeVehicle(), driverId),
        makeTrip(await makeVehicle(), driverId),
        makeTrip(await makeVehicle(), driverId),
      ]);

      const results = await Promise.all(
        trips.map((tripId) =>
          api(app).post(`/api/v1/trips/${tripId}/start`).set(auth(owner.accessToken)).send({}),
        ),
      );

      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.trip.count({ where: { driverId, status: 'IN_PROGRESS' } })).toBe(1);
    });

    it('frees the driver again once the trip completes', async () => {
      const driverId = await makeDriver();
      const tripA = await makeTrip(await makeVehicle(), driverId);
      const tripB = await makeTrip(await makeVehicle(), driverId);

      await api(app).post(`/api/v1/trips/${tripA}/start`).set(auth(owner.accessToken)).send({});
      await api(app).post(`/api/v1/trips/${tripA}/complete`).set(auth(owner.accessToken)).send({});
      await api(app)
        .post(`/api/v1/trips/${tripB}/start`)
        .set(auth(owner.accessToken))
        .send({})
        .expect(200);
    });
  });

  describe('M-6 / M-7 query parameter hardening', () => {
    it('an unparsable date is a 400, not a 500', async () => {
      const response = await api(app)
        .get('/api/v1/trips')
        .query({ from: 'abc' })
        .set(auth(owner.accessToken))
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('a deep offset is refused instead of scanned', async () => {
      await api(app)
        .get('/api/v1/trips')
        .query({ page: 999999999 })
        .set(auth(owner.accessToken))
        .expect(400);
    });

    it('an oversized page limit is refused', async () => {
      await api(app)
        .get('/api/v1/trips')
        .query({ limit: 100000 })
        .set(auth(owner.accessToken))
        .expect(400);
    });
  });
});
