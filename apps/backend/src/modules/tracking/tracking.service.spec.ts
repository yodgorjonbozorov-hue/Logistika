import { ACTOR, createDriversStub, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { TrackingService } from './tracking.service';

const DRIVER_ACTOR = { ...ACTOR, role: 'DRIVER' } as typeof ACTOR;

describe('TrackingService.ingestPositions', () => {
  function setup() {
    const { prisma, db } = createTenantDbMock(['trip', 'gpsTrack']);
    db.gpsTrack!.createMany = jest.fn().mockResolvedValue({ count: 0 });
    const service = new TrackingService(prisma, createDriversStub({ id: 'd1' }));
    return { service, db };
  }

  const point = (tripId: string) => ({
    tripId,
    lat: 40.1,
    lng: 67.8,
    speed: 72,
    recordedAt: '2026-08-06T10:00:00Z',
  });

  it('resolves vehicleId from the trip and stores accepted points', async () => {
    const { service, db } = setup();
    db.trip!.findMany!.mockResolvedValue([{ id: 'trip-1', vehicleId: 'v1' }]);

    const result = await service.ingestPositions(DRIVER_ACTOR, {
      positions: [point('trip-1'), point('trip-1')],
    });

    expect(result).toEqual({ accepted: 2, dropped: 0 });
    const rows = (db.gpsTrack!.createMany as jest.Mock).mock.calls[0][0].data;
    expect(rows[0].vehicleId).toBe('v1');
    expect(rows[0].companyId).toBe('company-a');
    expect(rows[0].recordedAt).toBeInstanceOf(Date);
  });

  it("drops points for trips that are not this driver's", async () => {
    const { service, db } = setup();
    db.trip!.findMany!.mockResolvedValue([]); // tenant/driver scope filters it out

    const result = await service.ingestPositions(DRIVER_ACTOR, {
      positions: [point('foreign-trip')],
    });

    expect(result).toEqual({ accepted: 0, dropped: 1 });
    expect(db.gpsTrack!.createMany).not.toHaveBeenCalled();
  });
});
