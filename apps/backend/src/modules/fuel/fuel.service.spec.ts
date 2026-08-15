import { AlertType } from 'shared';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import type { AlertsService } from '../alerts/alerts.service';
import type { SettingsService } from '../companies/settings.service';
import { periodOf } from '../finance/dto/finance.dto';
import { completeFuelAmounts, FuelService } from './fuel.service';
import { ListFuelLogsDto } from './dto/fuel.dto';

const PERIOD = periodOf(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T23:59:59Z'));

function setup(thresholdBp = 700) {
  const { prisma, db, forCompany } = createTenantDbMock(['vehicle', 'trip', 'fuelLog']);
  const alerts = { raise: jest.fn(), raiseMany: jest.fn().mockResolvedValue(0) };
  const settings = {
    thresholds: jest.fn().mockResolvedValue({
      fuelDeviationThresholdBp: thresholdBp,
      idleAlertHours: 2,
      routeDeviationKm: 20,
      digestTime: '20:00',
    }),
  };
  const service = new FuelService(
    prisma,
    settings as unknown as SettingsService,
    alerts as unknown as AlertsService,
  );
  return { service, db, forCompany, alerts, settings };
}

/** TZ W-8 sample row: 1 240 km, norm 32 l/100 km, 452 l actually burnt. */
function w8Fixture(db: ReturnType<typeof setup>['db']) {
  db.vehicle!.findMany!.mockResolvedValue([
    { id: 'v1', plateNumber: '01 A 123 AA', fuelNormPer100km: '32.00' },
  ]);
  db.trip!.findMany!.mockResolvedValue([
    {
      vehicleId: 'v1',
      actualDistanceKm: '1240.0',
      plannedDistanceKm: null,
      startOdometer: null,
      endOdometer: null,
    },
  ]);
  db.fuelLog!.findMany!.mockResolvedValue([
    { vehicleId: 'v1', liters: '452.00', totalAmount: 406_800_000n, stationName: 'Uzbekneftegaz' },
  ]);
}

describe('completeFuelAmounts', () => {
  it('derives the total from litres × price', () => {
    expect(completeFuelAmounts({ liters: 50, pricePerLiter: 900_000n })).toEqual({
      totalAmount: 45_000_000n,
    });
  });

  it('derives the price from total ÷ litres', () => {
    expect(completeFuelAmounts({ liters: 50, totalAmount: 45_000_000n })).toEqual({
      pricePerLiter: 900_000n,
    });
  });

  it('keeps a receipt that already carries all three numbers', () => {
    expect(
      completeFuelAmounts({ liters: 50, pricePerLiter: 900_000n, totalAmount: 44_000_000n }),
    ).toEqual({});
  });

  it('derives nothing when there are no litres to divide by', () => {
    expect(completeFuelAmounts({ liters: 0, totalAmount: 1n })).toEqual({});
    expect(completeFuelAmounts({ totalAmount: 1n })).toEqual({});
  });
});

describe('FuelService.create', () => {
  it('refuses a vehicle from another tenant', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue(null);

    await expect(
      service.create(ACTOR, {
        vehicleId: 'vehicle-of-company-b',
        liters: 50,
        refuelTime: '2026-08-10T10:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.fuelLog!.create).not.toHaveBeenCalled();
  });

  it('stores money as BigInt and completes the missing amount', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue({ id: 'v1' });
    db.fuelLog!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'f1', ...data }),
    );

    await service.create(ACTOR, {
      vehicleId: 'v1',
      liters: 50,
      pricePerLiter: '900000',
      refuelTime: '2026-08-10T10:00:00Z',
    });

    const data = db.fuelLog!.create!.mock.calls[0][0].data;
    expect(data.pricePerLiter).toBe(900_000n);
    expect(data.totalAmount).toBe(45_000_000n);
    expect(data.refuelTime).toEqual(new Date('2026-08-10T10:00:00Z'));
  });
});

describe('FuelService.remove', () => {
  it('reports NOT_FOUND when the scoped delete matches nothing', async () => {
    const { service, db } = setup();
    db.fuelLog!.deleteMany!.mockResolvedValue({ count: 0 });

    await expect(service.remove(ACTOR, 'log-of-company-b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('FuelService.list', () => {
  it('defaults to the current month and filters by vehicle', async () => {
    const { service, db, forCompany } = setup();
    const filter = Object.assign(new ListFuelLogsDto(), { vehicleId: 'v1' });

    await service.list(ACTOR, filter);

    const where = db.fuelLog!.findMany!.mock.calls[0][0].where;
    expect(where.vehicleId).toBe('v1');
    expect(where.refuelTime.gte.getUTCDate()).toBe(1);
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });
});

describe('FuelService.control (W-8)', () => {
  it('reproduces the TZ W-8 row: 397 l norm vs 452 l actual', async () => {
    const { service, db } = setup();
    w8Fixture(db);

    const [row] = await service.control(ACTOR, PERIOD);

    expect(row!.distanceKm).toBe('1240.0');
    expect(row!.normLitres).toBe('396.80');
    expect(row!.actualLitres).toBe('452.00');
    expect(row!.deviationLitres).toBe('55.20');
    expect(row!.deviationBp).toBe(1391);
    expect(row!.avgPricePerLitre).toBe(900_000n);
    expect(row!.lossTiyin).toBe(49_680_000n);
    expect(row!.refuelCount).toBe(1);
    expect(row!.exceedsThreshold).toBe(true);
  });

  it('respects the company threshold instead of a hardcoded 7%', async () => {
    const { service, db } = setup(2000); // 20%
    w8Fixture(db);

    const [row] = await service.control(ACTOR, PERIOD);
    expect(row!.deviationBp).toBe(1391);
    expect(row!.exceedsThreshold).toBe(false);
  });

  it('lists a vehicle with no trips and no refuels without dividing by zero', async () => {
    const { service, db } = setup();
    db.vehicle!.findMany!.mockResolvedValue([
      { id: 'v2', plateNumber: '01 B 456 BB', fuelNormPer100km: null },
    ]);

    const [row] = await service.control(ACTOR, PERIOD);
    expect(row!.distanceKm).toBeNull();
    expect(row!.normLitres).toBe('0.00');
    expect(row!.deviationBp).toBeNull();
    expect(row!.lossTiyin).toBeNull();
    expect(row!.exceedsThreshold).toBe(false);
  });

  it('reads trips and refuels only inside the window and inside the tenant', async () => {
    const { service, db, forCompany } = setup();
    await service.control(ACTOR, PERIOD);

    expect(db.trip!.findMany!.mock.calls[0][0].where).toMatchObject({
      status: 'COMPLETED',
      finishedAt: { gte: PERIOD.fromDate, lte: PERIOD.toDate },
    });
    expect(db.fuelLog!.findMany!.mock.calls[0][0].where).toEqual({
      refuelTime: { gte: PERIOD.fromDate, lte: PERIOD.toDate },
    });
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });
});

describe('FuelService.stations', () => {
  it('aggregates per station and splits the overrun by litres sold', async () => {
    const { service, db } = setup();
    db.vehicle!.findMany!.mockResolvedValue([
      { id: 'v1', plateNumber: '01 A 123 AA', fuelNormPer100km: '32.00' },
    ]);
    db.trip!.findMany!.mockResolvedValue([
      {
        vehicleId: 'v1',
        actualDistanceKm: '1240.0',
        plannedDistanceKm: null,
        startOdometer: null,
        endOdometer: null,
      },
    ]);
    db.fuelLog!.findMany!.mockResolvedValue([
      { vehicleId: 'v1', liters: '339.00', totalAmount: 305_100_000n, stationName: 'AZS-1' },
      { vehicleId: 'v1', liters: '113.00', totalAmount: 101_700_000n, stationName: 'AZS-2' },
    ]);

    const rows = await service.stations(ACTOR, PERIOD);

    expect(rows.map((row) => row.stationName)).toEqual(['AZS-1', 'AZS-2']);
    expect(rows[0]!.litres).toBe('339.00');
    expect(rows[0]!.avgPricePerLitre).toBe(900_000n);
    // 55.20 l overrun split 75% / 25% by litres purchased
    expect(rows[0]!.attributedOverrunLitres).toBe('41.40');
    expect(rows[1]!.attributedOverrunLitres).toBe('13.80');
  });

  it('groups nameless receipts under a single bucket', async () => {
    const { service, db } = setup();
    db.fuelLog!.findMany!.mockResolvedValue([
      { vehicleId: 'v1', liters: '10.00', totalAmount: 9_000_000n, stationName: null },
      { vehicleId: 'v1', liters: '5.00', totalAmount: 4_500_000n, stationName: '  ' },
    ]);

    const rows = await service.stations(ACTOR, PERIOD);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stationName).toBe('—');
    expect(rows[0]!.refuelCount).toBe(2);
  });
});

describe('FuelService.checkThresholds', () => {
  it('raises one alert per vehicle over the threshold, with i18n params', async () => {
    const { service, db, alerts } = setup();
    w8Fixture(db);

    await service.checkThresholds('company-a');

    const raised = alerts.raiseMany.mock.calls[0][1];
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      type: AlertType.FUEL_OVERRUN,
      titleKey: 'alerts.fuelOverrun.title',
      relatedType: 'Vehicle',
      relatedId: 'v1',
    });
    expect(raised[0].params).toMatchObject({
      plate: '01 A 123 AA',
      litres: '55.20',
      percent: '13.9',
    });
  });

  it('stays quiet when every vehicle is inside the norm', async () => {
    const { service, db, alerts } = setup(2000);
    w8Fixture(db);

    await service.checkThresholds('company-a');
    expect(alerts.raiseMany.mock.calls[0][1]).toEqual([]);
  });
});
