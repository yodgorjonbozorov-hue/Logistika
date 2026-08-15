import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { periodOf } from '../finance/dto/finance.dto';
import type { FinanceService } from '../finance/finance.service';
import { ReportsService } from './reports.service';

const PERIOD = periodOf(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T23:59:59Z'));
const NOW = new Date('2026-08-15T12:00:00Z');

function tripEntry(over: Record<string, unknown> = {}, financeOver: Record<string, unknown> = {}) {
  return {
    trip: {
      id: 't1',
      tripNumber: '42',
      finishedAt: new Date('2026-08-10T00:00:00Z'),
      createdAt: new Date('2026-08-01T00:00:00Z'),
      loadingAddress: 'Toshkent',
      unloadingAddress: 'Moskva',
      clientId: 'c1',
      driverId: 'd1',
      client: { id: 'c1', name: 'Mijoz A' },
      driver: { id: 'd1', fullName: 'Alisher A.' },
      vehicle: { id: 'v1', plateNumber: '01 A 123 AA' },
      ...over,
    },
    finance: {
      income: 2_500_000_000n,
      costTotal: 1_900_000_000n,
      profit: 600_000_000n,
      driverShare: 250_000_000n,
      depreciation: 0n,
      expensesTotal: 1_650_000_000n,
      expensesByCategory: { FUEL: 1_650_000_000n },
      marginBp: 2400,
      profitPerKm: null,
      distanceKmTenths: 12_400n,
      ...financeOver,
    },
  };
}

function setup() {
  const { prisma, db, forCompany } = createTenantDbMock([
    'trip',
    'vehicle',
    'notification',
    'tripEvent',
    'expense',
  ]);
  const finance = {
    summary: jest.fn().mockResolvedValue({
      revenue: 2_500_000_000n,
      cost: 1_900_000_000n,
      profit: 600_000_000n,
      expensesByCategory: { FUEL: 1_650_000_000n, SALARY: 250_000_000n },
    }),
    tripsWithFinance: jest.fn().mockResolvedValue([]),
    fleetEconomics: jest.fn().mockResolvedValue([]),
    receivables: jest.fn().mockResolvedValue([]),
  };
  const service = new ReportsService(prisma, finance as unknown as FinanceService);
  return { service, db, forCompany, finance };
}

describe('ReportsService.dashboard', () => {
  it('fills the six W-1 cards', async () => {
    const { service, db } = setup();
    db.trip!.findMany!.mockResolvedValue([
      { vehicleId: 'v1' },
      { vehicleId: 'v1' },
      { vehicleId: 'v2' },
    ]);
    db.vehicle!.count!.mockResolvedValue(10);
    db.trip!.count!.mockResolvedValue(12);
    db.notification!.count!.mockResolvedValue(3);

    const result = await service.dashboard(ACTOR, NOW);

    expect(result.vehiclesOnRoad).toBe(2); // two distinct vehicles on active trips
    expect(result.vehiclesTotal).toBe(10);
    expect(result.tripsToday).toBe(12);
    expect(result.unreadAlerts).toBe(3);
    expect(result.month.profit).toBe(600_000_000n);
  });

  it('counts today from midnight UTC and reads everything tenant-scoped', async () => {
    const { service, db, forCompany } = setup();
    await service.dashboard(ACTOR, NOW);

    expect(db.trip!.count!.mock.calls[0][0].where.createdAt.gte).toEqual(
      new Date('2026-08-15T00:00:00Z'),
    );
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });

  it('returns the last 10 events with driver and trip labels', async () => {
    const { service, db } = setup();
    db.tripEvent!.findMany!.mockResolvedValue([
      {
        id: 'e1',
        eventType: 'BREAKDOWN',
        eventTime: new Date('2026-08-15T09:20:00Z'),
        address: 'Jizzax',
        driver: { fullName: 'Alisher A.' },
        trip: { tripNumber: '42' },
      },
    ]);

    const result = await service.dashboard(ACTOR, NOW);
    expect(db.tripEvent!.findMany!.mock.calls[0][0].take).toBe(10);
    expect(result.recentEvents[0]).toMatchObject({
      eventType: 'BREAKDOWN',
      driverName: 'Alisher A.',
      tripNumber: '42',
    });
  });
});

describe('ReportsService.profitTrend', () => {
  it('returns 12 month buckets, empty ones included', async () => {
    const { service } = setup();
    const trend = await service.profitTrend(ACTOR, NOW);

    expect(trend).toHaveLength(12);
    expect(trend[0]!.month).toBe('2025-09');
    expect(trend[11]!.month).toBe('2026-08');
    expect(trend[11]!.profit).toBe(0n);
  });

  it('books trip revenue and cost into the month the trip finished', async () => {
    const { service, finance } = setup();
    finance.tripsWithFinance.mockResolvedValue([tripEntry()]);

    const trend = await service.profitTrend(ACTOR, NOW);
    const august = trend.find((row) => row.month === '2026-08');

    expect(august!.revenue).toBe(2_500_000_000n);
    expect(august!.cost).toBe(1_900_000_000n);
    expect(august!.profit).toBe(600_000_000n);
  });

  it('adds non-trip expenses to their own month', async () => {
    const { service, db } = setup();
    db.expense!.findMany!.mockResolvedValue([
      { amount: 100_000_000n, expenseDate: new Date('2026-07-15T00:00:00Z') },
    ]);

    const trend = await service.profitTrend(ACTOR, NOW);
    const july = trend.find((row) => row.month === '2026-07');
    expect(july!.cost).toBe(100_000_000n);
    expect(july!.profit).toBe(-100_000_000n);
  });
});

describe('ReportsService.table', () => {
  it('builds the trips report with a totals row', async () => {
    const { service, finance } = setup();
    finance.tripsWithFinance.mockResolvedValue([tripEntry(), tripEntry({ tripNumber: '43' })]);

    const table = await service.table(ACTOR, 'trips', PERIOD);

    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toMatchObject({
      tripNumber: '42',
      client: 'Mijoz A',
      vehicle: '01 A 123 AA',
      route: 'Toshkent → Moskva',
      distanceKm: 1240,
      profit: 600_000_000n,
    });
    expect(table.totals).toMatchObject({
      revenue: 5_000_000_000n,
      cost: 3_800_000_000n,
      profit: 1_200_000_000n,
      marginBp: 2400,
    });
  });

  it('groups the routes report and sorts by profit', async () => {
    const { service, finance } = setup();
    finance.tripsWithFinance.mockResolvedValue([
      tripEntry(),
      tripEntry(),
      tripEntry(
        { unloadingAddress: 'Almaty' },
        { profit: 1_000_000_000n, income: 900_000_000n, costTotal: 100_000_000n },
      ),
    ]);

    const table = await service.table(ACTOR, 'routes', PERIOD);

    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]!.route).toBe('Toshkent → Moskva');
    expect(table.rows[0]!.tripCount).toBe(2);
    expect(table.rows[0]!.profit).toBe(1_200_000_000n);
    expect(table.rows[1]!.route).toBe('Toshkent → Almaty');
  });

  it('sums the driver report per driver, keeping the salary share visible', async () => {
    const { service, finance } = setup();
    finance.tripsWithFinance.mockResolvedValue([tripEntry(), tripEntry()]);

    const table = await service.table(ACTOR, 'drivers', PERIOD);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({
      driver: 'Alisher A.',
      tripCount: 2,
      driverShare: 500_000_000n,
      profit: 1_200_000_000n,
    });
  });

  it('joins client turnover with the outstanding debt', async () => {
    const { service, finance } = setup();
    finance.tripsWithFinance.mockResolvedValue([tripEntry()]);
    finance.receivables.mockResolvedValue([{ clientId: 'c1', total: 400_000_000n }]);

    const table = await service.table(ACTOR, 'clients', PERIOD);
    expect(table.rows[0]).toMatchObject({
      client: 'Mijoz A',
      revenue: 2_500_000_000n,
      debt: 400_000_000n,
    });
  });

  it('turns the expense summary into shares that add up to 100%', async () => {
    const { service } = setup();
    const table = await service.table(ACTOR, 'expenses', PERIOD);

    expect(table.rows.map((row) => row.category)).toEqual(['FUEL', 'SALARY']);
    expect(table.rows[0]!.shareBp).toBe(8684);
    expect(table.rows[1]!.shareBp).toBe(1316);
    expect(table.totals).toMatchObject({ amount: 1_900_000_000n, shareBp: 10_000 });
  });

  it('rejects an unknown report key', async () => {
    const { service } = setup();
    await expect(
      service.table(ACTOR, 'unknown' as unknown as 'trips', PERIOD),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
