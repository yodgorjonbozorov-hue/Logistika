import type { AuditService } from '../audit/audit.service';
import { ACTOR, createDriversStub, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { TripsService } from './trips.service';

describe('TripsService', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  function setup() {
    const { prisma, db, $queryRaw } = createTenantDbMock(['trip', 'vehicle', 'driver', 'client']);
    // The trip-number allocator is a single atomic UPDATE ... RETURNING (H-6).
    $queryRaw.mockResolvedValue([{ next_trip_number: 42 }]);
    // Status changes go through updateManyAndReturn with the observed status
    // in the WHERE clause (H-5); by default the caller wins the race.
    db.trip!.updateManyAndReturn!.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve([{ id: 't1', ...data }]),
    );
    const service = new TripsService(prisma, audit, createDriversStub());
    return { service, db, $queryRaw };
  }

  describe('create', () => {
    it('assigns a per-company sequential number and converts money to BigInt', async () => {
      const { service, db } = setup();
      db.trip!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 't1', ...data }),
      );

      await service.create(ACTOR, { agreedPrice: '1250000000' });

      const data = db.trip!.create!.mock.calls[0][0].data;
      expect(data.tripNumber).toBe('42');
      expect(data.status).toBe('DRAFT');
      expect(data.agreedPrice).toBe(1_250_000_000n);
      expect(data.createdById).toBe('user-1');
    });

    it('starts as ASSIGNED when vehicle and driver are given and they exist in the tenant', async () => {
      const { service, db } = setup();
      db.vehicle!.findUnique!.mockResolvedValue({ id: 'v1' });
      db.driver!.findUnique!.mockResolvedValue({ id: 'd1' });
      db.trip!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 't1', ...data }),
      );

      await service.create(ACTOR, { vehicleId: 'v1', driverId: 'd1' });
      expect(db.trip!.create!.mock.calls[0][0].data.status).toBe('ASSIGNED');
    });

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

      const data = db.trip!.updateManyAndReturn!.mock.calls[0][0].data;
      expect(data.status).toBe('IN_PROGRESS');
      expect(data.startedAt).toBeInstanceOf(Date);
      expect(data.startOdometer).toBe(100_000);
    });

    it('computes actualDistanceKm from odometers on completion', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({
        id: 't1',
        status: 'IN_PROGRESS',
        startOdometer: 100_000,
      });

      await service.complete(ACTOR, 't1', { endOdometer: 101_240 });

      const data = db.trip!.updateManyAndReturn!.mock.calls[0][0].data;
      expect(data.status).toBe('COMPLETED');
      expect(String(data.actualDistanceKm)).toBe('1240');
    });

    it.each([
      ['DRAFT', 'complete'],
      ['COMPLETED', 'start'],
      ['CANCELLED', 'start'],
      ['IN_PROGRESS', 'cancel'],
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

  describe('production hardening', () => {
    it('allocates the trip number atomically instead of count() + 1 (H-6)', async () => {
      const { service, db, $queryRaw } = setup();
      db.trip!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 't1', ...data }),
      );

      await service.create(ACTOR, {});

      expect($queryRaw).toHaveBeenCalledTimes(1);
      expect(db.trip!.count).not.toHaveBeenCalled();
      expect(db.trip!.create!.mock.calls[0][0].data.tripNumber).toBe('42');
    });

    it('refuses an end odometer below the start odometer (H-4)', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({
        id: 't1',
        status: 'IN_PROGRESS',
        startOdometer: 1000,
      });

      await expect(service.complete(ACTOR, 't1', { endOdometer: 500 })).rejects.toMatchObject({
        code: 'ODOMETER_INVALID',
      });
      expect(db.trip!.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it('guards the status transition with the observed status (H-5)', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS' });

      await service.complete(ACTOR, 't1', {});

      expect(db.trip!.updateManyAndReturn!.mock.calls[0][0].where).toMatchObject({
        id: 't1',
        status: 'IN_PROGRESS',
      });
    });

    it('loses the race gracefully when another request already moved the trip (H-5)', async () => {
      const { service, db } = setup();
      db.trip!.findUnique!.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS' });
      db.trip!.updateManyAndReturn!.mockResolvedValue([]); // 0 rows: somebody won

      await expect(service.complete(ACTOR, 't1', {})).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });
});
