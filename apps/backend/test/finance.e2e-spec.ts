/**
 * Financial integrity on real PostgreSQL.
 *
 * Money bugs do not show up in mocks: idempotency is a unique index, a double
 * booking is a race between two connections, and BigInt boundaries are a column
 * type. Every case here therefore goes through HTTP and reads the row back.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
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

describe('Financial integrity', () => {
  let app: NestExpressApplication;
  let owner: TestUser;
  let companyId: string;
  let tripId: string;
  let clientId: string;

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

    const vehicle = await api(app)
      .post('/api/v1/vehicles')
      .set(auth(owner.accessToken))
      .send({ plateNumber: `01F${uniqueSuffix().slice(-5).toUpperCase()}` })
      .expect(201);
    const client = await api(app)
      .post('/api/v1/clients')
      .set(auth(owner.accessToken))
      .send({ name: 'Payer LLC' })
      .expect(201);
    clientId = client.body.data.id;
    const trip = await api(app)
      .post('/api/v1/trips')
      .set(auth(owner.accessToken))
      .send({ vehicleId: vehicle.body.data.id, clientId, agreedPrice: '900000000' })
      .expect(201);
    tripId = trip.body.data.id;
  });

  const expenseBody = (overrides: Record<string, unknown> = {}) => ({
    category: 'FUEL',
    amount: '125050',
    expenseDate: new Date().toISOString(),
    tripId,
    ...overrides,
  });

  describe('H-3 idempotency', () => {
    it('a retried expense POST books the money exactly once', async () => {
      const clientTxId = `tx-${randomUUID()}`;

      const first = await api(app)
        .post('/api/v1/expenses')
        .set(auth(owner.accessToken))
        .send(expenseBody({ clientTxId }))
        .expect(201);
      const second = await api(app)
        .post('/api/v1/expenses')
        .set(auth(owner.accessToken))
        .send(expenseBody({ clientTxId }))
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);
      expect(await prisma.expense.count({ where: { companyId } })).toBe(1);
    });

    it('survives a genuinely CONCURRENT double submit (double click)', async () => {
      const clientTxId = `tx-${randomUUID()}`;

      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          api(app)
            .post('/api/v1/expenses')
            .set(auth(owner.accessToken))
            .send(expenseBody({ clientTxId })),
        ),
      );

      for (const response of responses) {
        expect(response.status).toBe(201);
      }
      const ids = new Set(responses.map((r) => r.body.data.id));
      expect(ids.size).toBe(1);
      expect(await prisma.expense.count({ where: { companyId } })).toBe(1);
    });

    it('the same key in two companies creates one row each (tenant-scoped index)', async () => {
      const clientTxId = `tx-${randomUUID()}`;
      const other = await createCompany();
      resetRateLimits(app);
      const otherOwner = await login(app, other.owner);

      await api(app)
        .post('/api/v1/expenses')
        .set(auth(owner.accessToken))
        .send(expenseBody({ clientTxId }))
        .expect(201);
      await api(app)
        .post('/api/v1/expenses')
        .set(auth(otherOwner.accessToken))
        .send({
          category: 'TOLL',
          amount: '1000',
          expenseDate: new Date().toISOString(),
          clientTxId,
        })
        .expect(201);

      expect(await prisma.expense.count()).toBe(2);
    });

    it('applies to income as well', async () => {
      const clientTxId = `tx-${randomUUID()}`;
      const body = { amount: '450000000', tripId, clientId, clientTxId };

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          api(app).post('/api/v1/incomes').set(auth(owner.accessToken)).send(body),
        ),
      );

      expect(new Set(responses.map((r) => r.body.data.id)).size).toBe(1);
      expect(await prisma.income.count({ where: { companyId } })).toBe(1);
    });

    it('without a key, two posts are two genuine expenses (no accidental dedup)', async () => {
      await api(app)
        .post('/api/v1/expenses')
        .set(auth(owner.accessToken))
        .send(expenseBody())
        .expect(201);
      await api(app)
        .post('/api/v1/expenses')
        .set(auth(owner.accessToken))
        .send(expenseBody())
        .expect(201);

      expect(await prisma.expense.count({ where: { companyId } })).toBe(2);
    });
  });

  describe('amount validation', () => {
    it.each([
      ['zero', '0'],
      ['negative', '-100'],
      ['fractional', '10.5'],
      ['non-numeric', 'lots'],
      ['beyond int8', '99999999999999999999999'],
    ])('rejects a %s amount', async (_label, amount) => {
      const response = await api(app)
        .post('/api/v1/expenses')
        .set(auth(owner.accessToken))
        .send(expenseBody({ amount }))
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('stores the largest safe amount without precision loss', async () => {
      const huge = '999999999999999999'; // 18 digits — the documented ceiling
      const response = await api(app)
        .post('/api/v1/expenses')
        .set(auth(owner.accessToken))
        .send(expenseBody({ amount: huge }))
        .expect(201);

      expect(response.body.data.amount).toBe(huge);
      const stored = await prisma.expense.findUniqueOrThrow({
        where: { id: response.body.data.id },
      });
      expect(stored.amount).toBe(BigInt(huge));
    });

    it('money crosses the wire as a string, never as a JS number', async () => {
      const response = await api(app)
        .post('/api/v1/expenses')
        .set(auth(owner.accessToken))
        .send(expenseBody({ amount: '9007199254740993' })) // > Number.MAX_SAFE_INTEGER
        .expect(201);

      expect(typeof response.body.data.amount).toBe('string');
      expect(response.body.data.amount).toBe('9007199254740993');
    });
  });

  describe('M-9 totals are pagination-independent', () => {
    it('aggregates every transaction on a trip, not just the first page', async () => {
      const rows = Array.from({ length: 150 }, () => ({
        companyId,
        tripId,
        category: 'TOLL' as const,
        amount: 1000n,
        expenseDate: new Date(),
      }));
      await prisma.expense.createMany({ data: rows });

      const response = await api(app)
        .get(`/api/v1/trips/${tripId}/finance`)
        .set(auth(owner.accessToken))
        .expect(200);

      expect(response.body.data.expenseTotal).toBe('150000');
      expect(response.body.data.expenseCount).toBe(150);
    });
  });

  describe('M-3 audit trail', () => {
    it('records create, update and delete of an expense', async () => {
      const created = await api(app)
        .post('/api/v1/expenses')
        .set(auth(owner.accessToken))
        .send(expenseBody())
        .expect(201);
      const id = created.body.data.id;

      await api(app)
        .patch(`/api/v1/expenses/${id}`)
        .set(auth(owner.accessToken))
        .send({ amount: '200000' })
        .expect(200);
      await api(app).delete(`/api/v1/expenses/${id}`).set(auth(owner.accessToken)).expect(200);

      // The audit writer is fire-and-forget; give it a tick to land.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const entries = await prisma.auditLog.findMany({
        where: { entityType: 'Expense', entityId: id },
        orderBy: { createdAt: 'asc' },
      });

      expect(entries.map((e) => e.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
      // A hard delete must leave the full row behind, or the money vanished
      // without a trace.
      expect(entries[2]!.before).toMatchObject({ amount: '200000', category: 'FUEL' });
      expect(entries[2]!.userId).toBe(owner.id);
    });
  });

  describe('M-2 client balance is derived, not a stored zero', () => {
    it('reflects unpaid income and drops to zero once paid', async () => {
      const income = await api(app)
        .post('/api/v1/incomes')
        .set(auth(owner.accessToken))
        .send({ amount: '750000000', clientId, tripId, status: 'PENDING' })
        .expect(201);

      let response = await api(app)
        .get(`/api/v1/clients/${clientId}`)
        .set(auth(owner.accessToken))
        .expect(200);
      expect(response.body.data.balance).toBe('750000000');

      await api(app)
        .patch(`/api/v1/incomes/${income.body.data.id}`)
        .set(auth(owner.accessToken))
        .send({ status: 'PAID' })
        .expect(200);

      response = await api(app)
        .get(`/api/v1/clients/${clientId}`)
        .set(auth(owner.accessToken))
        .expect(200);
      expect(response.body.data.balance).toBe('0');
    });
  });

  describe('approved records are immutable', () => {
    it('an approved expense cannot be edited or deleted', async () => {
      const created = await api(app)
        .post('/api/v1/expenses')
        .set(auth(owner.accessToken))
        .send(expenseBody())
        .expect(201);
      const id = created.body.data.id;
      await api(app)
        .post(`/api/v1/expenses/${id}/approve`)
        .set(auth(owner.accessToken))
        .expect(200);

      await api(app)
        .patch(`/api/v1/expenses/${id}`)
        .set(auth(owner.accessToken))
        .send({ amount: '1' })
        .expect(403);
      await api(app).delete(`/api/v1/expenses/${id}`).set(auth(owner.accessToken)).expect(403);

      const stored = await prisma.expense.findUniqueOrThrow({ where: { id } });
      expect(stored.amount).toBe(125050n);
    });
  });
});
