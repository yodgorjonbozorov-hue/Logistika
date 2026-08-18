/**
 * Trip outcomes (TASK-3.4).
 *
 * TRANSITIONS.IN_PROGRESS was ['COMPLETED'], so a trip that broke down or was
 * refused by the client could only be recorded as delivered — which invoiced
 * the client for work that never happened and made the financial report wrong
 * in the one direction nobody checks.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

const REASON = 'Mijoz yukni qabul qilmadi, ombor yopiq edi';

describe('Trip outcomes (e2e)', () => {
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
    tenant = await createTenant(app, 'Outcome');
    await request(app.getHttpServer())
      .post(`/api/v1/trips/${tenant.trip.id}/start`)
      .set('authorization', `Bearer ${tenant.tokens.owner}`)
      .send({})
      .expect(200);
  });

  const finish = (body: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/trips/${tenant.trip.id}/finish`)
      .set('authorization', `Bearer ${tenant.tokens.owner}`)
      .set('idempotency-key', randomUUID())
      .send(body);

  const invoiced = async () => {
    const entries = await prisma.ledgerEntry.findMany({
      where: { tripId: tenant.trip.id, reason: 'TRIP_INVOICED' },
    });
    return entries.reduce((sum, entry) => sum + entry.amountBase, 0n);
  };

  it('a returned trip is not invoiced at all', async () => {
    const res = await finish({ status: 'RETURNED', reason: REASON });
    expect(res.status).toBe(200);

    const trip = await prisma.trip.findUnique({ where: { id: tenant.trip.id } });
    expect(trip?.status).toBe('RETURNED');
    expect(trip?.statusReason).toBe(REASON);
    expect(trip?.statusChangedAt).not.toBeNull();

    // The costs already booked stay as a loss; charging the client would be
    // inventing revenue.
    expect(await invoiced()).toBe(0n);
  });

  it('a failed trip is not invoiced either', async () => {
    await finish({ status: 'FAILED', reason: "Yo'lda avariya, yuk shikastlandi" }).expect(200);

    expect((await prisma.trip.findUnique({ where: { id: tenant.trip.id } }))?.status).toBe(
      'FAILED',
    );
    expect(await invoiced()).toBe(0n);
  });

  it('a partial delivery invoices only what arrived', async () => {
    const delivered = tenant.trip.agreedPrice / 4n;

    await finish({
      status: 'PARTIALLY_DELIVERED',
      reason: 'Yukning chorak qismi yetkazildi, qolgani qaytdi',
      deliveredAmount: delivered.toString(),
    }).expect(200);

    expect(await invoiced()).toBe(delivered);
    const trip = await prisma.trip.findUnique({ where: { id: tenant.trip.id } });
    expect(trip?.deliveredAmount).toBe(delivered);
  });

  it('refuses a partial delivery worth more than the agreed price', async () => {
    const res = await finish({
      status: 'PARTIALLY_DELIVERED',
      reason: "Kelishuvdan ko'p yuk yetkazildi",
      deliveredAmount: (tenant.trip.agreedPrice + 1n).toString(),
    });

    expect(res.status).toBe(400);
    expect(await invoiced()).toBe(0n);
  });

  it('requires the delivered amount for a partial delivery', async () => {
    const res = await finish({ status: 'PARTIALLY_DELIVERED', reason: REASON });
    expect(res.status).toBe(400);
  });

  it('demands a real explanation, not a character', async () => {
    const res = await finish({ status: 'FAILED', reason: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    // Still running: a rejected explanation must not half-apply the outcome.
    expect((await prisma.trip.findUnique({ where: { id: tenant.trip.id } }))?.status).toBe(
      'IN_PROGRESS',
    );
  });

  it('records an advance to recover when a trip is cancelled mid-route', async () => {
    await prisma.trip.update({
      where: { id: tenant.trip.id },
      data: { driverAdvance: 10_000_000n },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/trips/${tenant.trip.id}/cancel`)
      .set('authorization', `Bearer ${tenant.tokens.owner}`)
      .expect(200);

    const advance = await prisma.ledgerEntry.findFirst({
      where: { tripId: tenant.trip.id, reason: 'DRIVER_ADVANCE' },
    });
    // Money already handed to the driver does not evaporate with the trip.
    expect(advance?.amountBase).toBe(10_000_000n);
    expect(await invoiced()).toBe(0n);
  });

  it('a finished trip is terminal', async () => {
    await finish({ status: 'RETURNED', reason: REASON }).expect(200);

    const again = await finish({ status: 'FAILED', reason: "Fikrimizni o'zgartirdik" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TRIP_INVALID_STATUS');
  });

  it('a completed trip still invoices the whole agreed price', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/trips/${tenant.trip.id}/complete`)
      .set('authorization', `Bearer ${tenant.tokens.owner}`)
      .set('idempotency-key', randomUUID())
      .send({})
      .expect(200);

    expect(await invoiced()).toBe(tenant.trip.agreedPrice);
  });

  it('only the office may end a trip this way', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/trips/${tenant.trip.id}/finish`)
      .set('authorization', `Bearer ${tenant.tokens.driver}`)
      .set('idempotency-key', randomUUID())
      .send({ status: 'FAILED', reason: REASON });
    expect(res.status).toBe(403);
  });
});
