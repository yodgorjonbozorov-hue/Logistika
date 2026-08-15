import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { periodOf } from './dto/finance.dto';
import { FinanceService, tripDistanceKmTenths } from './finance.service';

const PERIOD = periodOf(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T23:59:59Z'));

function tripRow(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    tripNumber: '42',
    vehicleId: 'v1',
    agreedPrice: 25_000_000_00n,
    actualDistanceKm: '1240.0',
    startOdometer: null,
    endOdometer: null,
    plannedDistanceKm: null,
    expenses: [{ category: 'FUEL', amount: 500_000_000n }],
    vehicle: {
      id: 'v1',
      plateNumber: '01 A 123 AA',
      purchasePrice: 900_000_000_000n,
      plannedTotalKm: 1_000_000,
    },
    driver: { id: 'd1', fullName: 'Alisher A.', salaryType: 'PERCENT', salaryValue: 1000n },
    client: { id: 'c1', name: 'Mijoz' },
    ...over,
  };
}

function setup() {
  const { prisma, db, forCompany } = createTenantDbMock(['trip', 'expense', 'income', 'vehicle']);
  return { service: new FinanceService(prisma), db, forCompany };
}

describe('tripDistanceKmTenths', () => {
  it('prefers the measured distance', () => {
    expect(
      tripDistanceKmTenths({
        actualDistanceKm: '1240.5',
        startOdometer: 1000,
        endOdometer: 3000,
        plannedDistanceKm: '900',
      }),
    ).toBe(12_405n);
  });

  it('falls back to the odometer delta, then to the plan', () => {
    expect(
      tripDistanceKmTenths({
        actualDistanceKm: null,
        startOdometer: 1000,
        endOdometer: 2240,
        plannedDistanceKm: '900',
      }),
    ).toBe(12_400n);
    expect(
      tripDistanceKmTenths({
        actualDistanceKm: null,
        startOdometer: null,
        endOdometer: null,
        plannedDistanceKm: '900.0',
      }),
    ).toBe(9_000n);
  });

  it('ignores a non-positive odometer delta', () => {
    expect(
      tripDistanceKmTenths({
        actualDistanceKm: null,
        startOdometer: 3000,
        endOdometer: 1000,
        plannedDistanceKm: null,
      }),
    ).toBeNull();
  });
});

describe('FinanceService.tripPnl', () => {
  it('returns the full P&L of one trip', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue(tripRow());

    const result = await service.tripPnl(ACTOR, 't1');

    expect(result.income).toBe(2_500_000_000n);
    expect(result.driverShare).toBe(250_000_000n);
    expect(result.depreciation).toBe(1_116_000_000n);
    expect(result.profit).toBe(634_000_000n);
    expect(result.distanceKm).toBe('1240.0');
  });

  it('scopes the lookup to the caller company — another tenant trip is NOT_FOUND', async () => {
    const { service, db, forCompany } = setup();
    db.trip!.findUnique!.mockResolvedValue(null); // tenant filter hides company B rows

    await expect(service.tripPnl(ACTOR, 'trip-of-company-b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });
});

describe('FinanceService.summary', () => {
  it('adds trip revenue, trip cost and non-trip overhead', async () => {
    const { service, db } = setup();
    db.trip!.findMany!.mockResolvedValue([tripRow()]);
    db.expense!.findMany!.mockResolvedValue([{ category: 'TAX', amount: 100_000_000n }]);
    db.income!.aggregate!.mockResolvedValue({ _sum: { amount: 40_000_000n } });

    const result = await service.summary(ACTOR, PERIOD);

    expect(result.revenue).toBe(2_500_000_000n + 40_000_000n);
    expect(result.tripCost).toBe(1_866_000_000n); // fuel + driver share + depreciation
    expect(result.overhead).toBe(100_000_000n);
    expect(result.cost).toBe(1_966_000_000n);
    expect(result.profit).toBe(574_000_000n);
    expect(result.tripCount).toBe(1);
    expect(result.distanceKm).toBe('1240.0');
    expect(result.expensesByCategory).toEqual({
      FUEL: 500_000_000n,
      SALARY: 250_000_000n,
      TAX: 100_000_000n,
    });
  });

  it('only counts completed trips finished inside the window', async () => {
    const { service, db } = setup();
    await service.summary(ACTOR, PERIOD);

    const where = db.trip!.findMany!.mock.calls[0][0].where;
    expect(where.status).toBe('COMPLETED');
    expect(where.finishedAt).toEqual({ gte: PERIOD.fromDate, lte: PERIOD.toDate });
  });

  it('counts only incomes with no trip, so a paid trip is not booked twice', async () => {
    const { service, db } = setup();
    await service.summary(ACTOR, PERIOD);
    expect(db.income!.aggregate!.mock.calls[0][0].where.tripId).toBeNull();
  });

  it('survives an empty period without dividing by zero', async () => {
    const { service, db } = setup();
    db.income!.aggregate!.mockResolvedValue({ _sum: { amount: null } });

    const result = await service.summary(ACTOR, PERIOD);
    expect(result.revenue).toBe(0n);
    expect(result.profit).toBe(0n);
    expect(result.marginBp).toBeNull();
    expect(result.costPerKm).toBeNull();
    expect(result.distanceKm).toBeNull();
  });
});

describe('FinanceService.fleetEconomics', () => {
  it('aggregates per vehicle and computes ROI and cost per km', async () => {
    const { service, db } = setup();
    db.vehicle!.findMany!.mockResolvedValue([
      { id: 'v1', plateNumber: '01 A 123 AA' },
      { id: 'v2', plateNumber: '01 B 456 BB' },
    ]);
    db.trip!.findMany!.mockResolvedValue([tripRow()]);
    db.expense!.findMany!.mockResolvedValue([{ vehicleId: 'v1', amount: 34_000_000n }]);

    const [first, second] = await service.fleetEconomics(ACTOR, PERIOD);

    expect(first!.revenue).toBe(2_500_000_000n);
    expect(first!.cost).toBe(1_900_000_000n); // 1 866 000 000 trip cost + 34 000 000 vehicle expense
    expect(first!.profit).toBe(600_000_000n);
    expect(first!.distanceKm).toBe('1240.0');
    expect(first!.costPerKm).toBe(1_532_258n);
    expect(first!.roiBp).toBe(3158); // +31.58%

    expect(second!.tripCount).toBe(0);
    expect(second!.roiBp).toBeNull();
    expect(second!.costPerKm).toBeNull();
  });

  it('ignores trips whose vehicle is not in this tenant list', async () => {
    const { service, db } = setup();
    db.vehicle!.findMany!.mockResolvedValue([{ id: 'v1', plateNumber: '01 A 123 AA' }]);
    db.trip!.findMany!.mockResolvedValue([tripRow({ vehicleId: 'vehicle-of-company-b' })]);

    const rows = await service.fleetEconomics(ACTOR, PERIOD);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tripCount).toBe(0);
    expect(rows[0]!.revenue).toBe(0n);
  });
});

describe('FinanceService.receivables', () => {
  it('groups unpaid invoices per client, splitting overdue out', async () => {
    const { service, db } = setup();
    db.income!.findMany!.mockResolvedValue([
      {
        clientId: 'c1',
        amount: 100n,
        status: 'PENDING',
        createdAt: new Date('2026-07-01T00:00:00Z'),
        client: { name: 'Mijoz A' },
      },
      {
        clientId: 'c1',
        amount: 50n,
        status: 'OVERDUE',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        client: { name: 'Mijoz A' },
      },
      {
        clientId: 'c2',
        amount: 20n,
        status: 'PARTIAL',
        createdAt: new Date('2026-07-15T00:00:00Z'),
        client: { name: 'Mijoz B' },
      },
    ]);

    const rows = await service.receivables(ACTOR);

    expect(rows[0]).toMatchObject({
      clientId: 'c1',
      clientName: 'Mijoz A',
      pending: 100n,
      overdue: 50n,
      total: 150n,
      oldestDate: new Date('2026-06-01T00:00:00Z'),
    });
    expect(rows[1]!.total).toBe(20n);
  });

  it('never lists settled invoices', async () => {
    const { service, db } = setup();
    await service.receivables(ACTOR);
    expect(db.income!.findMany!.mock.calls[0][0].where.status).toEqual({
      in: ['PENDING', 'PARTIAL', 'OVERDUE'],
    });
  });
});
