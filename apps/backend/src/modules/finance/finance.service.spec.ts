import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { FinanceService, tripDistanceKm } from './finance.service';

describe('tripDistanceKm', () => {
  it('prefers actual distance, then odometer diff, then planned', () => {
    expect(
      tripDistanceKm({
        actualDistanceKm: 950.5 as never,
        startOdometer: 100,
        endOdometer: 1200,
        plannedDistanceKm: 900 as never,
      }),
    ).toBe(950.5);
    expect(
      tripDistanceKm({
        actualDistanceKm: null,
        startOdometer: 100,
        endOdometer: 1200,
        plannedDistanceKm: 900 as never,
      }),
    ).toBe(1100);
    expect(
      tripDistanceKm({
        actualDistanceKm: null,
        startOdometer: null,
        endOdometer: null,
        plannedDistanceKm: 900 as never,
      }),
    ).toBe(900);
  });

  it('ignores a non-increasing odometer pair and falls back', () => {
    expect(
      tripDistanceKm({
        actualDistanceKm: null,
        startOdometer: 1200,
        endOdometer: 1100,
        plannedDistanceKm: null,
      }),
    ).toBe(0);
  });
});

describe('FinanceService', () => {
  let service: FinanceService;
  let db: ReturnType<typeof createTenantDbMock>['db'];
  let forCompany: jest.Mock;

  beforeEach(() => {
    const mock = createTenantDbMock(['trip', 'expense', 'income', 'vehicle']);
    db = mock.db;
    forCompany = mock.forCompany;
    service = new FinanceService(mock.prisma);
  });

  const baseTrip = {
    id: 'trip-1',
    tripNumber: 'T-2026-0001',
    status: 'COMPLETED',
    agreedPrice: 500_000_000n, // 5 000 000 so'm
    actualDistanceKm: 1000,
    startOdometer: null,
    endOdometer: null,
    plannedDistanceKm: null,
    driver: { salaryType: 'PERCENT', salaryValue: 1000n }, // 10%
    vehicle: { purchasePrice: 80_000_000_000n, plannedTotalKm: 1_000_000 },
  };

  describe('tripPnl', () => {
    it('always scopes queries to the actor company', async () => {
      db.trip!.findUnique!.mockResolvedValue(baseTrip);
      db.expense!.findMany!.mockResolvedValue([]);
      db.income!.findMany!.mockResolvedValue([]);
      await service.tripPnl(ACTOR, 'trip-1');
      expect(forCompany).toHaveBeenCalledWith(ACTOR.companyId);
    });

    it('404s for a trip of another company (tenant isolation)', async () => {
      db.trip!.findUnique!.mockResolvedValue(null);
      await expect(service.tripPnl(ACTOR, 'foreign-trip')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('computes profit = price − expenses − driver share − amortization', async () => {
      db.trip!.findUnique!.mockResolvedValue(baseTrip);
      db.expense!.findMany!.mockResolvedValue([
        { category: 'FUEL', amount: 100_000_000n },
        { category: 'TOLL', amount: 20_000_000n },
        { category: 'FUEL', amount: 30_000_000n },
      ]);
      db.income!.findMany!.mockResolvedValue([]);

      const pnl = await service.tripPnl(ACTOR, 'trip-1');
      expect(pnl.expensesByCategory).toEqual({ FUEL: 130_000_000n, TOLL: 20_000_000n });
      expect(pnl.expensesTotal).toBe(150_000_000n);
      expect(pnl.driverShareSource).toBe('COMPUTED');
      expect(pnl.driverShare).toBe(50_000_000n); // 10% of price
      expect(pnl.amortization).toBe(80_000_000n); // 80 000 tiyin/km × 1000 km
      expect(pnl.totalCost).toBe(280_000_000n);
      expect(pnl.profit).toBe(220_000_000n);
      expect(pnl.costPerKm).toBe(280_000n); // 2800 so'm/km
    });

    it('uses SALARY expenses instead of the computed share when present', async () => {
      db.trip!.findUnique!.mockResolvedValue(baseTrip);
      db.expense!.findMany!.mockResolvedValue([{ category: 'SALARY', amount: 40_000_000n }]);
      db.income!.findMany!.mockResolvedValue([]);

      const pnl = await service.tripPnl(ACTOR, 'trip-1');
      expect(pnl.driverShareSource).toBe('EXPENSES');
      expect(pnl.driverShare).toBe(0n);
      expect(pnl.totalCost).toBe(40_000_000n + 80_000_000n);
    });

    it('sums only PAID/PARTIAL incomes as received', async () => {
      db.trip!.findUnique!.mockResolvedValue(baseTrip);
      db.expense!.findMany!.mockResolvedValue([]);
      db.income!.findMany!.mockResolvedValue([
        { status: 'PAID', amount: 200_000_000n },
        { status: 'PARTIAL', amount: 50_000_000n },
        { status: 'PENDING', amount: 250_000_000n },
      ]);

      const pnl = await service.tripPnl(ACTOR, 'trip-1');
      expect(pnl.receivedAmount).toBe(250_000_000n);
    });

    it('survives a trip without driver, vehicle or distance', async () => {
      db.trip!.findUnique!.mockResolvedValue({
        ...baseTrip,
        actualDistanceKm: null,
        driver: null,
        vehicle: null,
      });
      db.expense!.findMany!.mockResolvedValue([]);
      db.income!.findMany!.mockResolvedValue([]);

      const pnl = await service.tripPnl(ACTOR, 'trip-1');
      expect(pnl.driverShare).toBe(0n);
      expect(pnl.amortization).toBe(0n);
      expect(pnl.profit).toBe(500_000_000n);
      expect(pnl.costPerKm).toBeNull();
    });
  });

  describe('vehicleStats', () => {
    const FROM = new Date('2026-08-01T00:00:00Z');
    const TO = new Date('2026-08-31T23:59:59Z');

    it('404s for a foreign vehicle', async () => {
      db.vehicle!.findUnique!.mockResolvedValue(null);
      await expect(service.vehicleStats(ACTOR, 'v-1', FROM, TO)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('aggregates completed trips and expenses into cost/km and ROI', async () => {
      db.vehicle!.findUnique!.mockResolvedValue({
        id: 'v-1',
        plateNumber: '01 A 123 AA',
        purchasePrice: 80_000_000_000n,
        plannedTotalKm: 1_000_000,
      });
      db.trip!.findMany!.mockResolvedValue([
        {
          agreedPrice: 500_000_000n,
          actualDistanceKm: 1000,
          startOdometer: null,
          endOdometer: null,
          plannedDistanceKm: null,
        },
        {
          agreedPrice: 300_000_000n,
          actualDistanceKm: 500,
          startOdometer: null,
          endOdometer: null,
          plannedDistanceKm: null,
        },
      ]);
      db.expense!.findMany!.mockResolvedValue([{ amount: 400_000_000n }]);

      const stats = await service.vehicleStats(ACTOR, 'v-1', FROM, TO);
      expect(stats.tripCount).toBe(2);
      expect(stats.distanceKm).toBe(1500);
      expect(stats.income).toBe(800_000_000n);
      expect(stats.amortization).toBe(120_000_000n); // 1500 km × 80 000 tiyin
      expect(stats.totalCost).toBe(520_000_000n);
      expect(stats.profit).toBe(280_000_000n);
      expect(stats.costPerKm).toBe(346_667n); // 520 000 000 / 1500, rounded
      expect(stats.roiPercent).toBe(53.85);
    });

    it('yields null ratios when the vehicle did not move', async () => {
      db.vehicle!.findUnique!.mockResolvedValue({
        id: 'v-1',
        plateNumber: '01 A 123 AA',
        purchasePrice: null,
        plannedTotalKm: null,
      });
      db.trip!.findMany!.mockResolvedValue([]);
      db.expense!.findMany!.mockResolvedValue([]);

      const stats = await service.vehicleStats(ACTOR, 'v-1', FROM, TO);
      expect(stats.costPerKm).toBeNull();
      expect(stats.roiPercent).toBeNull();
      expect(stats.profit).toBe(0n);
    });
  });
});
