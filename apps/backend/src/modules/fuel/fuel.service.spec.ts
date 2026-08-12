import type { AlertsService } from '../alerts/alerts.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { FuelService } from './fuel.service';

describe('FuelService', () => {
  const FROM = new Date('2026-08-01T00:00:00Z');
  const TO = new Date('2026-08-31T23:59:59Z');

  function setup() {
    const mock = createTenantDbMock(['fuelLog', 'vehicle', 'trip', 'aiSettings']);
    const alerts = { raise: jest.fn().mockResolvedValue(null) };
    const prisma = mock.prisma as unknown as Record<string, unknown>;
    prisma.company = { findMany: jest.fn().mockResolvedValue([{ id: 'company-a' }]) };
    const service = new FuelService(mock.prisma, alerts as unknown as AlertsService);
    return { service, db: mock.db, forCompany: mock.forCompany, alerts };
  }

  it('creates a log only for a vehicle of the same company', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue(null); // foreign vehicle → invisible
    await expect(
      service.create(ACTOR, {
        vehicleId: 'foreign-v',
        liters: 100,
        refuelTime: '2026-08-10T10:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stores money fields as BigInt tiyin', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue({ id: 'v-1' });
    db.fuelLog!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'f1', ...data }),
    );
    await service.create(ACTOR, {
      vehicleId: 'v-1',
      liters: 302.5,
      pricePerLiter: '1390000',
      totalAmount: '420475000',
      refuelTime: '2026-08-10T10:00:00Z',
    });
    const data = db.fuelLog!.create!.mock.calls[0][0].data;
    expect(data.pricePerLiter).toBe(1_390_000n);
    expect(data.totalAmount).toBe(420_475_000n);
    expect(data.refuelTime).toBeInstanceOf(Date);
  });

  describe('control (W-8 table)', () => {
    const vehicle = {
      id: 'v-1',
      plateNumber: '01 A 123 AA',
      fuelNormPer100km: 32,
    };

    it('computes the TZ example row: 1240 km, norm 32 → diff and loss', async () => {
      const { service, db } = setup();
      db.vehicle!.findMany!.mockResolvedValue([vehicle]);
      db.trip!.findMany!.mockResolvedValue([
        {
          vehicleId: 'v-1',
          actualDistanceKm: 1240,
          startOdometer: null,
          endOdometer: null,
          plannedDistanceKm: null,
        },
      ]);
      db.fuelLog!.findMany!.mockResolvedValue([
        { vehicleId: 'v-1', liters: 452, totalAmount: 452_000_000n, pricePerLiter: null },
      ]);
      db.aiSettings!.findFirst!.mockResolvedValue(null);

      const row = (await service.control(ACTOR, FROM, TO))[0]!;
      expect(row.distanceKm).toBe(1240);
      expect(row.normLiters).toBe(396.8);
      expect(row.actualLiters).toBe(452);
      expect(row.diffLiters).toBeCloseTo(55.2);
      expect(row.avgPricePerLiter).toBe(1_000_000n); // 10 000 so'm/l
      expect(row.lossAmount).toBe(55_200_000n); // 552 000 so'm
      expect(row.deviationPercent).toBe(13.91);
      expect(row.overThreshold).toBe(true); // default threshold 7%
    });

    it('respects the company threshold from ai_settings', async () => {
      const { service, db } = setup();
      db.vehicle!.findMany!.mockResolvedValue([vehicle]);
      db.trip!.findMany!.mockResolvedValue([
        {
          vehicleId: 'v-1',
          actualDistanceKm: 1240,
          startOdometer: null,
          endOdometer: null,
          plannedDistanceKm: null,
        },
      ]);
      db.fuelLog!.findMany!.mockResolvedValue([
        { vehicleId: 'v-1', liters: 452, totalAmount: null, pricePerLiter: null },
      ]);
      db.aiSettings!.findFirst!.mockResolvedValue({ fuelDeviationThreshold: 15 });

      const row = (await service.control(ACTOR, FROM, TO))[0]!;
      expect(row.deviationPercent).toBe(13.91);
      expect(row.overThreshold).toBe(false);
      expect(row.lossAmount).toBeNull(); // no price info in the period
    });

    it('yields neutral rows without norm or mileage (no false alarms)', async () => {
      const { service, db } = setup();
      db.vehicle!.findMany!.mockResolvedValue([
        { id: 'v-1', plateNumber: 'X', fuelNormPer100km: null },
      ]);
      db.trip!.findMany!.mockResolvedValue([]);
      db.fuelLog!.findMany!.mockResolvedValue([
        { vehicleId: 'v-1', liters: 100, totalAmount: null, pricePerLiter: null },
      ]);
      db.aiSettings!.findFirst!.mockResolvedValue(null);

      const row = (await service.control(ACTOR, FROM, TO))[0]!;
      expect(row.deviationPercent).toBeNull();
      expect(row.overThreshold).toBe(false);
    });
  });

  describe('byStation', () => {
    it('groups by station with weighted average price', async () => {
      const { service, db } = setup();
      db.fuelLog!.findMany!.mockResolvedValue([
        { stationName: 'Lukoil', liters: 100, totalAmount: 100_000_000n, pricePerLiter: null },
        { stationName: 'Lukoil', liters: 200, totalAmount: 240_000_000n, pricePerLiter: null },
        // No total — derived from price per liter: 50 l × 11 000 so'm.
        { stationName: 'UNG', liters: 50, totalAmount: null, pricePerLiter: 1_100_000n },
      ]);

      const rows = await service.byStation(ACTOR, FROM, TO);
      expect(rows).toHaveLength(2);
      const lukoil = rows.find((r) => r.stationName === 'Lukoil')!;
      expect(lukoil.refuelCount).toBe(2);
      expect(lukoil.liters).toBe(300);
      expect(lukoil.totalAmount).toBe(340_000_000n);
      expect(lukoil.avgPricePerLiter).toBe(1_133_333n); // 340/300 per l
      const ung = rows.find((r) => r.stationName === 'UNG')!;
      expect(ung.totalAmount).toBe(55_000_000n);
      expect(ung.avgPricePerLiter).toBe(1_100_000n);
    });
  });

  describe('checkDeviations cron', () => {
    it('raises a FUEL_DEVIATION alert only for over-threshold vehicles', async () => {
      const { service, db, alerts } = setup();
      db.vehicle!.findMany!.mockResolvedValue([
        { id: 'v-1', plateNumber: 'OVER', fuelNormPer100km: 32 },
        { id: 'v-2', plateNumber: 'OK', fuelNormPer100km: 32 },
      ]);
      db.trip!.findMany!.mockResolvedValue([
        {
          vehicleId: 'v-1',
          actualDistanceKm: 1000,
          startOdometer: null,
          endOdometer: null,
          plannedDistanceKm: null,
        },
        {
          vehicleId: 'v-2',
          actualDistanceKm: 1000,
          startOdometer: null,
          endOdometer: null,
          plannedDistanceKm: null,
        },
      ]);
      db.fuelLog!.findMany!.mockResolvedValue([
        { vehicleId: 'v-1', liters: 400, totalAmount: null, pricePerLiter: null }, // +25%
        { vehicleId: 'v-2', liters: 321, totalAmount: null, pricePerLiter: null }, // ~0.3%
      ]);
      db.aiSettings!.findFirst!.mockResolvedValue(null);

      await service.checkDeviations();
      expect(alerts.raise).toHaveBeenCalledTimes(1);
      expect(alerts.raise).toHaveBeenCalledWith(
        'company-a',
        expect.objectContaining({
          type: 'FUEL_DEVIATION',
          relatedId: 'v-1',
          params: expect.objectContaining({ plateNumber: 'OVER' }),
        }),
      );
    });
  });
});
