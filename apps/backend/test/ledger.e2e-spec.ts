/**
 * Client debt (TASK-3.1).
 *
 * `Client.balance` was a column nothing ever wrote and `payment_terms_days` a
 * dead field, so the central question of a logistics business — "how much does
 * this client owe us?" — could not be answered at all.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

const som = (value: number): bigint => BigInt(value) * 100n;

describe('Client ledger (e2e)', () => {
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
    tenant = await createTenant(app, 'Ledger');
  });

  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  const completeTrip = () =>
    api()
      .post(`/api/v1/trips/${tenant.trip.id}/complete`)
      .set(as(tenant.tokens.owner))
      .send({});

  const pay = (amount: bigint) =>
    api()
      .post('/api/v1/incomes')
      .set(as(tenant.tokens.owner))
      .send({ amount: amount.toString(), clientId: tenant.client.id, tripId: tenant.trip.id });

  const balance = () =>
    api().get(`/api/v1/clients/${tenant.client.id}/balance`).set(as(tenant.tokens.owner));

  it('invoices the client when a trip completes', async () => {
    // The fixture trip is ASSIGNED with an agreed price of 1,000,000 so'm.
    await api()
      .post(`/api/v1/trips/${tenant.trip.id}/start`)
      .set(as(tenant.tokens.owner))
      .send({})
      .expect(200);
    await completeTrip().expect(200);

    const entries = await prisma.ledgerEntry.findMany({ where: { tripId: tenant.trip.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.direction).toBe('DEBIT');
    expect(entries[0]?.reason).toBe('TRIP_INVOICED');
    expect(entries[0]?.amount).toBe(tenant.trip.agreedPrice);

    const res = await balance();
    expect(res.status).toBe(200);
    expect(BigInt(res.body.data.debt)).toBe(tenant.trip.agreedPrice);
    // Negative balance means "owes us"; the API answers the plain question too.
    expect(BigInt(res.body.data.balance)).toBe(-tenant.trip.agreedPrice);
  });

  it('a payment reduces the debt', async () => {
    await api().post(`/api/v1/trips/${tenant.trip.id}/start`).set(as(tenant.tokens.owner)).send({});
    await completeTrip();

    await pay(som(400_000)).expect(201);

    const res = await balance();
    expect(BigInt(res.body.data.debt)).toBe(tenant.trip.agreedPrice - som(400_000));
  });

  it('an overpayment leaves the client in credit, not in negative debt', async () => {
    await api().post(`/api/v1/trips/${tenant.trip.id}/start`).set(as(tenant.tokens.owner)).send({});
    await completeTrip();

    await pay(tenant.trip.agreedPrice + som(100_000)).expect(201);

    const res = await balance();
    expect(BigInt(res.body.data.debt)).toBe(0n);
    expect(BigInt(res.body.data.balance)).toBe(som(100_000));
  });

  it('keeps the cached column and the entries in agreement', async () => {
    await api().post(`/api/v1/trips/${tenant.trip.id}/start`).set(as(tenant.tokens.owner)).send({});
    await completeTrip();
    await pay(som(250_000));

    const client = await prisma.client.findUnique({ where: { id: tenant.client.id } });
    const res = await balance();
    // The cache is only useful if it matches the arithmetic it summarises.
    expect(client?.balance).toBe(BigInt(res.body.data.balance));
  });

  it('invoices a trip once, whichever path completes it', async () => {
    await api().post(`/api/v1/trips/${tenant.trip.id}/start`).set(as(tenant.tokens.owner)).send({});
    await completeTrip().expect(200);
    // A second complete is refused by the status guard, and even if it were
    // not, the invoice must not be duplicated.
    await completeTrip();

    const entries = await prisma.ledgerEntry.findMany({
      where: { tripId: tenant.trip.id, reason: 'TRIP_INVOICED' },
    });
    expect(entries).toHaveLength(1);
  });

  it('invoices exactly once when the driver finishes the trip', async () => {
    const event = (eventType: string) => ({
      clientEventId: crypto.randomUUID(),
      tripId: tenant.trip.id,
      eventType,
      eventTime: new Date().toISOString(),
    });

    await api()
      .post('/api/v1/events/batch')
      .set(as(tenant.tokens.driver))
      .send({ events: [event('START')] })
      .expect(200);
    await api()
      .post('/api/v1/events/batch')
      .set(as(tenant.tokens.driver))
      .send({ events: [event('FINISH')] })
      .expect(200);

    const entries = await prisma.ledgerEntry.findMany({
      where: { tripId: tenant.trip.id, reason: 'TRIP_INVOICED' },
    });
    expect(entries).toHaveLength(1);
    expect(BigInt((await balance()).body.data.debt)).toBe(tenant.trip.agreedPrice);
  });

  it('reports overdue debt once the payment term has passed', async () => {
    await prisma.client.update({
      where: { id: tenant.client.id },
      data: { paymentTermsDays: 14 },
    });
    await api().post(`/api/v1/trips/${tenant.trip.id}/start`).set(as(tenant.tokens.owner)).send({});
    await completeTrip();

    expect(BigInt((await balance()).body.data.overdue)).toBe(0n);

    // Age the invoice past its term.
    await prisma.$executeRawUnsafe(
      `UPDATE ledger_entries SET created_at = now() - interval '30 days' WHERE trip_id = '${tenant.trip.id}'`,
    );
    const res = await balance();
    expect(BigInt(res.body.data.overdue)).toBe(tenant.trip.agreedPrice);
  });

  it('lists the entries newest first', async () => {
    await api().post(`/api/v1/trips/${tenant.trip.id}/start`).set(as(tenant.tokens.owner)).send({});
    await completeTrip();
    await pay(som(100_000));

    const res = await api()
      .get(`/api/v1/clients/${tenant.client.id}/ledger`)
      .set(as(tenant.tokens.owner));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].reason).toBe('PAYMENT_RECEIVED');
    expect(res.body.data[1].reason).toBe('TRIP_INVOICED');
    expect(res.body.meta.pagination.total).toBe(2);
  });

  it('never shows another company ledger', async () => {
    const other = await createTenant(app, 'Other');
    const res = await api()
      .get(`/api/v1/clients/${other.client.id}/ledger`)
      .set(as(tenant.tokens.owner));
    expect(res.status).toBe(404);

    const balanceRes = await api()
      .get(`/api/v1/clients/${other.client.id}/balance`)
      .set(as(tenant.tokens.owner));
    expect(balanceRes.status).toBe(404);
  });

  it('refuses to let anyone delete an entry from the ledger', async () => {
    await api().post(`/api/v1/trips/${tenant.trip.id}/start`).set(as(tenant.tokens.owner)).send({});
    await completeTrip();
    const [entry] = await prisma.ledgerEntry.findMany({ where: { tripId: tenant.trip.id } });

    // Money history is corrected with a reversal, never by removing a row.
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE id = '${entry!.id}'`),
    ).rejects.toThrow(/append-only/);

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE ledger_entries SET amount = 1 WHERE id = '${entry!.id}'`,
      ),
    ).rejects.toThrow(/append-only/);
  });
});
