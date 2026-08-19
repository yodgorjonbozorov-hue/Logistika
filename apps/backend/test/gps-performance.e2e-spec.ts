/**
 * GPS read paths at production-ish volume (H-7, H-8).
 *
 * These two endpoints are the ones that fall over first as a fleet accumulates
 * history, and both old implementations degraded with the size of the TABLE
 * rather than the size of the ANSWER:
 *   - `live` used Prisma's client-side `distinct`, which downloads every row;
 *   - `history` had no bound at all on the date range or the row count.
 *
 * The volume here (60k points) is small enough to seed quickly and large enough
 * that a full-table read is unmistakable in the timings.
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

const POINTS_PER_VEHICLE = 20_000;
const VEHICLES = 3;

describe('GPS performance and bounds', () => {
  let app: NestExpressApplication;
  let owner: TestUser;
  let companyId: string;
  let vehicleIds: string[];

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase();
    const company = await createCompany();
    companyId = company.id;
    owner = await login(app, company.owner);

    vehicleIds = [];
    for (let index = 0; index < VEHICLES; index++) {
      const response = await api(app)
        .post('/api/v1/vehicles')
        .set(auth(owner.accessToken))
        .send({ plateNumber: `01G${uniqueSuffix().slice(-5).toUpperCase()}` })
        .expect(201);
      vehicleIds.push(response.body.data.id);
    }

    // ~60k GPS rows: one point every 30s over the last ~7 days per vehicle.
    const base = Date.now() - 7 * 86_400_000;
    for (const vehicleId of vehicleIds) {
      for (let chunk = 0; chunk < POINTS_PER_VEHICLE / 5000; chunk++) {
        await prisma.gpsTrack.createMany({
          data: Array.from({ length: 5000 }, (_unused, i) => {
            const n = chunk * 5000 + i;
            return {
              companyId,
              vehicleId,
              lat: 41.3 + n / 1_000_000,
              lng: 69.2 + n / 1_000_000,
              speed: 60,
              recordedAt: new Date(base + n * 30_000),
            };
          }),
        });
      }
    }
    await prisma.$executeRawUnsafe('ANALYZE gps_tracks');
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(() => resetRateLimits(app));

  it('seeded the expected volume', async () => {
    expect(await prisma.gpsTrack.count()).toBe(POINTS_PER_VEHICLE * VEHICLES);
  });

  describe('H-7 live map', () => {
    it('returns one latest fix per vehicle', async () => {
      const response = await api(app)
        .get('/api/v1/tracking/live')
        .set(auth(owner.accessToken))
        .expect(200);

      expect(response.body.data).toHaveLength(VEHICLES);
      for (const vehicle of response.body.data) {
        expect(vehicle.lastPosition).not.toBeNull();
        // The newest point is the last one seeded.
        const expected = new Date(
          Date.now() - 7 * 86_400_000 + (POINTS_PER_VEHICLE - 1) * 30_000,
        ).getTime();
        expect(
          Math.abs(new Date(vehicle.lastPosition.recordedAt).getTime() - expected),
        ).toBeLessThan(60_000);
      }
    });

    it('stays fast with 60k rows in the table (index probe, not a table read)', async () => {
      const started = Date.now();
      await api(app).get('/api/v1/tracking/live').set(auth(owner.accessToken)).expect(200);
      const elapsed = Date.now() - started;

      // Pulling 60k rows into Node and de-duplicating there allocated the whole
      // table. A generous ceiling still catches any regression to that shape.
      expect(elapsed).toBeLessThan(1500);
    });

    it('reads one row per vehicle by index, never the whole table', async () => {
      const ids = vehicleIds.map((id) => `'${id}'`).join(',');
      const plan = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
         SELECT v.id AS vehicle_id, g.lat, g.lng, g.speed, g.recorded_at
         FROM unnest(ARRAY[${ids}]::text[]) AS v(id)
         CROSS JOIN LATERAL (
           SELECT lat, lng, speed, recorded_at FROM gps_tracks
           WHERE company_id = '${companyId}' AND vehicle_id = v.id
           ORDER BY recorded_at DESC LIMIT 1
         ) g`,
      );
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');

      // The shape that matters: an index scan, and no sequential scan of the
      // 60k-row table anywhere in the plan.
      expect(text).toMatch(/Index Scan/);
      expect(text).not.toMatch(/Seq Scan on gps_tracks/);

      // And it really only touched a handful of rows.
      const rowsRead = [...text.matchAll(/actual time=[\d.]+\.\.[\d.]+ rows=(\d+)/g)].map((m) =>
        Number(m[1]),
      );
      expect(Math.max(...rowsRead)).toBeLessThanOrEqual(VEHICLES);
    });
  });

  describe('H-8 history bounds', () => {
    const iso = (offsetDays: number) =>
      new Date(Date.now() - offsetDays * 86_400_000).toISOString();

    it('refuses a range wider than the documented maximum', async () => {
      const response = await api(app)
        .get(`/api/v1/tracking/vehicles/${vehicleIds[0]}/history`)
        .query({ from: iso(400), to: iso(0) })
        .set(auth(owner.accessToken))
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses an unparsable date instead of 500-ing', async () => {
      await api(app)
        .get(`/api/v1/tracking/vehicles/${vehicleIds[0]}/history`)
        .query({ from: 'yesterday', to: iso(0) })
        .set(auth(owner.accessToken))
        .expect(400);
    });

    it('refuses an inverted range', async () => {
      await api(app)
        .get(`/api/v1/tracking/vehicles/${vehicleIds[0]}/history`)
        .query({ from: iso(0), to: iso(5) })
        .set(auth(owner.accessToken))
        .expect(400);
    });

    it('caps the page size even when the window holds far more points', async () => {
      const response = await api(app)
        .get(`/api/v1/tracking/vehicles/${vehicleIds[0]}/history`)
        .query({ from: iso(8), to: iso(0), limit: 500 })
        .set(auth(owner.accessToken))
        .expect(200);

      expect(response.body.data.points).toHaveLength(500);
      expect(response.body.data.nextCursor).not.toBeNull();
    });

    it('rejects a limit above the hard ceiling', async () => {
      await api(app)
        .get(`/api/v1/tracking/vehicles/${vehicleIds[0]}/history`)
        .query({ from: iso(8), to: iso(0), limit: 1_000_000 })
        .set(auth(owner.accessToken))
        .expect(400);
    });

    it('pages forward with the cursor without repeating a point', async () => {
      const first = await api(app)
        .get(`/api/v1/tracking/vehicles/${vehicleIds[0]}/history`)
        .query({ from: iso(8), to: iso(0), limit: 100 })
        .set(auth(owner.accessToken))
        .expect(200);

      const second = await api(app)
        .get(`/api/v1/tracking/vehicles/${vehicleIds[0]}/history`)
        .query({
          from: iso(8),
          to: iso(0),
          limit: 100,
          after: first.body.data.nextCursor,
        })
        .set(auth(owner.accessToken))
        .expect(200);

      const firstTimes = first.body.data.points.map((p: { recordedAt: string }) => p.recordedAt);
      const secondTimes = second.body.data.points.map((p: { recordedAt: string }) => p.recordedAt);
      expect(secondTimes).toHaveLength(100);
      expect(firstTimes.filter((t: string) => secondTimes.includes(t))).toEqual([]);
      expect(new Date(secondTimes[0]).getTime()).toBeGreaterThan(
        new Date(firstTimes[firstTimes.length - 1]).getTime(),
      );
    });

    it('one bounded page is fast regardless of table size', async () => {
      const started = Date.now();
      await api(app)
        .get(`/api/v1/tracking/vehicles/${vehicleIds[0]}/history`)
        .query({ from: iso(8), to: iso(0), limit: 1000 })
        .set(auth(owner.accessToken))
        .expect(200);
      expect(Date.now() - started).toBeLessThan(1500);
    });
  });

  describe('ingest at batch size', () => {
    it('accepts a full 500-point batch in one round trip', async () => {
      const driverUser = await (async () => {
        const { createUser: make } = await import('./harness');
        const user = await make(companyId, 'DRIVER');
        return login(app, user);
      })();
      const driver = await api(app)
        .post('/api/v1/drivers')
        .set(auth(owner.accessToken))
        .send({ fullName: 'Ingest Driver', userId: driverUser.id })
        .expect(201);
      const trip = await api(app)
        .post('/api/v1/trips')
        .set(auth(owner.accessToken))
        .send({ vehicleId: vehicleIds[0], driverId: driver.body.data.id })
        .expect(201);

      const started = Date.now();
      const response = await api(app)
        .post('/api/v1/tracking/positions')
        .set(auth(driverUser.accessToken))
        .send({
          positions: Array.from({ length: 500 }, (_unused, i) => ({
            tripId: trip.body.data.id,
            lat: 41.3,
            lng: 69.2,
            recordedAt: new Date(Date.now() - i * 1000).toISOString(),
          })),
        })
        .expect(200);

      expect(response.body.data.accepted).toBe(500);
      expect(Date.now() - started).toBeLessThan(3000);
    });

    it('refuses a batch beyond the documented maximum', async () => {
      const { createUser: make } = await import('./harness');
      const driverUser = await login(app, await make(companyId, 'DRIVER'));
      await api(app)
        .post('/api/v1/tracking/positions')
        .set(auth(driverUser.accessToken))
        .send({
          positions: Array.from({ length: 501 }, () => ({
            tripId: '00000000-0000-4000-8000-000000000000',
            lat: 41.3,
            lng: 69.2,
            recordedAt: new Date().toISOString(),
          })),
        })
        .expect(400);
    });
  });
});
