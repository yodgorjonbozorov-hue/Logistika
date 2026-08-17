/**
 * The isolation contract (CLAUDE.md): a user of company B must never reach a
 * resource of company A — not by reading it, not by changing it, not by
 * deleting it. Every tenant-scoped module is covered here; a new module gets a
 * row in the table below on the day it is added.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alpha: TenantFixture;
  let beta: TenantFixture;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    alpha = await createTenant(app, 'Alpha');
    beta = await createTenant(app, 'Beta');
  });

  const api = () => request(app.getHttpServer());
  const asBeta = (req: request.Test) => req.set('authorization', `Bearer ${beta.tokens.owner}`);

  /** Anything except 200/201: the resource must not be readable or writable. */
  const expectDenied = (status: number) => {
    expect([403, 404, 409, 400]).toContain(status);
  };

  describe('reads never cross the tenant boundary', () => {
    it('GET /trips/:id of another company → not found', async () => {
      const res = await asBeta(api().get(`/api/v1/trips/${alpha.trip.id}`));
      expectDenied(res.status);
    });

    it('GET /drivers/:id of another company → not found', async () => {
      const res = await asBeta(api().get(`/api/v1/drivers/${alpha.driver.id}`));
      expectDenied(res.status);
    });

    it('GET /vehicles/:id of another company → not found', async () => {
      const res = await asBeta(api().get(`/api/v1/vehicles/${alpha.vehicle.id}`));
      expectDenied(res.status);
    });

    it('GET /clients/:id of another company → not found', async () => {
      const res = await asBeta(api().get(`/api/v1/clients/${alpha.client.id}`));
      expectDenied(res.status);
    });

    it('list endpoints only ever return own rows', async () => {
      for (const path of ['/api/v1/trips', '/api/v1/drivers', '/api/v1/vehicles', '/api/v1/clients']) {
        const res = await asBeta(api().get(path));
        expect(res.status).toBe(200);
        const rows = res.body.data as Array<{ id: string; companyId?: string }>;
        const alphaIds = [alpha.trip.id, alpha.driver.id, alpha.vehicle.id, alpha.client.id];
        expect(rows.some((row) => alphaIds.includes(row.id))).toBe(false);
      }
    });

    it('GET /tracking/vehicles/:id/history of another company → no foreign points', async () => {
      await prisma.gpsTrack.create({
        data: {
          companyId: alpha.company.id,
          vehicleId: alpha.vehicle.id,
          lat: 41.3,
          lng: 69.2,
          recordedAt: new Date(),
        },
      });
      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 86_400_000).toISOString();
      const res = await asBeta(
        api().get(`/api/v1/tracking/vehicles/${alpha.vehicle.id}/history?from=${from}&to=${to}`),
      );
      if (res.status === 200) {
        expect(res.body.data).toHaveLength(0);
      } else {
        expectDenied(res.status);
      }
    });

    it('GET /files/:id/url of another company → not found', async () => {
      const file = await prisma.storedFile.create({
        data: {
          companyId: alpha.company.id,
          key: `alpha/${alpha.company.id}.jpg`,
          mimeType: 'image/jpeg',
          size: 10,
        },
      });
      const res = await asBeta(api().get(`/api/v1/files/${file.id}/url`));
      expectDenied(res.status);
    });

    it('GET /company returns the caller own company only', async () => {
      const res = await asBeta(api().get('/api/v1/company'));
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(beta.company.id);
      expect(res.body.data.id).not.toBe(alpha.company.id);
    });
  });

  describe('writes never cross the tenant boundary', () => {
    it('PATCH /trips/:id of another company → denied and the row is unchanged', async () => {
      const res = await asBeta(
        api().patch(`/api/v1/trips/${alpha.trip.id}`).send({ cargoName: 'hijacked' }),
      );
      expectDenied(res.status);
      const trip = await prisma.trip.findUnique({ where: { id: alpha.trip.id } });
      expect(trip?.cargoName).toBeNull();
    });

    it('PATCH /clients/:id of another company → denied', async () => {
      const res = await asBeta(
        api().patch(`/api/v1/clients/${alpha.client.id}`).send({ name: 'hijacked' }),
      );
      expectDenied(res.status);
      const client = await prisma.client.findUnique({ where: { id: alpha.client.id } });
      expect(client?.name).toBe(alpha.client.name);
    });

    it('DELETE /drivers/:id of another company → denied and the driver stays active', async () => {
      const res = await asBeta(api().delete(`/api/v1/drivers/${alpha.driver.id}`));
      expectDenied(res.status);
      const driver = await prisma.driver.findUnique({ where: { id: alpha.driver.id } });
      expect(driver?.isActive).toBe(true);
    });

    it('DELETE /vehicles/:id of another company → denied', async () => {
      const res = await asBeta(api().delete(`/api/v1/vehicles/${alpha.vehicle.id}`));
      expectDenied(res.status);
      const vehicle = await prisma.vehicle.findUnique({ where: { id: alpha.vehicle.id } });
      expect(vehicle?.isActive).toBe(true);
    });

    it('POST /expenses referencing another company trip → denied, nothing stored', async () => {
      const res = await asBeta(
        api().post('/api/v1/expenses').send({
          tripId: alpha.trip.id,
          category: 'FUEL',
          amount: '1000000',
          expenseDate: new Date().toISOString(),
        }),
      );
      expectDenied(res.status);
      const leaked = await prisma.expense.findFirst({ where: { tripId: alpha.trip.id } });
      expect(leaked).toBeNull();
    });

    it('POST /incomes referencing another company client → denied, nothing stored', async () => {
      const res = await asBeta(
        api().post('/api/v1/incomes').send({
          clientId: alpha.client.id,
          amount: '1000000',
        }),
      );
      expectDenied(res.status);
      const leaked = await prisma.income.findFirst({ where: { clientId: alpha.client.id } });
      expect(leaked).toBeNull();
    });

    it('POST /events/batch for another company trip → rejected, no event stored', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/events/batch')
        .set('authorization', `Bearer ${beta.tokens.driver}`)
        .send({
          events: [
            {
              clientEventId: '11111111-1111-4111-8111-111111111111',
              tripId: alpha.trip.id,
              eventType: 'START',
              eventTime: new Date().toISOString(),
            },
          ],
        });
      if (res.status === 200) {
        expect(res.body.data.accepted).toHaveLength(0);
        expect(res.body.data.rejected).toHaveLength(1);
      } else {
        expectDenied(res.status);
      }
      const leaked = await prisma.tripEvent.findFirst({ where: { tripId: alpha.trip.id } });
      expect(leaked).toBeNull();
    });

    it('POST /tracking/positions for another company trip → no foreign points stored', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/tracking/positions')
        .set('authorization', `Bearer ${beta.tokens.driver}`)
        .send({
          positions: [
            {
              tripId: alpha.trip.id,
              lat: 41.1,
              lng: 69.1,
              recordedAt: new Date().toISOString(),
            },
          ],
        });
      const leaked = await prisma.gpsTrack.findFirst({
        where: { tripId: alpha.trip.id, companyId: beta.company.id },
      });
      expect(leaked).toBeNull();
      const stolen = await prisma.gpsTrack.findFirst({
        where: { tripId: alpha.trip.id, companyId: alpha.company.id },
      });
      expect(stolen).toBeNull();
    });
  });

  it('an unauthenticated caller reaches nothing', async () => {
    const res = await api().get(`/api/v1/trips/${alpha.trip.id}`);
    expect(res.status).toBe(401);
  });
});
