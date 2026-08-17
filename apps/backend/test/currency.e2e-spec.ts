/**
 * Multi-currency (TASK-3.3).
 *
 * Currency{UZS,USD,RUB,KZT} sat on every money table with no rate table and no
 * conversion code, so a report could add USD cents to UZS tiyin and produce a
 * number that means nothing.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Currency conversion (e2e)', () => {
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
    await prisma.exchangeRate.deleteMany();
    tenant = await createTenant(app, 'Currency');
  });

  const postExpense = (body: object) =>
    request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('authorization', `Bearer ${tenant.tokens.owner}`)
      .set('idempotency-key', randomUUID())
      .send(body);

  const expense = (extra: object = {}) => ({
    category: 'FUEL',
    amount: '10000',
    expenseDate: '2026-08-17T09:00:00.000Z',
    ...extra,
  });

  it('stores UZS amounts with base equal to amount and no rate', async () => {
    const res = await postExpense(expense()).expect(201);

    const stored = await prisma.expense.findUnique({ where: { id: res.body.data.id } });
    expect(stored?.amountBase).toBe(10_000n);
    // Recording a rate of 1 would imply a conversion that never happened.
    expect(stored?.rateUsed).toBeNull();
  });

  it('converts a foreign amount and freezes the rate on the row', async () => {
    await prisma.exchangeRate.create({
      data: {
        currency: 'USD',
        date: new Date('2026-08-17T00:00:00Z'),
        rateToUzs: '12500.5',
        source: 'test',
      },
    });

    const res = await postExpense(expense({ currency: 'USD' })).expect(201);
    const stored = await prisma.expense.findUnique({ where: { id: res.body.data.id } });

    // 100.00 USD at 12 500.5 → 1 250 050.00 UZS, in tiyin.
    expect(stored?.amountBase).toBe(125_005_000n);
    expect(String(stored?.rateUsed)).toBe('12500.5');
    expect(stored?.rateDate?.toISOString()).toBe('2026-08-17T00:00:00.000Z');
  });

  it('refuses the write when no rate exists rather than guessing one', async () => {
    const res = await postExpense(expense({ currency: 'USD' }));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('EXCHANGE_RATE_MISSING');
    expect(await prisma.expense.count()).toBe(0);
  });

  it('a later rate change does not move an already recorded amount', async () => {
    await prisma.exchangeRate.create({
      data: {
        currency: 'USD',
        date: new Date('2026-08-17T00:00:00Z'),
        rateToUzs: '12500',
        source: 'test',
      },
    });
    const res = await postExpense(expense({ currency: 'USD' })).expect(201);

    // The currency moves; last month's report must not.
    await prisma.exchangeRate.create({
      data: {
        currency: 'USD',
        date: new Date('2026-09-01T00:00:00Z'),
        rateToUzs: '13000',
        source: 'test',
      },
    });

    const stored = await prisma.expense.findUnique({ where: { id: res.body.data.id } });
    expect(stored?.amountBase).toBe(125_000_000n);
  });

  it('credits the ledger in base units for a foreign payment', async () => {
    await prisma.exchangeRate.create({
      data: {
        currency: 'USD',
        date: new Date('2026-08-01T00:00:00Z'),
        rateToUzs: '12500',
        source: 'test',
      },
    });

    const income = await request(app.getHttpServer())
      .post('/api/v1/incomes')
      .set('authorization', `Bearer ${tenant.tokens.owner}`)
      .set('idempotency-key', randomUUID())
      .send({ amount: '10000', currency: 'USD', clientId: tenant.client.id })
      .expect(201);

    const entry = await prisma.ledgerEntry.findFirst({
      where: { incomeId: income.body.data.id },
    });
    expect(entry?.amount).toBe(10_000n);
    expect(entry?.currency).toBe('USD');
    // The ledger only ever aggregates amountBase.
    expect(entry?.amountBase).toBe(125_000_000n);
  });

  describe('rate administration', () => {
    it('is restricted to SUPERADMIN', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/exchange-rates')
        .set('authorization', `Bearer ${tenant.tokens.owner}`)
        .send({ currency: 'USD', date: '2026-08-17', rateToUzs: '12500' });
      expect(res.status).toBe(403);
    });

    it('stores one rate per currency per day, updating it in place', async () => {
      const superadmin = await prisma.user.create({
        data: {
          fullName: 'Platform Admin',
          email: `sa-${randomUUID()}@example.test`,
          role: 'SUPERADMIN',
          passwordHash: 'x',
          companyId: null,
        },
      });
      const { AuthService } = await import('../src/modules/auth/auth.service');
      const { accessToken } = await app.get(AuthService).issueTokens(superadmin);

      const post = (rate: string) =>
        request(app.getHttpServer())
          .post('/api/v1/admin/exchange-rates')
          .set('authorization', `Bearer ${accessToken}`)
          .send({ currency: 'USD', date: '2026-08-17', rateToUzs: rate });

      await post('12500').expect(201);
      await post('12600').expect(201);

      const rates = await prisma.exchangeRate.findMany({ where: { currency: 'USD' } });
      expect(rates).toHaveLength(1);
      expect(String(rates[0]?.rateToUzs)).toBe('12600');
    });
  });
});
