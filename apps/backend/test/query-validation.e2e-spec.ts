/**
 * Query parameters are input too (TASK-2.3).
 *
 * GET /events used to take a bare `@Query('tripId')` with no DTO: omitting it
 * produced `where: { tripId: undefined }`, which Prisma ignores, so the handler
 * returned every event of the whole company — unpaginated, to every role
 * including DRIVER. Route history did its date parsing by hand.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Query validation (e2e)', () => {
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
    tenant = await createTenant(app, 'Query');
    await prisma.tripEvent.create({
      data: {
        companyId: tenant.company.id,
        tripId: tenant.trip.id,
        driverId: tenant.driver.id,
        eventType: 'START',
        eventTime: new Date(),
      },
    });
  });

  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set('authorization', `Bearer ${token}`);

  describe('GET /events', () => {
    it('refuses to list events without a trip', async () => {
      const res = await get('/api/v1/events', tenant.tokens.owner);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a tripId that is not a uuid', async () => {
      const res = await get('/api/v1/events?tripId=not-a-uuid', tenant.tokens.owner);
      expect(res.status).toBe(400);
    });

    it('returns one trip worth of events, with pagination metadata', async () => {
      const res = await get(`/api/v1/events?tripId=${tenant.trip.id}`, tenant.tokens.owner);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.pagination).toMatchObject({ page: 1, total: 1 });
    });

    it("hides another driver's trip from a driver", async () => {
      const colleague = await prisma.driver.create({
        data: { companyId: tenant.company.id, fullName: 'Colleague' },
      });
      const otherTrip = await prisma.trip.create({
        data: {
          companyId: tenant.company.id,
          tripNumber: `TR-Q-${randomUUID().slice(0, 6)}`,
          driverId: colleague.id,
          status: 'ASSIGNED',
        },
      });
      await prisma.tripEvent.create({
        data: {
          companyId: tenant.company.id,
          tripId: otherTrip.id,
          driverId: colleague.id,
          eventType: 'REFUEL',
          eventTime: new Date(),
        },
      });

      const res = await get(`/api/v1/events?tripId=${otherTrip.id}`, tenant.tokens.driver);
      expect(res.status).toBe(404);
    });

    it('lets a driver read their own trip events', async () => {
      const res = await get(`/api/v1/events?tripId=${tenant.trip.id}`, tenant.tokens.driver);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /tracking/vehicles/:id/history', () => {
    const path = (query: string) =>
      `/api/v1/tracking/vehicles/${tenant.vehicle.id}/history${query}`;

    it('requires both ends of the range', async () => {
      const res = await get(path(''), tenant.tokens.logist);
      expect(res.status).toBe(400);
    });

    it('rejects an unparseable date instead of failing deep in the query layer', async () => {
      const res = await get(path('?from=yesterday&to=today'), tenant.tokens.logist);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('accepts a valid ISO range', async () => {
      const from = new Date(Date.now() - 3_600_000).toISOString();
      const to = new Date().toISOString();
      const res = await get(path(`?from=${from}&to=${to}`), tenant.tokens.logist);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
