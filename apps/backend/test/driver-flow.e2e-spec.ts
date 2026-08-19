/**
 * C-1 — the driver app's entire API surface, end to end, on real PostgreSQL.
 *
 * Before the fix `Driver.userId` was never populated (the DTO had no such
 * field), so every driver endpoint resolved "no profile" and the mobile app
 * was functionally dead:
 *   GET  /trips/my          → []
 *   POST /events/batch      → 404
 *   POST /tracking/positions→ 404
 * These tests walk that exact flow and assert it now works.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import {
  api,
  auth,
  createCompany,
  createCompanyWithDriver,
  createTestApp,
  createUser,
  login,
  prisma,
  resetDatabase,
  resetRateLimits,
} from './harness';

describe('Driver flow (C-1)', () => {
  let app: NestExpressApplication;

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
  });

  describe('linking a login account to a driver profile', () => {
    it('stores userId and makes the driver resolvable', async () => {
      const { driverId, driverUser } = await createCompanyWithDriver(app);

      const stored = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(stored.userId).toBe(driverUser.id);
    });

    it('refuses a user from another company (tenant-scoped lookup)', async () => {
      const companyA = await createCompany();
      const companyB = await createCompany();
      const ownerA = await login(app, companyA.owner);
      const driverOfB = await createUser(companyB.id, 'DRIVER');

      await api(app)
        .post('/api/v1/drivers')
        .set(auth(ownerA.accessToken))
        .send({ fullName: 'Poached Driver', userId: driverOfB.id })
        .expect(404);
    });

    it('refuses a non-DRIVER account (no privilege laundering)', async () => {
      const company = await createCompany();
      const owner = await login(app, company.owner);
      const accountant = await createUser(company.id, 'ACCOUNTANT');

      const response = await api(app)
        .post('/api/v1/drivers')
        .set(auth(owner.accessToken))
        .send({ fullName: 'Not A Driver', userId: accountant.id })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses to link one account to two driver profiles', async () => {
      const { owner, driverUser } = await createCompanyWithDriver(app);

      const response = await api(app)
        .post('/api/v1/drivers')
        .set(auth(owner.accessToken))
        .send({ fullName: 'Duplicate', userId: driverUser.id })
        .expect(409);
      expect(response.body.error.code).toBe('ALREADY_EXISTS');
    });
  });

  describe('GET /trips/my', () => {
    it('returns the trips assigned to the logged-in driver', async () => {
      const { owner, driverUser, driverId, vehicleId } = await createCompanyWithDriver(app);

      const trip = await api(app)
        .post('/api/v1/trips')
        .set(auth(owner.accessToken))
        .send({ vehicleId, driverId, cargoName: 'Paxta' })
        .expect(201);

      const mine = await api(app)
        .get('/api/v1/trips/my')
        .set(auth(driverUser.accessToken))
        .expect(200);

      expect(mine.body.data).toHaveLength(1);
      expect(mine.body.data[0].id).toBe(trip.body.data.id);
      expect(mine.body.data[0].cargoName).toBe('Paxta');
    });

    it("never returns another driver's trips", async () => {
      const first = await createCompanyWithDriver(app);
      const otherDriverUser = await createUser(first.company.id, 'DRIVER');
      await login(app, otherDriverUser);
      const otherDriver = await api(app)
        .post('/api/v1/drivers')
        .set(auth(first.owner.accessToken))
        .send({ fullName: 'Other Driver', userId: otherDriverUser.id })
        .expect(201);

      await api(app)
        .post('/api/v1/trips')
        .set(auth(first.owner.accessToken))
        .send({ vehicleId: first.vehicleId, driverId: first.driverId })
        .expect(201);

      const mine = await api(app)
        .get('/api/v1/trips/my')
        .set(auth(otherDriverUser.accessToken))
        .expect(200);
      expect(mine.body.data).toEqual([]);
      expect(otherDriver.body.data.id).not.toBe(first.driverId);
    });

    it('tells an unlinked driver account what is wrong instead of returning []', async () => {
      const company = await createCompany();
      const orphan = await createUser(company.id, 'DRIVER');
      await login(app, orphan);

      const response = await api(app)
        .get('/api/v1/trips/my')
        .set(auth(orphan.accessToken))
        .expect(403);
      expect(response.body.error.code).toBe('DRIVER_PROFILE_MISSING');
    });
  });

  describe('POST /events/batch', () => {
    async function assignedTrip() {
      const ctx = await createCompanyWithDriver(app);
      const trip = await api(app)
        .post('/api/v1/trips')
        .set(auth(ctx.owner.accessToken))
        .send({ vehicleId: ctx.vehicleId, driverId: ctx.driverId })
        .expect(201);
      return { ...ctx, tripId: trip.body.data.id as string };
    }

    it('accepts a batch and persists the events', async () => {
      const { driverUser, tripId } = await assignedTrip();
      const clientEventId = randomUUID();

      const response = await api(app)
        .post('/api/v1/events/batch')
        .set(auth(driverUser.accessToken))
        .send({
          events: [
            {
              clientEventId,
              tripId,
              eventType: 'START',
              eventTime: new Date().toISOString(),
              lat: 41.31,
              lng: 69.24,
            },
          ],
        })
        .expect(200);

      expect(response.body.data.accepted).toEqual([clientEventId]);
      expect(await prisma.tripEvent.count({ where: { clientEventId } })).toBe(1);
    });

    it('is idempotent: a retried batch never doubles a row', async () => {
      const { driverUser, tripId } = await assignedTrip();
      const clientEventId = randomUUID();
      const body = {
        events: [
          { clientEventId, tripId, eventType: 'REFUEL', eventTime: new Date().toISOString() },
        ],
      };

      await api(app)
        .post('/api/v1/events/batch')
        .set(auth(driverUser.accessToken))
        .send(body)
        .expect(200);
      const second = await api(app)
        .post('/api/v1/events/batch')
        .set(auth(driverUser.accessToken))
        .send(body)
        .expect(200);

      expect(second.body.data.duplicates).toEqual([clientEventId]);
      expect(second.body.data.accepted).toEqual([]);
      expect(await prisma.tripEvent.count({ where: { clientEventId } })).toBe(1);
    });

    it('two companies may use the same client UUID without colliding', async () => {
      const first = await assignedTrip();
      const second = await assignedTrip();
      const sharedId = randomUUID();

      for (const ctx of [first, second]) {
        const response = await api(app)
          .post('/api/v1/events/batch')
          .set(auth(ctx.driverUser.accessToken))
          .send({
            events: [
              {
                clientEventId: sharedId,
                tripId: ctx.tripId,
                eventType: 'LOADED',
                eventTime: new Date().toISOString(),
              },
            ],
          })
          .expect(200);
        expect(response.body.data.accepted).toEqual([sharedId]);
      }

      // One row per tenant — the old GLOBAL unique index made the second a 500.
      expect(await prisma.tripEvent.count({ where: { clientEventId: sharedId } })).toBe(2);
    });

    it('rejects one foreign trip without failing the rest of the batch', async () => {
      const mine = await assignedTrip();
      const foreign = await assignedTrip();
      const good = randomUUID();
      const bad = randomUUID();

      const response = await api(app)
        .post('/api/v1/events/batch')
        .set(auth(mine.driverUser.accessToken))
        .send({
          events: [
            {
              clientEventId: good,
              tripId: mine.tripId,
              eventType: 'REST',
              eventTime: new Date().toISOString(),
            },
            {
              clientEventId: bad,
              tripId: foreign.tripId,
              eventType: 'REST',
              eventTime: new Date().toISOString(),
            },
          ],
        })
        .expect(200);

      expect(response.body.data.accepted).toEqual([good]);
      expect(response.body.data.rejected).toEqual([{ clientEventId: bad, code: 'NOT_FOUND' }]);
    });
  });

  describe('POST /tracking/positions', () => {
    it("stores GPS points against the driver's own trip", async () => {
      const ctx = await createCompanyWithDriver(app);
      const trip = await api(app)
        .post('/api/v1/trips')
        .set(auth(ctx.owner.accessToken))
        .send({ vehicleId: ctx.vehicleId, driverId: ctx.driverId })
        .expect(201);

      const response = await api(app)
        .post('/api/v1/tracking/positions')
        .set(auth(ctx.driverUser.accessToken))
        .send({
          positions: [
            {
              tripId: trip.body.data.id,
              lat: 41.3,
              lng: 69.2,
              speed: 62,
              recordedAt: new Date().toISOString(),
            },
          ],
        })
        .expect(200);

      expect(response.body.data).toEqual({ accepted: 1, dropped: 0 });
      expect(await prisma.gpsTrack.count({ where: { tripId: trip.body.data.id } })).toBe(1);
    });

    it("silently drops points for a trip that is not the driver's", async () => {
      const mine = await createCompanyWithDriver(app);
      const foreign = await createCompanyWithDriver(app);
      const foreignTrip = await api(app)
        .post('/api/v1/trips')
        .set(auth(foreign.owner.accessToken))
        .send({ vehicleId: foreign.vehicleId, driverId: foreign.driverId })
        .expect(201);

      const response = await api(app)
        .post('/api/v1/tracking/positions')
        .set(auth(mine.driverUser.accessToken))
        .send({
          positions: [
            {
              tripId: foreignTrip.body.data.id,
              lat: 41.3,
              lng: 69.2,
              recordedAt: new Date().toISOString(),
            },
          ],
        })
        .expect(200);

      expect(response.body.data).toEqual({ accepted: 0, dropped: 1 });
      expect(await prisma.gpsTrack.count()).toBe(0);
    });
  });
});
