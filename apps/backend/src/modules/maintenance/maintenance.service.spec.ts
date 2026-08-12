import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { MaintenanceService } from './maintenance.service';

describe('MaintenanceService', () => {
  function setup() {
    const mock = createTenantDbMock(['maintenance', 'vehicle']);
    const service = new MaintenanceService(mock.prisma);
    return { service, db: mock.db, forCompany: mock.forCompany };
  }

  it('rejects a record for a foreign vehicle (tenant isolation)', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue(null);
    await expect(
      service.create(ACTOR, { vehicleId: 'foreign', type: 'PLANNED_TO' as never }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stores cost as BigInt and rolls the vehicle odometer/next-TO forward', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue({ id: 'v-1', currentOdometer: 100_000 });
    db.maintenance!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'm-1', ...data }),
    );
    db.vehicle!.update!.mockResolvedValue({});

    await service.create(ACTOR, {
      vehicleId: 'v-1',
      type: 'PLANNED_TO' as never,
      cost: '150000000',
      odometer: 120_000,
      nextServiceOdometer: 135_000,
    });

    expect(db.maintenance!.create!.mock.calls[0][0].data.cost).toBe(150_000_000n);
    expect(db.vehicle!.update).toHaveBeenCalledWith({
      where: { id: 'v-1' },
      data: { nextServiceOdometer: 135_000, currentOdometer: 120_000 },
    });
  });

  it('never rolls the vehicle odometer backwards', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue({ id: 'v-1', currentOdometer: 200_000 });
    db.maintenance!.create!.mockResolvedValue({ id: 'm-1' });

    await service.create(ACTOR, {
      vehicleId: 'v-1',
      type: 'REPAIR' as never,
      odometer: 150_000, // stale reading
    });
    expect(db.vehicle!.update).not.toHaveBeenCalled();
  });

  describe('upcoming', () => {
    it('returns only vehicles within 1000 km of (or past) the service point', async () => {
      const { service, db } = setup();
      db.vehicle!.findMany!.mockResolvedValue([
        { id: 'v-due', plateNumber: 'DUE', currentOdometer: 99_500, nextServiceOdometer: 100_000 },
        {
          id: 'v-over',
          plateNumber: 'OVER',
          currentOdometer: 101_000,
          nextServiceOdometer: 100_000,
        },
        { id: 'v-far', plateNumber: 'FAR', currentOdometer: 50_000, nextServiceOdometer: 100_000 },
        {
          id: 'v-unknown',
          plateNumber: 'UNK',
          currentOdometer: null,
          nextServiceOdometer: 100_000,
        },
      ]);

      const rows = await service.upcoming(ACTOR);
      expect(rows.map((r) => r.plateNumber)).toEqual(['OVER', 'DUE']); // most urgent first
      expect(rows[0]!.kmRemaining).toBe(-1000);
      expect(rows[1]!.kmRemaining).toBe(500);
    });
  });
});
