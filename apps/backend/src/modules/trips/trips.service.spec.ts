import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { TripsService } from './trips.service';

/** UZS passes through unchanged; conversion itself is tested in currency.service.spec.ts. */
const currencyStub = {
  toBase: jest.fn((amount: bigint) =>
    Promise.resolve({ amountBase: amount, rateUsed: null, rateDate: null }),
  ),
} as unknown as import('../currency/currency.service').CurrencyService;

/** The ledger is exercised for real in ledger.service.spec.ts and the e2e suite. */
const ledgerStub = {
  record: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
  reverse: jest.fn(),
} as unknown as import('../ledger/ledger.service').LedgerService;

describe('TripsService', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  function setup() {
    const { prisma, db } = createTenantDbMock([
      'trip',
      'vehicle',
      'driver',
      'client',
      'tripCounter',
    ]);
    // The counter hands out 42 unless a test says otherwise.
    db.tripCounter!.upsert!.mockResolvedValue({ lastNumber: 42 });
    const service = new TripsService(prisma, audit, ledgerStub, currencyStub);
    return { service, db };
  }

  describe('create', () => {
    it('assigns a per-company sequential number and converts money to BigInt', async () => {
      const { service, db } = setup();
      db.trip!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 't1', ...data }),
      );

      await service.create(ACTOR, { agreedPrice: '1250000000' });

      const data = db.trip!.create!.mock.calls[0][0].data;
      // Taken from the counter, never from count() — see trip-numbering.ts.
      expect(data.tripNumber).toMatch(/^TR-\d{4}-0042$/);
      expect(data.status).toBe('DRAFT');
      expect(data.agreedPrice).toBe(1_250_000_000n);
      expect(data.createdById).toBe('user-1');
    });

    it('starts as ASSIGNED when vehicle and driver are given and they exist in the tenant', async () => {
      const { service, db } = setup();
      db.vehicle!.findUnique!.mockResolvedValue({ id: 'v1', isActive: true });
      db.driver!.findUnique!.mockResolvedValue({ id: 'd1', isActive: true });
      db.trip!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 't1', ...data }),
      );

      await service.create(ACTOR, { vehicleId: 'v1', driverId: 'd1' });
      expect(db.trip!.create!.mock.calls[0][0].data.status).toBe('ASSIGNED');
    });

    it.each(['driver', 'vehicle', 'client'])(
      'refuses to put a new trip on a retired %s (TASK-3.11)',
      async (resource) => {
        const { service, db } = setup();
        for (const model of ['driver', 'vehicle', 'client']) {
          db[model]!.findUnique!.mockResolvedValue({ id: 'x', isActive: model !== resource });
        }

        // Retiring a record that can still be assigned is a flag, not a soft
        // delete: a driver who left would still turn up on tomorrow's run.
        await expect(
          service.create(ACTOR, { driverId: 'd1', vehicleId: 'v1', clientId: 'c1' }),
        ).rejects.toMatchObject({ code: 'RESOURCE_IN_USE', details: { reason: 'inactive' } });
        expect(db.trip!.create).not.toHaveBeenCalled();
      },
    );

    it('rejects references that do not exist inside the tenant (cross-company ids look missing)', async () => {
      const { service, db } = setup();
      db.vehicle!.findUnique!.mockResolvedValue(null); // company B vehicle → invisible
      await expect(
        service.create(ACTOR, { vehicleId: 'vehicle-of-company-b' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('lifecycle', () => {
    it('allows ASSIGNED → IN_PROGRESS and stamps startedAt', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({ id: 't1', status: 'ASSIGNED' });

      await service.start(ACTOR, 't1', { startOdometer: 100_000 });

      const [{ where, data }] = db.trip!.updateMany!.mock.calls[0];
      // The status it expects to find is part of the WHERE clause, so a second
      // start racing this one matches nothing instead of re-stamping startedAt.
      expect(where).toMatchObject({ id: 't1', status: 'ASSIGNED' });
      expect(data.status).toBe('IN_PROGRESS');
      expect(data.startedAt).toBeInstanceOf(Date);
      expect(data.startOdometer).toBe(100_000);
      expect(data.version).toEqual({ increment: 1 });
    });

    it('computes actualDistanceKm from odometers on completion', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({
        id: 't1',
        status: 'IN_PROGRESS',
        startOdometer: 100_000,
      });

      await service.complete(ACTOR, 't1', { endOdometer: 101_240 });

      const data = db.trip!.updateMany!.mock.calls[0][0].data;
      expect(data.status).toBe('COMPLETED');
      expect(String(data.actualDistanceKm)).toBe('1240');
    });

    // IN_PROGRESS → CANCELLED is deliberately allowed now (TASK-3.4): a trip
    // that breaks down mid-route has to be able to end as something other than
    // "delivered".
    it.each([
      ['DRAFT', 'complete'],
      ['COMPLETED', 'start'],
      ['CANCELLED', 'start'],
      ['COMPLETED', 'cancel'],
    ] as const)('rejects %s → %s', async (status, action) => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({ id: 't1', status });
      const call =
        action === 'complete'
          ? service.complete(ACTOR, 't1', {})
          : action === 'start'
            ? service.start(ACTOR, 't1', {})
            : service.cancel(ACTOR, 't1');
      await expect(call).rejects.toMatchObject({ code: 'TRIP_INVALID_STATUS' });
    });

    it('blocks edits once the trip is underway', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS' });
      await expect(service.update(ACTOR, 't1', { cargoName: 'x' })).rejects.toMatchObject({
        code: 'TRIP_INVALID_STATUS',
      });
    });
  });

  describe('odometer (TASK-3.6)', () => {
    it('refuses a completion whose reading went backwards', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({
        id: 't1',
        status: 'IN_PROGRESS',
        startOdometer: 411_500,
      });

      // 411 518 typed as 411 158 used to be stored as a −342 km trip.
      await expect(service.complete(ACTOR, 't1', { endOdometer: 411_158 })).rejects.toMatchObject({
        code: 'ODOMETER_INVALID',
        httpStatus: 400,
      });
      expect(db.trip!.updateMany).not.toHaveBeenCalled();
    });

    it('accepts a completion that covered no kilometres', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({
        id: 't1',
        status: 'IN_PROGRESS',
        startOdometer: 411_500,
      });

      await service.complete(ACTOR, 't1', { endOdometer: 411_500 });

      // 0 km is a fact about a trip that stayed in the yard, not an error.
      expect(String(db.trip!.updateMany!.mock.calls[0][0].data.actualDistanceKm)).toBe('0');
    });

    it('completes without a distance when nobody wrote the reading down', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({
        id: 't1',
        status: 'IN_PROGRESS',
        startOdometer: null,
      });

      await service.complete(ACTOR, 't1', { endOdometer: 411_818 });

      expect(db.trip!.updateMany!.mock.calls[0][0].data.actualDistanceKm).toBeUndefined();
      expect(db.trip!.updateMany!.mock.calls[0][0].data.status).toBe('COMPLETED');
    });

    it('refuses a bad reading on finish too, not only on complete', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({
        id: 't1',
        status: 'IN_PROGRESS',
        startOdometer: 411_500,
        agreedPrice: 1_000_000n,
      });

      await expect(
        service.finish(ACTOR, 't1', {
          status: 'FAILED',
          reason: "Yo'lda avariya bo'ldi, yuk shikastlandi",
          endOdometer: 400_000,
        }),
      ).rejects.toMatchObject({ code: 'ODOMETER_INVALID' });
    });

    it('falls back to the reading already on the trip when finish omits one', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({
        id: 't1',
        status: 'IN_PROGRESS',
        startOdometer: 411_500,
        endOdometer: 411_700,
        agreedPrice: 1_000_000n,
      });

      await service.finish(ACTOR, 't1', {
        status: 'RETURNED',
        reason: 'Mijoz yukni qabul qilmadi, ombor yopiq edi',
      });

      // A driver event may already have recorded it; the office finishing the
      // trip afterwards must not blank it out.
      const data = db.trip!.updateMany!.mock.calls[0][0].data;
      expect(data.endOdometer).toBe(411_700);
      expect(String(data.actualDistanceKm)).toBe('200');
    });

    it('refuses a partial delivery worth more than the agreed price', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({
        id: 't1',
        status: 'IN_PROGRESS',
        agreedPrice: 1_000_000n,
      });

      await expect(
        service.finish(ACTOR, 't1', {
          status: 'PARTIALLY_DELIVERED',
          reason: "Kelishuvdan ko'p yuk yetkazildi",
          deliveredAmount: '1000001',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(db.trip!.updateMany).not.toHaveBeenCalled();
    });

    it('records the distance a failed trip still covered', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({
        id: 't1',
        status: 'IN_PROGRESS',
        startOdometer: 411_500,
        agreedPrice: 1_000_000n,
      });

      await service.finish(ACTOR, 't1', {
        status: 'RETURNED',
        reason: 'Mijoz yukni qabul qilmadi, ombor yopiq edi',
        endOdometer: 411_800,
      });

      // The fuel it burned has to be measured against something; a trip that
      // ended badly still covered kilometres.
      expect(String(db.trip!.updateMany!.mock.calls[0][0].data.actualDistanceKm)).toBe('300');
    });
  });

  describe('optimistic locking (TASK-3.5)', () => {
    it('rejects a transition whose row moved between the read and the write', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS', version: 3 });
      // Somebody else completed it in the gap; the guarded write matches nothing.
      db.trip!.updateMany!.mockResolvedValue({ count: 0 });

      await expect(service.complete(ACTOR, 't1', {})).rejects.toMatchObject({
        code: 'TRIP_INVALID_STATUS',
        httpStatus: 409,
      });
    });

    it('never invoices a trip whose completion lost the race', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({
        id: 't1',
        status: 'IN_PROGRESS',
        version: 3,
        agreedPrice: 1_000_000n,
        clientId: 'c1',
      });
      db.trip!.updateMany!.mockResolvedValue({ count: 0 });

      await expect(service.complete(ACTOR, 't1', {})).rejects.toMatchObject({
        code: 'TRIP_INVALID_STATUS',
      });
      // The whole reason the guard is inside the transaction: the loser must
      // not bill the client a second time for the same delivery.
      expect(ledgerStub.record).not.toHaveBeenCalled();
    });

    it('refuses an edit that was written against an older version', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({ id: 't1', status: 'DRAFT', version: 7 });
      db.trip!.updateMany!.mockResolvedValue({ count: 0 });

      await expect(
        service.update(ACTOR, 't1', { cargoName: 'x', version: 5 }),
      ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', httpStatus: 409 });
    });

    it('lets an edit through when the client is looking at the current version', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({ id: 't1', status: 'DRAFT', version: 7 });

      await service.update(ACTOR, 't1', { cargoName: 'paxta', version: 7 });

      const [{ where, data }] = db.trip!.updateMany!.mock.calls[0];
      expect(where).toEqual({ id: 't1', version: 7 });
      expect(data.version).toEqual({ increment: 1 });
      // The lock token itself is not a column the caller gets to set.
      expect(data.cargoName).toBe('paxta');
    });
  });
});
