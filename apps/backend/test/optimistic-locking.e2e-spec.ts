/**
 * Concurrent writes (TASK-3.5, H-1).
 *
 * Every guarded write used to be a read-then-write: read the row, decide the
 * change is legal, write it. Two requests arriving together both read the same
 * row, both decided, and both wrote — so one trip was invoiced twice, one
 * expense was approved twice, and one payment correction reversed the same
 * ledger entry twice.
 *
 * These tests fire the requests genuinely in parallel. They are the only kind
 * that can fail here: a sequential test passes against the broken code.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Optimistic locking (e2e)', () => {
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
    tenant = await createTenant(app, 'Race');
  });

  const server = () => app.getHttpServer();
  const auth = () => `Bearer ${tenant.tokens.owner}`;

  /** Two distinct keys: idempotency must not be what makes this pass. */
  const complete = () =>
    request(server())
      .post(`/api/v1/trips/${tenant.trip.id}/complete`)
      .set('authorization', auth())
      .set('idempotency-key', randomUUID())
      .send({});

  it('lets exactly one of two parallel completions through', async () => {
    await request(server())
      .post(`/api/v1/trips/${tenant.trip.id}/start`)
      .set('authorization', auth())
      .send({})
      .expect(200);
    const started = await prisma.trip.findUniqueOrThrow({ where: { id: tenant.trip.id } });

    const [a, b] = await Promise.all([complete(), complete()]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('TRIP_INVALID_STATUS');

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tenant.trip.id } });
    expect(trip.status).toBe('COMPLETED');
    // One transition, one increment. Two would mean both writes landed.
    expect(trip.version).toBe(started.version + 1);

    // The money is the part that actually hurt: the client was billed twice
    // for one delivery, and nothing in the ledger said the two were the same.
    const invoices = await prisma.ledgerEntry.findMany({
      where: { tripId: tenant.trip.id, reason: 'TRIP_INVOICED' },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.amountBase).toBe(tenant.trip.agreedPrice);
  });

  it('lets exactly one of two parallel starts through', async () => {
    const start = () =>
      request(server())
        .post(`/api/v1/trips/${tenant.trip.id}/start`)
        .set('authorization', auth())
        .send({ startOdometer: 100_000 });

    const [a, b] = await Promise.all([start(), start()]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tenant.trip.id } });
    expect(trip.status).toBe('IN_PROGRESS');
    expect(trip.version).toBe(1);
  });

  it('refuses an edit written against a version the trip has moved past', async () => {
    const stale = await prisma.trip.findUniqueOrThrow({ where: { id: tenant.trip.id } });

    await request(server())
      .patch(`/api/v1/trips/${tenant.trip.id}`)
      .set('authorization', auth())
      .send({ cargoName: 'Paxta', version: stale.version })
      .expect(200);

    // Second editor still has the copy they loaded before the first save.
    const res = await request(server())
      .patch(`/api/v1/trips/${tenant.trip.id}`)
      .set('authorization', auth())
      .send({ cargoName: "Bug'doy", version: stale.version });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESOURCE_CONFLICT');
    // The first editor's change survives; the second is told, not overwritten.
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tenant.trip.id } });
    expect(trip.cargoName).toBe('Paxta');
  });

  it('approves an expense exactly once under two parallel approvals', async () => {
    const created = await request(server())
      .post('/api/v1/expenses')
      .set('authorization', auth())
      .set('idempotency-key', randomUUID())
      .send({
        category: 'FUEL',
        amount: '419780000',
        expenseDate: '2026-08-17T09:00:00Z',
        tripId: tenant.trip.id,
      })
      .expect(201);

    const id = created.body.data.id as string;
    const approve = () =>
      request(server())
        .post(`/api/v1/expenses/${id}/approve`)
        .set('authorization', auth())
        .set('idempotency-key', randomUUID())
        .send({});

    const [a, b] = await Promise.all([approve(), approve()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'Expense', entityId: id, action: 'APPROVE' },
    });
    // One approval is one event. Two rows would make the log a worse record
    // than no log, because it would show an approval that never happened.
    expect(audits).toHaveLength(1);
  });

  it('corrects a payment once when two corrections arrive together', async () => {
    const created = await request(server())
      .post('/api/v1/incomes')
      .set('authorization', auth())
      .set('idempotency-key', randomUUID())
      .send({ amount: '40000000', clientId: tenant.client.id, tripId: tenant.trip.id })
      .expect(201);

    const id = created.body.data.id as string;
    const correct = (amount: string) =>
      request(server())
        .patch(`/api/v1/incomes/${id}`)
        .set('authorization', auth())
        .send({ amount });

    const [a, b] = await Promise.all([correct('50000000'), correct('60000000')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const entries = await prisma.ledgerEntry.findMany({
      where: { incomeId: id },
      orderBy: { createdAt: 'asc' },
    });
    const live = entries.filter((e) => e.reason === 'PAYMENT_RECEIVED' && !e.reversedByEntryId);
    // Exactly one payment stands for this income, whichever correction won.
    expect(live).toHaveLength(1);

    const income = await prisma.income.findUniqueOrThrow({ where: { id } });
    expect(live[0]!.amountBase).toBe(income.amount);
    expect(income.version).toBe(1);
  });
});
