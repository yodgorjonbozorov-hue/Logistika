import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { TripsService } from './trips.service';

describe('TripsService', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  function setup() {
    const { prisma, db } = createTenantDbMock(['trip', 'vehicle', 'driver', 'client']);
    const service = new TripsService(prisma, audit);
    return { service, db };
  }

  describe('create', () => {
    it('assigns a per-company sequential number and converts money to BigInt', async () => {
      const { service, db } = setup();
      db.trip!.count!.mockResolvedValue(41);
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
      db.trip!.count!.mockResolvedValue(0);
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
      db.trip!.update!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 't1', ...data }),
      );

      await service.start(ACTOR, 't1', { startOdometer: 100_000 });

      const data = db.trip!.update!.mock.calls[0][0].data;
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
      db.trip!.update!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 't1', ...data }),
      );

      await service.complete(ACTOR, 't1', { endOdometer: 101_240 });

      const data = db.trip!.update!.mock.calls[0][0].data;
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
});
