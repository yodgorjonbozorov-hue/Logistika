/**
 * Odometer readings and value constraints (TASK-3.6, DB-4).
 *
 * Two layers are checked here on purpose:
 *
 *  1. the API refuses a backwards odometer with a message a driver can act on;
 *  2. the database refuses it too, so a seed script, an import job or a manual
 *     UPDATE during an incident cannot put a negative distance — or negative
 *     money — into a table that reports are built from.
 *
 * The second layer is the one that matters in a year: application checks are
 * added and forgotten, a CHECK constraint is not.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Value constraints (e2e)', () => {
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
    tenant = await createTenant(app, 'Constraint');
    await request(app.getHttpServer())
      .post(`/api/v1/trips/${tenant.trip.id}/start`)
      .set('authorization', `Bearer ${tenant.tokens.owner}`)
      .send({ startOdometer: 411_500 })
      .expect(200);
  });

  const owner = () => `Bearer ${tenant.tokens.owner}`;

  describe('the API', () => {
    it('refuses a completion whose odometer went backwards', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/trips/${tenant.trip.id}/complete`)
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({ endOdometer: 411_158 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ODOMETER_INVALID');
      // Both numbers are in the message: the driver has to know which two
      // readings disagree, not just that something was invalid.
      expect(res.body.error.message).toContain('411500');
      expect(res.body.error.message).toContain('411158');

      const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tenant.trip.id } });
      expect(trip.status).toBe('IN_PROGRESS');
      expect(trip.actualDistanceKm).toBeNull();
    });

    it('records the distance when the reading is in order', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/trips/${tenant.trip.id}/complete`)
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({ endOdometer: 411_818 })
        .expect(200);

      const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tenant.trip.id } });
      expect(String(trip.actualDistanceKm)).toBe('318');
    });

    it('rejects the driver batch event too, and stores nothing', async () => {
      const clientEventId = randomUUID();
      const res = await request(app.getHttpServer())
        .post('/api/v1/events/batch')
        .set('authorization', `Bearer ${tenant.tokens.driver}`)
        .send({
          events: [
            {
              clientEventId,
              tripId: tenant.trip.id,
              eventType: 'FINISH',
              eventTime: '2026-08-17T10:00:00Z',
              odometer: 411_158,
            },
          ],
        })
        .expect(200);

      expect(res.body.data.rejected).toEqual([{ clientEventId, code: 'ODOMETER_INVALID' }]);
      expect(await prisma.tripEvent.count({ where: { clientEventId } })).toBe(0);
      const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tenant.trip.id } });
      expect(trip.status).toBe('IN_PROGRESS');
    });

    it('lets a trip finish when the reading is simply missing', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/trips/${tenant.trip.id}/complete`)
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(200);

      const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tenant.trip.id } });
      // Unknown is not wrong: refusing this would block the finish over data
      // nobody promised to collect.
      expect(trip.status).toBe('COMPLETED');
      expect(trip.actualDistanceKm).toBeNull();
    });
  });

  describe('the database, when the application is bypassed entirely', () => {
    const violates = (promise: Promise<unknown>) =>
      expect(promise).rejects.toThrow(/violates check constraint/i);

    it('refuses a backwards odometer', async () => {
      await violates(
        prisma.trip.update({
          where: { id: tenant.trip.id },
          data: { endOdometer: 411_158 },
        }),
      );
    });

    it('refuses a negative distance', async () => {
      await violates(
        prisma.trip.update({
          where: { id: tenant.trip.id },
          data: { actualDistanceKm: -342 },
        }),
      );
    });

    it('refuses negative money on a trip', async () => {
      await violates(
        prisma.trip.update({ where: { id: tenant.trip.id }, data: { agreedPrice: -1n } }),
      );
      await violates(
        prisma.trip.update({ where: { id: tenant.trip.id }, data: { driverAdvance: -1n } }),
      );
    });

    it('refuses a partial delivery worth more than the whole job', async () => {
      await violates(
        prisma.trip.update({
          where: { id: tenant.trip.id },
          data: { deliveredAmount: tenant.trip.agreedPrice + 1n },
        }),
      );
    });

    it('refuses a negative expense', async () => {
      await violates(
        prisma.expense.create({
          data: {
            companyId: tenant.company.id,
            category: 'FUEL',
            amount: -1n,
            amountBase: -1n,
            expenseDate: new Date(),
          },
        }),
      );
    });

    it('refuses a negative income', async () => {
      await violates(
        prisma.income.create({
          data: { companyId: tenant.company.id, amount: -1n, amountBase: -1n },
        }),
      );
    });

    it('refuses a refuelling of zero litres', async () => {
      // Not a refuelling — a row that divides a fuel norm by nothing.
      await violates(
        prisma.fuelLog.create({
          data: {
            companyId: tenant.company.id,
            vehicleId: tenant.vehicle.id,
            liters: 0,
            refuelTime: new Date(),
          },
        }),
      );
    });

    it('refuses a negative ledger amount', async () => {
      // Direction carries the sign. A negative CREDIT and a positive DEBIT
      // would mean the same thing and the balance would be unreadable.
      await violates(
        prisma.ledgerEntry.create({
          data: {
            companyId: tenant.company.id,
            clientId: tenant.client.id,
            direction: 'DEBIT',
            reason: 'ADJUSTMENT',
            amount: -1n,
            amountBase: -1n,
            currency: 'UZS',
          },
        }),
      );
    });

    it('refuses a zero or negative exchange rate', async () => {
      await violates(
        prisma.exchangeRate.create({
          data: { currency: 'USD', date: new Date('2026-08-17'), rateToUzs: 0, source: 'test' },
        }),
      );
    });
  });
});
