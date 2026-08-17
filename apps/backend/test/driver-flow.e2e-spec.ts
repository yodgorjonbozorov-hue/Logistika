/**
 * The core loop the whole product rests on (TASK-1.4): the driver presses a
 * button in the app and the trip, the live map and the finished-trip numbers
 * all follow. Before this test existed the chain was broken at the first link.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Driver event flow (e2e)', () => {
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
    tenant = await createTenant(app, 'Flow');
  });

  const api = () => request(app.getHttpServer());

  const batch = (events: Array<Record<string, unknown>>) =>
    api()
      .post('/api/v1/events/batch')
      .set('authorization', `Bearer ${tenant.tokens.driver}`)
      .send({ events });

  const event = (eventType: string, extra: Record<string, unknown> = {}) => ({
    clientEventId: randomUUID(),
    tripId: tenant.trip.id,
    eventType,
    eventTime: new Date().toISOString(),
    ...extra,
  });

  it('START puts the assigned trip in progress and the live map reports MOVING', async () => {
    const res = await batch([event('START', { odometer: 411_500 })]);
    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toHaveLength(1);

    const trip = await prisma.trip.findUnique({ where: { id: tenant.trip.id } });
    expect(trip?.status).toBe('IN_PROGRESS');
    expect(trip?.startedAt).not.toBeNull();
    expect(trip?.startOdometer).toBe(411_500);

    const live = await api()
      .get('/api/v1/tracking/live')
      .set('authorization', `Bearer ${tenant.tokens.logist}`);
    expect(live.status).toBe(200);
    const vehicle = (live.body.data as Array<{ vehicleId: string; status: string }>).find(
      (row) => row.vehicleId === tenant.vehicle.id,
    );
    expect(vehicle?.status).toBe('MOVING');
  });

  it('FINISH completes the trip and fills in the numbers the P&L needs', async () => {
    await batch([event('START', { odometer: 411_500 })]);
    const res = await batch([event('FINISH', { odometer: 411_818 })]);
    expect(res.body.data.accepted).toHaveLength(1);

    const trip = await prisma.trip.findUnique({ where: { id: tenant.trip.id } });
    expect(trip?.status).toBe('COMPLETED');
    expect(trip?.finishedAt).not.toBeNull();
    expect(trip?.endOdometer).toBe(411_818);
    expect(trip?.actualDistanceKm?.toString()).toBe('318');
  });

  it('a status change made by an event is audited', async () => {
    await batch([event('START')]);
    const entries = await prisma.auditLog.findMany({
      where: { entityType: 'Trip', entityId: tenant.trip.id, action: 'STATUS_CHANGE' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.after).toMatchObject({ status: 'IN_PROGRESS', via: 'START' });
  });

  it('FINISH before START is rejected and the rest of the batch still lands', async () => {
    const finish = event('FINISH');
    const refuel = event('REFUEL');
    const res = await batch([finish, refuel]);

    expect(res.body.data.rejected).toEqual([
      { clientEventId: finish.clientEventId, code: 'TRIP_INVALID_STATUS' },
    ]);
    expect(res.body.data.accepted).toEqual([refuel.clientEventId]);

    const trip = await prisma.trip.findUnique({ where: { id: tenant.trip.id } });
    expect(trip?.status).toBe('ASSIGNED');
    const stored = await prisma.tripEvent.findMany({ where: { tripId: tenant.trip.id } });
    expect(stored.map((e) => e.eventType)).toEqual(['REFUEL']);
  });

  it('a driver can open their own trip but not a colleague trip', async () => {
    const mine = await api()
      .get(`/api/v1/trips/${tenant.trip.id}`)
      .set('authorization', `Bearer ${tenant.tokens.driver}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.id).toBe(tenant.trip.id);

    const colleague = await prisma.driver.create({
      data: { companyId: tenant.company.id, fullName: 'Colleague' },
    });
    const otherTrip = await prisma.trip.create({
      data: {
        companyId: tenant.company.id,
        tripNumber: `TR-OTHER-${randomUUID().slice(0, 6)}`,
        driverId: colleague.id,
        status: 'ASSIGNED',
      },
    });

    const res = await api()
      .get(`/api/v1/trips/${otherTrip.id}`)
      .set('authorization', `Bearer ${tenant.tokens.driver}`);
    expect(res.status).toBe(404);
  });
});
