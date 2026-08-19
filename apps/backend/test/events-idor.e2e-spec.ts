/**
 * H-1 — GET /events was an IDOR.
 *
 * `tripId` was an optional raw query string. Omitted, the query degraded to
 * "every event in the company"; supplied, no check tied the trip to the calling
 * driver, so any driver could read any colleague's stops, notes and positions.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import {
  api,
  auth,
  createCompanyWithDriver,
  createTestApp,
  createUser,
  login,
  prisma,
  resetDatabase,
  resetRateLimits,
} from './harness';

describe('GET /events (H-1)', () => {
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

  /** Two drivers in one company, each with a trip carrying one event. */
  async function twoDrivers() {
    const ctx = await createCompanyWithDriver(app);

    const secondUser = await createUser(ctx.company.id, 'DRIVER');
    await login(app, secondUser);
    const secondDriver = await api(app)
      .post('/api/v1/drivers')
      .set(auth(ctx.owner.accessToken))
      .send({ fullName: 'Second Driver', userId: secondUser.id })
      .expect(201);
    const secondVehicle = await api(app)
      .post('/api/v1/vehicles')
      .set(auth(ctx.owner.accessToken))
      .send({ plateNumber: `02Z${Date.now().toString(36).slice(-4).toUpperCase()}` })
      .expect(201);

    const tripOne = await api(app)
      .post('/api/v1/trips')
      .set(auth(ctx.owner.accessToken))
      .send({ vehicleId: ctx.vehicleId, driverId: ctx.driverId })
      .expect(201);
    const tripTwo = await api(app)
      .post('/api/v1/trips')
      .set(auth(ctx.owner.accessToken))
      .send({ vehicleId: secondVehicle.body.data.id, driverId: secondDriver.body.data.id })
      .expect(201);

    for (const [user, tripId, note] of [
      [ctx.driverUser, tripOne.body.data.id, 'first-driver-note'],
      [secondUser, tripTwo.body.data.id, 'second-driver-note'],
    ] as const) {
      await api(app)
        .post('/api/v1/events/batch')
        .set(auth(user.accessToken))
        .send({
          events: [
            {
              clientEventId: randomUUID(),
              tripId,
              eventType: 'REST',
              eventTime: new Date().toISOString(),
              comment: note,
            },
          ],
        })
        .expect(200);
    }

    return {
      owner: ctx.owner,
      driverOne: ctx.driverUser,
      driverTwo: secondUser,
      tripOne: tripOne.body.data.id as string,
      tripTwo: tripTwo.body.data.id as string,
    };
  }

  it('tripId is mandatory — the endpoint can never dump a whole company', async () => {
    const { owner } = await twoDrivers();

    const response = await api(app).get('/api/v1/events').set(auth(owner.accessToken)).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a malformed tripId instead of ignoring the filter', async () => {
    const { owner } = await twoDrivers();
    await api(app)
      .get('/api/v1/events')
      .query({ tripId: 'not-a-uuid' })
      .set(auth(owner.accessToken))
      .expect(400);
  });

  it("a driver cannot read a colleague's events", async () => {
    const { driverOne, tripTwo } = await twoDrivers();

    const response = await api(app)
      .get('/api/v1/events')
      .query({ tripId: tripTwo })
      .set(auth(driverOne.accessToken));

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('second-driver-note');
  });

  it('a driver still reads their own events', async () => {
    const { driverOne, tripOne } = await twoDrivers();

    const response = await api(app)
      .get('/api/v1/events')
      .query({ tripId: tripOne })
      .set(auth(driverOne.accessToken))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].comment).toBe('first-driver-note');
  });

  it('an office role reads any trip inside their own company', async () => {
    const { owner, tripOne, tripTwo } = await twoDrivers();

    for (const [tripId, note] of [
      [tripOne, 'first-driver-note'],
      [tripTwo, 'second-driver-note'],
    ] as const) {
      const response = await api(app)
        .get('/api/v1/events')
        .query({ tripId })
        .set(auth(owner.accessToken))
        .expect(200);
      expect(response.body.data[0].comment).toBe(note);
    }
  });

  it("an office role still cannot read another COMPANY's trip", async () => {
    const { owner } = await twoDrivers();
    const foreign = await createCompanyWithDriver(app);
    const foreignTrip = await api(app)
      .post('/api/v1/trips')
      .set(auth(foreign.owner.accessToken))
      .send({ vehicleId: foreign.vehicleId, driverId: foreign.driverId })
      .expect(201);

    await api(app)
      .get('/api/v1/events')
      .query({ tripId: foreignTrip.body.data.id })
      .set(auth(owner.accessToken))
      .expect(404);
  });

  it('an unlinked driver account gets a clear error, not somebody else’s data', async () => {
    const { tripOne } = await twoDrivers();
    const company = await prisma.company.findFirstOrThrow();
    const orphan = await createUser(company.id, 'DRIVER');
    await login(app, orphan);

    const response = await api(app)
      .get('/api/v1/events')
      .query({ tripId: tripOne })
      .set(auth(orphan.accessToken));
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('DRIVER_PROFILE_MISSING');
  });
});
