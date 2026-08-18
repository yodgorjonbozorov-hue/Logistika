/**
 * One trip at a time, and nothing retired while it is out (TASK-3.10).
 *
 * Two gaps, both of which quietly corrupted the numbers rather than failing:
 *
 *  - a second trip could be started on a truck that was already halfway to
 *    Bukhara. Both trips then collected the same GPS track, the same fuel and
 *    the same kilometres, and the per-trip profit of both was wrong;
 *  - a driver could be deactivated mid-route. `listMine` and
 *    `requireDriverProfile` filter on `isActive`, so the phone showed no trip
 *    and every event was refused — the rest of that run was never recorded.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Resource availability (e2e)', () => {
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
    tenant = await createTenant(app, 'Availability');
  });

  const owner = () => `Bearer ${tenant.tokens.owner}`;
  const server = () => app.getHttpServer();

  /** A second trip on the same truck and driver, ready to start. */
  const secondTrip = async () =>
    prisma.trip.create({
      data: {
        companyId: tenant.company.id,
        tripNumber: `TR-TEST-${randomUUID().slice(0, 6)}`,
        clientId: tenant.client.id,
        vehicleId: tenant.vehicle.id,
        driverId: tenant.driver.id,
        status: 'ASSIGNED',
        agreedPrice: 50_000_000n,
      },
    });

  const start = (tripId: string) =>
    request(server()).post(`/api/v1/trips/${tripId}/start`).set('authorization', owner()).send({});

  describe('a truck can only be on one trip', () => {
    it('refuses to start a second trip on the same vehicle and driver', async () => {
      await start(tenant.trip.id).expect(200);
      const second = await secondTrip();

      const res = await start(second.id);

      expect(res.status).toBe(409);
      expect(['DRIVER_BUSY', 'VEHICLE_BUSY']).toContain(res.body.error.code);
      // The blocking trip is named: "conflict" is not something a logist can act on.
      expect(res.body.error.message).toContain(tenant.trip.tripNumber);

      expect((await prisma.trip.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
        'ASSIGNED',
      );
    });

    it('lets exactly one of two simultaneous starts through', async () => {
      const second = await secondTrip();

      const [a, b] = await Promise.all([start(tenant.trip.id), start(second.id)]);

      // Both passed the code check; the partial unique index is what decides.
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const running = await prisma.trip.count({
        where: { companyId: tenant.company.id, status: 'IN_PROGRESS' },
      });
      expect(running).toBe(1);
    });

    it('frees the truck as soon as the first trip ends', async () => {
      await start(tenant.trip.id).expect(200);
      const second = await secondTrip();

      await request(server())
        .post(`/api/v1/trips/${tenant.trip.id}/complete`)
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(200);

      await start(second.id).expect(200);
    });

    it('still allows several trips to be planned on the same truck', async () => {
      // Scheduling tomorrow's run for the truck that is driving today is
      // ordinary planning, not double-booking.
      await start(tenant.trip.id).expect(200);
      const planned = await secondTrip();

      expect(planned.status).toBe('ASSIGNED');
      expect(
        await prisma.trip.count({ where: { vehicleId: tenant.vehicle.id, status: 'ASSIGNED' } }),
      ).toBe(1);
    });

    it('refuses the driver app the same way, without failing the batch', async () => {
      await start(tenant.trip.id).expect(200);
      const second = await secondTrip();
      const clientEventId = randomUUID();

      const res = await request(server())
        .post('/api/v1/events/batch')
        .set('authorization', `Bearer ${tenant.tokens.driver}`)
        .send({
          events: [
            {
              clientEventId,
              tripId: second.id,
              eventType: 'START',
              eventTime: new Date().toISOString(),
            },
          ],
        })
        .expect(200);

      expect(res.body.data.rejected).toHaveLength(1);
      expect(['DRIVER_BUSY', 'VEHICLE_BUSY']).toContain(res.body.data.rejected[0].code);
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
        'ASSIGNED',
      );
    });
  });

  describe('retiring a driver or a vehicle', () => {
    const deactivate = (resource: 'drivers' | 'vehicles', id: string) =>
      request(server()).delete(`/api/v1/${resource}/${id}`).set('authorization', owner());

    it('refuses while the driver is out on a trip', async () => {
      await start(tenant.trip.id).expect(200);

      const res = await deactivate('drivers', tenant.driver.id);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RESOURCE_IN_USE');
      expect(res.body.error.details.tripNumber).toBe(tenant.trip.tripNumber);
      expect(
        (await prisma.driver.findUniqueOrThrow({ where: { id: tenant.driver.id } })).isActive,
      ).toBe(true);
    });

    it('refuses while a trip is merely planned', async () => {
      // The fixture trip starts ASSIGNED: retiring the driver now would leave
      // a trip that can never start, with nothing saying so until it was due.
      expect((await deactivate('drivers', tenant.driver.id)).status).toBe(409);
      expect((await deactivate('vehicles', tenant.vehicle.id)).status).toBe(409);
    });

    it('allows it once every trip has finished', async () => {
      await start(tenant.trip.id).expect(200);
      await request(server())
        .post(`/api/v1/trips/${tenant.trip.id}/complete`)
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(200);

      await deactivate('drivers', tenant.driver.id).expect(200);
      await deactivate('vehicles', tenant.vehicle.id).expect(200);

      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: tenant.driver.id } });
      // Soft delete: the history stays.
      expect(driver.isActive).toBe(false);
      expect(await prisma.trip.count({ where: { driverId: tenant.driver.id } })).toBe(1);
    });

    it('keeps the driver able to report until they are retired', async () => {
      await start(tenant.trip.id).expect(200);
      await deactivate('drivers', tenant.driver.id).expect(409);

      const res = await request(server())
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
        })
        .expect(200);

      // The point of the refusal above: this receipt still reaches the office.
      expect(res.body.data.accepted).toHaveLength(1);
    });
  });
});
