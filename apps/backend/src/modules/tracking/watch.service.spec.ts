import { AlertType, LiveStatus } from 'shared';
import { createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { WatchService } from './watch.service';

const NOW = new Date('2026-08-16T12:00:00Z');
const PARKED = { lat: 41.3111, lng: 69.2797 };

function trail(vehicleId: string, minutes: number) {
  const points = [];
  for (let ago = minutes; ago >= 0; ago -= 3) {
    points.push({
      vehicleId,
      lat: PARKED.lat,
      lng: PARKED.lng,
      recordedAt: new Date(NOW.getTime() - ago * 60_000),
    });
  }
  return points;
}

const MOVING = {
  vehicleId: 'v1',
  plateNumber: '01 A 123 AA',
  status: LiveStatus.MOVING,
  trip: { id: 't1', tripNumber: 'R-014', cargoName: 'Paxta' },
  driverName: 'Alisher',
  lastPosition: { ...PARKED, speed: 0, recordedAt: NOW },
  deviationKm: 2.4,
};

function setup(options: { live?: unknown[]; points?: unknown[] } = {}) {
  const { prisma, db, forCompany } = createTenantDbMock(['gpsTrack']);
  (prisma as unknown as { company: Record<string, jest.Mock> }).company = {
    findMany: jest.fn().mockResolvedValue([{ id: 'company-a' }]),
  };
  db.gpsTrack!.findMany!.mockResolvedValue(options.points ?? trail('v1', 150));

  const tracking = { live: jest.fn().mockResolvedValue(options.live ?? [MOVING]) };
  const settings = {
    thresholds: jest.fn().mockResolvedValue({ idleAlertHours: 2, routeDeviationKm: 20 }),
  };
  const alerts = { raise: jest.fn().mockResolvedValue({ id: 'n1' }) };

  const service = new WatchService(prisma, tracking as never, settings as never, alerts as never);
  return { service, db, prisma, forCompany, tracking, alerts, settings };
}

function raisedTypes(alerts: { raise: jest.Mock }): string[] {
  return alerts.raise.mock.calls.map((call) => (call[1] as { type: string }).type);
}

describe('WatchService.watch', () => {
  it('raises the idle alert for a truck that stopped without saying so', async () => {
    const { service, alerts } = setup();

    expect(await service.watch('company-a', NOW)).toBe(1);
    expect(raisedTypes(alerts)).toEqual([AlertType.VEHICLE_IDLE]);
    expect(alerts.raise.mock.calls[0][1]).toMatchObject({
      messageKey: 'alerts.vehicleIdle.message',
      relatedId: 'v1',
      params: { plate: '01 A 123 AA', hours: 2, tripNumber: 'R-014' },
    });
  });

  it('says nothing about a driver who pressed «rest»', async () => {
    const { service, alerts } = setup({ live: [{ ...MOVING, status: LiveStatus.RESTING }] });
    expect(await service.watch('company-a', NOW)).toBe(0);
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('says nothing about a vehicle with no trip', async () => {
    const { service, alerts, tracking } = setup({
      live: [{ ...MOVING, trip: null, status: LiveStatus.IDLE }],
    });
    expect(await service.watch('company-a', NOW)).toBe(0);
    expect(tracking.live).toHaveBeenCalled();
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('raises the deviation alert past the company limit, with the same km the map shows', async () => {
    const { service, alerts } = setup({
      live: [{ ...MOVING, deviationKm: 45.2 }],
      points: trail('v1', 30), // moving, so no idle alert
    });

    await service.watch('company-a', NOW);

    expect(raisedTypes(alerts)).toEqual([AlertType.ROUTE_DEVIATION]);
    expect(alerts.raise.mock.calls[0][1]).toMatchObject({
      params: { deviationKm: '45.2', limitKm: 20 },
    });
  });

  it('counts only the alerts the centre actually accepted', async () => {
    const { service, alerts } = setup({ live: [{ ...MOVING, deviationKm: 45.2 }] });
    // The alerts centre returns null for a duplicate still unread.
    alerts.raise.mockResolvedValue(null);

    expect(await service.watch('company-a', NOW)).toBe(0);
    expect(alerts.raise).toHaveBeenCalledTimes(2); // idle and deviation both tried
  });

  it('reads the trail through the tenant-scoped client, for the watched vehicles only', async () => {
    const { service, db, forCompany } = setup({
      live: [MOVING, { ...MOVING, vehicleId: 'v2', trip: null, status: LiveStatus.IDLE }],
    });

    await service.watch('company-a', NOW);

    expect(forCompany).toHaveBeenCalledWith('company-a');
    expect(db.gpsTrack!.findMany!.mock.calls[0][0].where.vehicleId).toEqual({ in: ['v1'] });
  });
});

describe('WatchService.watchAllCompanies', () => {
  it('keeps going when one company fails', async () => {
    const { service, prisma, tracking, alerts } = setup();
    (prisma as unknown as { company: { findMany: jest.Mock } }).company.findMany.mockResolvedValue([
      { id: 'company-a' },
      { id: 'company-b' },
    ]);
    tracking.live.mockRejectedValueOnce(new Error('map unavailable'));

    await service.watchAllCompanies(NOW);

    expect(alerts.raise).toHaveBeenCalledTimes(1);
  });
});
