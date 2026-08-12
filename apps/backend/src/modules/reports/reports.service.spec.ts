import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { ReportsService } from './reports.service';

const FROM = new Date('2026-08-01T00:00:00Z');
const TO = new Date('2026-08-31T23:59:59Z');

function makeTrip(overrides: Record<string, unknown>) {
  return {
    id: 't-1',
    tripNumber: 'T-1',
    agreedPrice: 100_000_000n,
    actualDistanceKm: 100,
    startOdometer: null,
    endOdometer: null,
    plannedDistanceKm: null,
    loadingAddress: 'Toshkent',
    unloadingAddress: 'Moskva',
    vehicle: null,
    driver: null,
    client: null,
    finishedAt: new Date('2026-08-10T00:00:00Z'),
    ...overrides,
  };
}

describe('ReportsService', () => {
  function setup() {
    const mock = createTenantDbMock(['trip', 'expense', 'vehicle', 'notification', 'tripEvent']);
    const service = new ReportsService(mock.prisma);
    return { service, db: mock.db, forCompany: mock.forCompany };
  }

  describe('profit', () => {
    it('groups by route and subtracts expenses, share and amortization', async () => {
      const { service, db } = setup();
      db.trip!.findMany!.mockResolvedValue([
        makeTrip({
          id: 't-1',
          driver: { id: 'd-1', fullName: 'A', salaryType: 'PERCENT', salaryValue: 1000n },
          vehicle: {
            id: 'v-1',
            plateNumber: 'P1',
            purchasePrice: 10_000_000n,
            plannedTotalKm: 1000,
          },
        }),
        makeTrip({ id: 't-2', tripNumber: 'T-2' }),
      ]);
      db.expense!.findMany!.mockResolvedValue([
        { tripId: 't-1', category: 'FUEL', amount: 20_000_000n },
        { tripId: 't-2', category: 'TOLL', amount: 5_000_000n },
      ]);

      const rows = await service.profit(ACTOR, 'route', FROM, TO);
      expect(rows).toHaveLength(1); // same route → one row
      const row = rows[0]!;
      expect(row.label).toBe('Toshkent → Moskva');
      expect(row.tripCount).toBe(2);
      expect(row.income).toBe(200_000_000n);
      expect(row.expenses).toBe(25_000_000n);
      expect(row.driverShare).toBe(10_000_000n); // 10% of trip-1 price only
      expect(row.amortization).toBe(1_000_000n); // 10k tiyin/km × 100 km, trip-1 only
      expect(row.profit).toBe(200_000_000n - 36_000_000n);
    });

    it('per-trip grouping keeps every trip separate', async () => {
      const { service, db } = setup();
      db.trip!.findMany!.mockResolvedValue([
        makeTrip({ id: 't-1' }),
        makeTrip({ id: 't-2', tripNumber: 'T-2' }),
      ]);
      db.expense!.findMany!.mockResolvedValue([]);
      const rows = await service.profit(ACTOR, 'trip', FROM, TO);
      expect(rows).toHaveLength(2);
    });

    it('SALARY expenses suppress the computed driver share (no double count)', async () => {
      const { service, db } = setup();
      db.trip!.findMany!.mockResolvedValue([
        makeTrip({
          driver: { id: 'd-1', fullName: 'A', salaryType: 'PERCENT', salaryValue: 1000n },
        }),
      ]);
      db.expense!.findMany!.mockResolvedValue([
        { tripId: 't-1', category: 'SALARY', amount: 7_000_000n },
      ]);
      const row = (await service.profit(ACTOR, 'driver', FROM, TO))[0]!;
      expect(row.driverShare).toBe(0n);
      expect(row.expenses).toBe(7_000_000n);
    });
  });

  describe('expenseStructure', () => {
    it('computes category shares of the total', async () => {
      const { service, db } = setup();
      db.expense!.findMany!.mockResolvedValue([
        { category: 'FUEL', amount: 75_000_000n },
        { category: 'TOLL', amount: 25_000_000n },
      ]);
      const rows = await service.expenseStructure(ACTOR, FROM, TO);
      expect(rows[0]).toEqual({ category: 'FUEL', amount: 75_000_000n, sharePercent: 75 });
      expect(rows[1]).toEqual({ category: 'TOLL', amount: 25_000_000n, sharePercent: 25 });
    });

    it('is empty-safe (no division by zero)', async () => {
      const { service, db } = setup();
      db.expense!.findMany!.mockResolvedValue([]);
      await expect(service.expenseStructure(ACTOR, FROM, TO)).resolves.toEqual([]);
    });
  });

  describe('dashboard', () => {
    it('builds the W-1 cards and a 12-month series', async () => {
      const { service, db } = setup();
      db.vehicle!.count!.mockResolvedValue(10);
      db.trip!.findMany!.mockResolvedValueOnce([
        { vehicleId: 'v-1' },
        { vehicleId: 'v-2' },
        { vehicleId: 'v-1' },
      ]).mockResolvedValueOnce([
        { agreedPrice: 340_000_000n, finishedAt: new Date() },
        { agreedPrice: 100_000_000n, finishedAt: new Date('2020-01-01') }, // outside window
      ]);
      db.trip!.count!.mockResolvedValue(12);
      db.expense!.findMany!.mockResolvedValue([{ amount: 210_000_000n, expenseDate: new Date() }]);
      db.notification!.count!.mockResolvedValue(3);
      db.tripEvent!.findMany!.mockResolvedValue([
        {
          id: 'e-1',
          eventType: 'BREAKDOWN',
          eventTime: new Date(),
          address: 'Jizzax',
          driver: { fullName: 'Alisher A.' },
          trip: { tripNumber: 'T-9' },
        },
      ]);

      const data = await service.dashboard(ACTOR);
      expect(data.vehiclesOnRoute).toBe(2); // distinct vehicles
      expect(data.vehiclesTotal).toBe(10);
      expect(data.todayTrips).toBe(12);
      expect(data.monthIncome).toBe(340_000_000n);
      expect(data.monthExpense).toBe(210_000_000n);
      expect(data.monthProfit).toBe(130_000_000n);
      expect(data.unreadAlerts).toBe(3);
      expect(data.recentEvents[0]!.driverName).toBe('Alisher A.');
      expect(data.profitSeries).toHaveLength(12);
      const lastMonth = data.profitSeries[11]!;
      expect(lastMonth.profit).toBe(130_000_000n);
    });
  });
});
