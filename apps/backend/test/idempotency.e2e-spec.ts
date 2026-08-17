/**
 * Replay protection on money endpoints (TASK-3.2).
 *
 * There was no Idempotency-Key and no unique constraint, so submitting
 * 1,000,000 so'm twice produced two expenses — and the mobile retry loop and a
 * double-clicked form both walk that path routinely.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Idempotency (e2e)', () => {
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
    tenant = await createTenant(app, 'Idempotency');
  });

  const expenseBody = (amount = '100000000') => ({
    category: 'FUEL',
    amount,
    expenseDate: '2026-08-17T09:00:00.000Z',
    tripId: tenant.trip.id,
  });

  const postExpense = (key: string | undefined, body: object, token = tenant.tokens.owner) => {
    const req = request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('authorization', `Bearer ${token}`);
    if (key) req.set('idempotency-key', key);
    return req.send(body);
  };

  it('refuses a money request with no key', async () => {
    const res = await postExpense(undefined, expenseBody());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await prisma.expense.count()).toBe(0);
  });

  it('the same key twice creates one expense and returns the first answer', async () => {
    const key = randomUUID();

    const first = await postExpense(key, expenseBody());
    const second = await postExpense(key, expenseBody());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Same id: as far as the client can tell, one request happened.
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await prisma.expense.count()).toBe(1);
  });

  it('two simultaneous submits still leave one expense', async () => {
    const key = randomUUID();

    // The double-click case: both are in flight before either has answered.
    const [a, b] = await Promise.all([
      postExpense(key, expenseBody()),
      postExpense(key, expenseBody()),
    ]);

    expect([a.status, b.status].every((status) => status === 201)).toBe(true);
    expect(await prisma.expense.count()).toBe(1);
  });

  it('the same key with a different payload is refused, not silently replayed', async () => {
    const key = randomUUID();
    await postExpense(key, expenseBody('100000000')).expect(201);

    const res = await postExpense(key, expenseBody('999999999'));

    // Returning the old answer here would quietly discard the second amount.
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.expense.count()).toBe(1);
  });

  it('ignores the order of keys in the payload when comparing', async () => {
    const key = randomUUID();
    const body = expenseBody();
    await postExpense(key, body).expect(201);

    // The same data serialised in a different order is the same request.
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    const res = await postExpense(key, reordered);
    expect(res.status).toBe(201);
    expect(await prisma.expense.count()).toBe(1);
  });

  it('scopes keys per company: two tenants may use the same key', async () => {
    const other = await createTenant(app, 'Other');
    const key = randomUUID();

    await postExpense(key, expenseBody()).expect(201);
    const theirs = await request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('authorization', `Bearer ${other.tokens.owner}`)
      .set('idempotency-key', key)
      .send({
        category: 'TOLL',
        amount: '5000',
        expenseDate: '2026-08-17T09:00:00.000Z',
        tripId: other.trip.id,
      });

    expect(theirs.status).toBe(201);
    expect(await prisma.expense.count()).toBe(2);
  });

  it('a different key means a genuinely new expense', async () => {
    await postExpense(randomUUID(), expenseBody()).expect(201);
    await postExpense(randomUUID(), expenseBody()).expect(201);

    expect(await prisma.expense.count()).toBe(2);
  });

  it('protects incomes and trip creation the same way', async () => {
    const incomeKey = randomUUID();
    const income = () =>
      request(app.getHttpServer())
        .post('/api/v1/incomes')
        .set('authorization', `Bearer ${tenant.tokens.owner}`)
        .set('idempotency-key', incomeKey)
        .send({ amount: '950000000', clientId: tenant.client.id });

    await income().expect(201);
    await income().expect(201);
    expect(await prisma.income.count()).toBe(1);

    const tripKey = randomUUID();
    const trip = () =>
      request(app.getHttpServer())
        .post('/api/v1/trips')
        .set('authorization', `Bearer ${tenant.tokens.owner}`)
        .set('idempotency-key', tripKey)
        .send({ cargoName: 'Un', agreedPrice: '100000' });

    const created = await trip();
    expect(created.status).toBe(201);
    const replayed = await trip();
    expect(replayed.body.data.id).toBe(created.body.data.id);
    // A duplicated trip would also burn a trip number.
    expect(await prisma.trip.count()).toBe(2); // the fixture trip plus this one
  });

  it('does not store a key when the request itself failed', async () => {
    const key = randomUUID();

    // References another tenant's trip: rejected, so nothing to replay.
    const other = await createTenant(app, 'Other');
    await postExpense(key, { ...expenseBody(), tripId: other.trip.id }).expect(404);

    expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(0);
    // …and the key is free for the corrected request.
    await postExpense(key, expenseBody()).expect(201);
  });
});
