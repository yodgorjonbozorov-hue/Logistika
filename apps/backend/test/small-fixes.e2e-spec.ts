/**
 * The grouped items of TASK-3.12, each small on its own.
 *
 * They are here together because that is how they were fixed — one commit, one
 * suite — not because they are related.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenVersionService } from '../src/common/auth/token-version.service';

jest.setTimeout(60_000);

describe('Small fixes (e2e)', () => {
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
    app.get(TokenVersionService).clear();
    tenant = await createTenant(app, 'Small');
  });

  const server = () => app.getHttpServer();
  const owner = () => `Bearer ${tenant.tokens.owner}`;
  const ip = () => `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

  describe('unknown fields are refused, not dropped (M-22)', () => {
    it('rejects a misspelled field instead of storing a zero', async () => {
      const res = await request(server())
        .post('/api/v1/expenses')
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({
          category: 'FUEL',
          amout: '419780000', // the typo that used to cost a receipt
          amount: '419780000',
          expenseDate: '2026-08-17T09:00:00Z',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('still accepts a correct payload', async () => {
      await request(server())
        .post('/api/v1/expenses')
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({ category: 'FUEL', amount: '1000', expenseDate: '2026-08-17T09:00:00Z' })
        .expect(201);
    });
  });

  describe('date ranges are validated (M-6)', () => {
    it('answers 400 for an unparseable range instead of a 500 from Prisma', async () => {
      const res = await request(server())
        .get('/api/v1/trips?from=yesterday')
        .set('authorization', owner());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('accepts a real range', async () => {
      await request(server())
        .get('/api/v1/trips?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z')
        .set('authorization', owner())
        .expect(200);
    });
  });

  describe('dates stay inside a believable window (M-5, L-9)', () => {
    const farFuture = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString();

    it('refuses an expense dated next year', async () => {
      const res = await request(server())
        .post('/api/v1/expenses')
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({ category: 'FUEL', amount: '1000', expenseDate: farFuture });

      expect(res.status).toBe(400);
    });

    it('still accepts tomorrow, because midnight is a real problem', async () => {
      const tomorrow = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
      await request(server())
        .post('/api/v1/expenses')
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({ category: 'FUEL', amount: '1000', expenseDate: tomorrow })
        .expect(201);
    });

    it('refuses a driver event stamped by a wrong phone clock', async () => {
      const res = await request(server())
        .post('/api/v1/events/batch')
        .set('authorization', `Bearer ${tenant.tokens.driver}`)
        .send({
          events: [
            {
              clientEventId: randomUUID(),
              tripId: tenant.trip.id,
              eventType: 'REFUEL',
              eventTime: '1970-01-01T00:00:00Z',
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(await prisma.tripEvent.count()).toBe(0);
    });

    it('records when the server received the event, not just when the phone says', async () => {
      const clientEventId = randomUUID();
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

      await request(server())
        .post('/api/v1/events/batch')
        .set('authorization', `Bearer ${tenant.tokens.driver}`)
        .send({
          events: [
            {
              clientEventId,
              tripId: tenant.trip.id,
              eventType: 'REFUEL',
              eventTime: yesterday,
            },
          ],
        })
        .expect(200);

      const stored = await prisma.tripEvent.findFirstOrThrow({ where: { clientEventId } });
      // The gap between the two is the only way to tell a late sync from a
      // wrong clock (M-5).
      expect(stored.eventTime.toISOString()).toBe(yesterday);
      expect(stored.receivedAt.getTime()).toBeGreaterThan(stored.eventTime.getTime());
    });
  });

  describe('phone numbers have one form (M-3)', () => {
    it('stores whatever was typed in E.164', async () => {
      const suffix = String(Date.now()).slice(-7);
      const created = await request(server())
        .post('/api/v1/drivers')
        .set('authorization', owner())
        .send({ fullName: 'Anvar Karimov', phone: `90 ${suffix.slice(0, 3)} ${suffix.slice(3)}` })
        .expect(201);

      expect(created.body.data.phone).toBe(`+99890${suffix}`);
    });

    it('treats the same number written three ways as one', async () => {
      const digits = `9012${String(Date.now()).slice(-5)}`;
      const forms = [`+998${digits}`, `998${digits}`, digits];

      const normalized = await Promise.all(
        forms.map(async (phone) => {
          const res = await request(server())
            .post('/api/v1/clients')
            .set('authorization', owner())
            .send({ name: `Mijoz ${phone}`, phone });
          return res.body.data.phone as string;
        }),
      );

      // Three accounts for one person was the failure this prevents.
      expect(new Set(normalized).size).toBe(1);
    });

    it('refuses something that is not a number at all', async () => {
      const res = await request(server())
        .post('/api/v1/clients')
        .set('authorization', owner())
        .send({ name: 'Mijoz', phone: 'telefon yoq' });
      expect(res.status).toBe(400);
    });
  });

  describe('a token stops working when the decision behind it changes (M-2, L-2)', () => {
    it('refuses the access token of a user who was just deactivated', async () => {
      const staff = await prisma.user.findFirstOrThrow({
        where: { companyId: tenant.company.id, role: 'LOGIST' },
      });

      await request(server())
        .get('/api/v1/trips')
        .set('authorization', `Bearer ${tenant.tokens.logist}`)
        .expect(200);

      await request(server())
        .delete(`/api/v1/users/${staff.id}`)
        .set('authorization', owner())
        .expect(200);

      // It used to keep working for the rest of its 15 minutes.
      const after = await request(server())
        .get('/api/v1/trips')
        .set('authorization', `Bearer ${tenant.tokens.logist}`);
      expect(after.status).toBe(401);
    });

    it('refuses the old token after a role change', async () => {
      const staff = await prisma.user.findFirstOrThrow({
        where: { companyId: tenant.company.id, role: 'LOGIST' },
      });

      await request(server())
        .patch(`/api/v1/users/${staff.id}`)
        .set('authorization', owner())
        .send({ role: 'DRIVER' })
        .expect(200);

      const after = await request(server())
        .get('/api/v1/trips')
        .set('authorization', `Bearer ${tenant.tokens.logist}`);
      // A demoted user carried their old rights until the token expired.
      expect(after.status).toBe(401);
    });

    it('leaves the token alone for a harmless edit', async () => {
      const staff = await prisma.user.findFirstOrThrow({
        where: { companyId: tenant.company.id, role: 'LOGIST' },
      });

      await request(server())
        .patch(`/api/v1/users/${staff.id}`)
        .set('authorization', owner())
        .send({ fullName: 'Yangi Ism' })
        .expect(200);

      await request(server())
        .get('/api/v1/trips')
        .set('authorization', `Bearer ${tenant.tokens.logist}`)
        .expect(200);
    });

    it('refuses the access token after logout', async () => {
      const login = await request(server())
        .post('/api/v1/auth/login')
        .set('x-forwarded-for', ip())
        .send({ identifier: tenant.owner.email, password: 'E2ePassw0rd!' })
        .expect(200);

      const access = login.body.data.accessToken as string;
      const cookie = login.headers['set-cookie'] as unknown as string[];

      await request(server())
        .get('/api/v1/trips')
        .set('authorization', `Bearer ${access}`)
        .expect(200);

      await request(server())
        .post('/api/v1/auth/logout')
        .set('x-forwarded-for', ip())
        .set('Cookie', cookie)
        .send({})
        .expect(200);

      // On a shared phone this window is exactly what logging out is for.
      const after = await request(server())
        .get('/api/v1/trips')
        .set('authorization', `Bearer ${access}`);
      expect(after.status).toBe(401);
    });

    it('refuses the access token after a password change', async () => {
      const login = await request(server())
        .post('/api/v1/auth/login')
        .set('x-forwarded-for', ip())
        .send({ identifier: tenant.owner.email, password: 'E2ePassw0rd!' })
        .expect(200);
      const access = login.body.data.accessToken as string;

      await request(server())
        .post('/api/v1/auth/change-password')
        .set('authorization', `Bearer ${access}`)
        .send({ currentPassword: 'E2ePassw0rd!', newPassword: 'YangiPassw0rd!' })
        .expect(200);

      // Changing a password because it may have leaked, while the leaked
      // session keeps working for 15 minutes, is not a password change.
      const after = await request(server())
        .get('/api/v1/trips')
        .set('authorization', `Bearer ${access}`);
      expect(after.status).toBe(401);
    });
  });

  describe('company details are office-only (L-1)', () => {
    it('hides the INN, tariff and subscription from a driver', async () => {
      const res = await request(server())
        .get('/api/v1/company')
        .set('authorization', `Bearer ${tenant.tokens.driver}`);
      expect(res.status).toBe(403);
    });

    it('still shows them to the office', async () => {
      await request(server()).get('/api/v1/company').set('authorization', owner()).expect(200);
    });
  });

  describe('an expense is corrected by reversal, never by a negative amount (L-8)', () => {
    const createExpense = () =>
      request(server())
        .post('/api/v1/expenses')
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({ category: 'FUEL', amount: '500000000', expenseDate: '2026-08-17T09:00:00Z' })
        .expect(201);

    const reverse = (id: string, reason = "Chek noto'g'ri kiritilgan, summa 10 barobar ko'p") =>
      request(server())
        .post(`/api/v1/expenses/${id}/reverse`)
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({ reason });

    it('refuses a negative amount outright', async () => {
      const res = await request(server())
        .post('/api/v1/expenses')
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({ category: 'FUEL', amount: '-500000', expenseDate: '2026-08-17T09:00:00Z' });
      expect(res.status).toBe(400);
    });

    it('cancels an approved expense with a mirrored row, leaving the original intact', async () => {
      const created = await createExpense();
      const id = created.body.data.id as string;
      await request(server())
        .post(`/api/v1/expenses/${id}/approve`)
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(200);

      const res = await reverse(id).expect(200);

      expect(res.body.data.reversalOfId).toBe(id);
      expect(res.body.data.amount).toBe('500000000');
      // The original is the financial record; it does not change.
      const original = await prisma.expense.findUniqueOrThrow({ where: { id } });
      expect(original.amount).toBe(500_000_000n);
      expect(original.isApproved).toBe(true);
    });

    it('refuses a second reversal of the same expense', async () => {
      const created = await createExpense();
      const id = created.body.data.id as string;
      await reverse(id).expect(200);

      const second = await reverse(id);
      // Two reversals would cancel the same cost twice.
      expect(second.status).toBe(409);
    });

    it('refuses to reverse a reversal', async () => {
      const created = await createExpense();
      const reversal = await reverse(created.body.data.id as string).expect(200);

      const res = await reverse(reversal.body.data.id as string);
      expect(res.status).toBe(400);
    });

    it('demands a real reason', async () => {
      const created = await createExpense();
      const res = await reverse(created.body.data.id as string, 'x');
      expect(res.status).toBe(400);
    });
  });
});
