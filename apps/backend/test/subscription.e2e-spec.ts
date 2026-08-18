/**
 * Subscription enforcement (TASK-3.9).
 *
 * `Company.isActive` and `subscriptionUntil` existed from the first migration
 * and were set by SUPERADMIN, but nothing ever read them. A company that
 * stopped paying — or was switched off outright — kept full access to every
 * endpoint in the product.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';
import { SubscriptionService } from '../src/common/subscription/subscription.service';

jest.setTimeout(60_000);

describe('Subscription (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let subscriptions: SubscriptionService;
  let tenant: TenantFixture;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
    subscriptions = app.get(SubscriptionService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    // The cache outlives a truncate, and every fixture reuses ids.
    subscriptions.clear();
    tenant = await createTenant(app, 'Billing');
  });

  const setCompany = async (data: { isActive?: boolean; subscriptionUntil?: Date | null }) => {
    await prisma.company.update({ where: { id: tenant.company.id }, data });
    subscriptions.invalidate(tenant.company.id);
  };

  const read = () =>
    request(app.getHttpServer())
      .get('/api/v1/trips')
      .set('authorization', `Bearer ${tenant.tokens.owner}`);

  const write = () =>
    request(app.getHttpServer())
      .post('/api/v1/trips')
      .set('authorization', `Bearer ${tenant.tokens.owner}`)
      .set('idempotency-key', randomUUID())
      .send({ agreedPrice: '1000000' });

  describe('a subscription that has run out', () => {
    beforeEach(() => setCompany({ subscriptionUntil: new Date('2020-01-01T00:00:00Z') }));

    it('still lets the office read its own data', async () => {
      const res = await read().expect(200);
      expect(res.body.success).toBe(true);
    });

    it('says so in the response, so nobody is surprised by the first failed save', async () => {
      const res = await read().expect(200);
      expect(res.body.meta.subscription).toEqual({
        expired: true,
        until: '2020-01-01T00:00:00.000Z',
      });
    });

    it('refuses a write with 402 and the date it ran out', async () => {
      const res = await write();

      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe('SUBSCRIPTION_EXPIRED');
      expect(res.body.error.message).toContain('2020-01-01');
      expect(await prisma.trip.count({ where: { companyId: tenant.company.id } })).toBe(1);
    });

    it('refuses the driver app the same way', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/events/batch')
        .set('authorization', `Bearer ${tenant.tokens.driver}`)
        .send({
          events: [
            {
              clientEventId: randomUUID(),
              tripId: tenant.trip.id,
              eventType: 'REFUEL',
              eventTime: new Date().toISOString(),
            },
          ],
        });

      expect(res.status).toBe(402);
      expect(await prisma.tripEvent.count()).toBe(0);
    });
  });

  describe('a company that was switched off', () => {
    beforeEach(() => setCompany({ isActive: false }));

    it('is refused even for reads', async () => {
      const res = await read();
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('COMPANY_INACTIVE');
    });

    it('is refused for writes', async () => {
      expect((await write()).status).toBe(403);
    });

    it('can still reach the public auth routes', async () => {
      // Otherwise the company could not log in to find out why it is locked.
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('x-forwarded-for', `10.0.0.${Math.floor(Math.random() * 250) + 1}`)
        .send({});
      expect(res.status).not.toBe(403);
    });
  });

  describe('a company in good standing', () => {
    it('writes normally with a future date', async () => {
      await setCompany({ subscriptionUntil: new Date('2099-01-01T00:00:00Z') });
      await write().expect(201);
    });

    it('writes normally with no date at all', async () => {
      // A trial, or a tenant created before billing existed.
      await setCompany({ subscriptionUntil: null });
      await write().expect(201);
      expect((await read().expect(200)).body.meta?.subscription).toBeUndefined();
    });
  });

  it('takes effect the moment SUPERADMIN switches the company off', async () => {
    await write().expect(201);

    const superadminToken = await superadmin();
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/companies/${tenant.company.id}`)
      .set('authorization', `Bearer ${superadminToken}`)
      .send({ isActive: false })
      .expect(200);

    // Not "in up to a minute, when the cache expires".
    expect((await read()).status).toBe(403);
  });

  it('never blocks SUPERADMIN, who is the one who fixes it', async () => {
    await setCompany({ isActive: false });
    const superadminToken = await superadmin();

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/companies/${tenant.company.id}`)
      .set('authorization', `Bearer ${superadminToken}`)
      .send({ isActive: true })
      .expect(200);

    expect((await read()).status).toBe(200);
  });

  async function superadmin(): Promise<string> {
    const argon2 = await import('argon2');
    const { AuthService } = await import('../src/modules/auth/auth.service');
    const user = await prisma.user.create({
      data: {
        companyId: null,
        fullName: 'Platform Root',
        email: `root.${randomUUID().slice(0, 8)}@example.test`,
        role: 'SUPERADMIN',
        passwordHash: await argon2.hash('E2ePassw0rd!'),
      },
    });
    const tokens = await app.get(AuthService).issueTokens(user);
    return tokens.accessToken;
  }
});
