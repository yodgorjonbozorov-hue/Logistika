/**
 * The live map and the route history, bounded (TASK-4.1).
 *
 * MEASURED BEFORE, on 40 vehicles x 90 days x one point per 30s = 10 368 000
 * rows: the live query was a parallel sequential scan and a sort of the whole
 * table with no LIMIT, because Prisma's `distinct` de-duplicates in the client.
 * It did not finish in ten minutes. The map polls it every thirty seconds.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';
import { MAX_HISTORY_DAYS, MAX_HISTORY_POINTS } from '../src/modules/tracking/tracking.service';

jest.setTimeout(60_000);

describe('Tracking performance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TenantFixture;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    tenant = await createTenant(app, 'Perf');
    await request(app.getHttpServer())
      .post(`/api/v1/trips/${tenant.trip.id}/start`)
      .set('authorization', `Bearer ${tenant.tokens.owner}`)
      .send({})
      .expect(200);
  });

  const server = () => app.getHttpServer();
  const owner = () => `Bearer ${tenant.tokens.owner}`;

  const sendPositions = (positions: Array<Record<string, unknown>>) =>
    request(server())
      .post('/api/v1/tracking/positions')
      .set('authorization', `Bearer ${tenant.tokens.driver}`)
      .send({ positions });

  const at = (secondsAgo: number, lat = 41.3) => ({
    tripId: tenant.trip.id,
    lat,
    lng: 69.2,
    speed: 64,
    recordedAt: new Date(Date.now() - secondsAgo * 1000).toISOString(),
  });

  describe('the live map', () => {
    it('shows the position a batch just reported', async () => {
      await sendPositions([at(60, 41.1), at(30, 41.5)]).expect(200);

      const res = await request(server())
        .get('/api/v1/tracking/live')
        .set('authorization', owner())
        .expect(200);

      const vehicle = res.body.data.find(
        (v: { vehicleId: string }) => v.vehicleId === tenant.vehicle.id,
      );
      // The newest point of the batch, not the last one in the array.
      expect(vehicle.lastPosition.lat).toBe(41.5);
    });

    it('reads it from the vehicle row, so the answer survives an empty GPS table', async () => {
      await sendPositions([at(30, 41.5)]).expect(200);
      // The nightly archival moves old tracks out; the map must not go blank.
      await prisma.gpsTrack.deleteMany({ where: { companyId: tenant.company.id } });

      const res = await request(server())
        .get('/api/v1/tracking/live')
        .set('authorization', owner())
        .expect(200);

      const vehicle = res.body.data.find(
        (v: { vehicleId: string }) => v.vehicleId === tenant.vehicle.id,
      );
      expect(vehicle.lastPosition.lat).toBe(41.5);
    });

    it('shows no position for a truck that has never reported one', async () => {
      const res = await request(server())
        .get('/api/v1/tracking/live')
        .set('authorization', owner())
        .expect(200);

      const vehicle = res.body.data.find(
        (v: { vehicleId: string }) => v.vehicleId === tenant.vehicle.id,
      );
      expect(vehicle.lastPosition).toBeNull();
    });

    it('does not let a late flush drag the marker backwards', async () => {
      await sendPositions([at(30, 41.5)]).expect(200);
      // A phone that was offline for an hour flushes its queue now.
      await sendPositions([at(3600, 40.0)]).expect(200);

      const res = await request(server())
        .get('/api/v1/tracking/live')
        .set('authorization', owner())
        .expect(200);

      const vehicle = res.body.data.find(
        (v: { vehicleId: string }) => v.vehicleId === tenant.vehicle.id,
      );
      expect(vehicle.lastPosition.lat).toBe(41.5);
    });
  });

  describe('the route history', () => {
    const historyOver = (days: number) => {
      const to = new Date();
      const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
      return request(server())
        .get(`/api/v1/tracking/vehicles/${tenant.vehicle.id}/history`)
        .query({ from: from.toISOString(), to: to.toISOString() })
        .set('authorization', owner());
    };

    it(`refuses a window wider than ${MAX_HISTORY_DAYS} days`, async () => {
      const res = await historyOver(MAX_HISTORY_DAYS + 1);

      // 90 days of one truck is 259 000 points in a single JSON response.
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('accepts a month', async () => {
      await historyOver(MAX_HISTORY_DAYS - 1).expect(200);
    });

    it('answers with a thinned route and says what it was drawn from', async () => {
      const positions = Array.from({ length: 300 }, (_, i) => at(3000 - i * 10, 41 + i / 1000));
      await sendPositions(positions).expect(200);

      const res = await historyOver(1).expect(200);

      expect(res.body.data.points.length).toBeLessThanOrEqual(MAX_HISTORY_POINTS);
      expect(res.body.data.totalPoints).toBe(300);
      expect(res.body.data.truncated).toBe(false);
    });

    it('keeps both ends of the journey', async () => {
      const positions = Array.from({ length: 50 }, (_, i) => at(3000 - i * 10, 41 + i / 100));
      await sendPositions(positions).expect(200);

      const { points } = (await historyOver(1).expect(200)).body.data;
      // A route that loses its end looks like a truck that never arrived.
      expect(points[0].lat).toBeCloseTo(41);
      expect(points.at(-1).lat).toBeCloseTo(41.49);
    });
  });
});
