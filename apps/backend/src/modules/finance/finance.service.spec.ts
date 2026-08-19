import { ExpenseCategory, SalaryType } from 'shared';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { FinanceService, monthlySeries, resolveRange } from './finance.service';

const TRIP = {
  id: 'trip-1',
  tripNumber: '147',
  agreedPrice: 1_250_000_000n,
  driverAdvance: 20_000_000n,
  actualDistanceKm: '310.0',
  plannedDistanceKm: '300.0',
  expenses: [
    { category: ExpenseCategory.FUEL, amount: 480_000_000n },
    { category: ExpenseCategory.TOLL, amount: 35_000_000n },
  ],
  incomes: [] as Array<{ amount: bigint; status: string }>,
  driver: { salaryType: SalaryType.PERCENT, salaryValue: 1000n },
  vehicle: { purchasePrice: 90_000_000_000n, plannedTotalKm: 1_000_000 },
};

function setup() {
  const { prisma, db, forCompany } = createTenantDbMock(['trip', 'vehicle', 'income', 'expense']);
  return { service: new FinanceService(prisma), db, forCompany };
}

describe('FinanceService — trip P&L', () => {
  it('reads the trip through the tenant-scoped client', async () => {
    const { service, db, forCompany } = setup();
    db.trip!.findUnique!.mockResolvedValue(TRIP);

    await service.tripPnl(ACTOR, 'trip-1');

    expect(forCompany).toHaveBeenCalledWith(ACTOR.companyId);
  });

  it("cannot reach another company's trip — the scoped query simply finds nothing", async () => {
    const { service, db } = setup();
    // B company's trip: the tenant extension filters it out, so Prisma returns null.
    db.trip!.findUnique!.mockResolvedValue(null);

    await expect(service.tripPnl(ACTOR, 'trip-of-company-b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('returns the TZ §6 breakdown as decimal strings, not floats', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue(TRIP);

    const result = await service.tripPnl(ACTOR, 'trip-1');

    expect(result).toMatchObject({
      tripNumber: '147',
      distanceKm10: 3100,
      revenue: '1250000000',
      revenueFromPayments: false,
      expenseTotal: '515000000',
      driverShare: '125000000',
      driverAdvance: '20000000',
      driverBalance: '105000000',
      amortization: '27900000',
      netProfit: '582100000',
    });
    expect(result.expensesByCategory[0]).toEqual({
      category: ExpenseCategory.FUEL,
      amount: '480000000',
    });
  });

  it('prefers received payments over the agreed price, ignoring unpaid invoices', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue({
      ...TRIP,
      incomes: [
        { amount: 900_000_000n, status: 'PAID' },
        { amount: 400_000_000n, status: 'PARTIAL' },
        { amount: 999_000_000n, status: 'PENDING' },
      ],
    });

    const result = await service.tripPnl(ACTOR, 'trip-1');

    expect(result.revenue).toBe('1300000000');
    expect(result.revenueFromPayments).toBe(true);
  });

  it('falls back to the planned distance before the trip is driven', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue({ ...TRIP, actualDistanceKm: null });

    expect((await service.tripPnl(ACTOR, 'trip-1')).distanceKm10).toBe(3000);
  });
});

describe('FinanceService — vehicle statistics', () => {
  it('aggregates the period trips into revenue, cost and ROI', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue({
      id: 'v1',
      plateNumber: '01 A 447 EA',
      purchasePrice: 90_000_000_000n,
      plannedTotalKm: 1_000_000,
    });
    db.trip!.findMany!.mockResolvedValue([TRIP, { ...TRIP, id: 'trip-2' }]);

    const result = await service.vehicleStats(ACTOR, 'v1', {});

    expect(result.tripCount).toBe(2);
    expect(result.distanceKm10).toBe(6200);
    expect(result.revenue).toBe('2500000000');
    // (515 000 000 + 125 000 000 + 27 900 000) × 2
    expect(result.totalCost).toBe('1335800000');
    expect(result.netProfit).toBe('1164200000');
    expect(result.roiBp).toBe(8715); // +87.15%
  });

  it('reports an unknown vehicle as not found', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue(null);

    await expect(service.vehicleStats(ACTOR, 'v-unknown', {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('FinanceService — dashboard summary', () => {
  const range = { from: '2026-08-01T00:00:00Z', to: '2026-09-01T00:00:00Z' };

  function setupSummary() {
    const context = setup();
    const { db } = context;
    db.vehicle!.count!.mockResolvedValue(12);
    db.trip!.count!.mockResolvedValue(3);
    db.income!.findMany!.mockResolvedValue([
      { amount: 900_000_000n, status: 'PAID', paymentDate: new Date('2026-08-16T00:00:00Z') },
      { amount: 100_000_000n, status: 'PARTIAL', paymentDate: new Date('2026-08-20T00:00:00Z') },
      // Paid, but in a different month — outside the window.
      { amount: 500_000_000n, status: 'PAID', paymentDate: new Date('2026-07-16T00:00:00Z') },
      { amount: 300_000_000n, status: 'PENDING', paymentDate: null },
      { amount: 250_000_000n, status: 'OVERDUE', paymentDate: null },
    ]);
    db.expense!.findMany!.mockResolvedValue([
      {
        amount: 400_000_000n,
        category: ExpenseCategory.FUEL,
        expenseDate: new Date('2026-08-10T00:00:00Z'),
      },
      {
        amount: 60_000_000n,
        category: ExpenseCategory.REPAIR,
        expenseDate: new Date('2026-08-12T00:00:00Z'),
      },
      {
        amount: 900_000_000n,
        category: ExpenseCategory.FUEL,
        expenseDate: new Date('2026-06-12T00:00:00Z'),
      },
    ]);
    db.trip!.findMany!.mockResolvedValue([
      {
        actualDistanceKm: '310.0',
        plannedDistanceKm: null,
        vehicle: { purchasePrice: 90_000_000_000n, plannedTotalKm: 1_000_000 },
      },
    ]);
    return context;
  }

  it('counts only payments received inside the window', async () => {
    const { service } = setupSummary();
    const result = await service.summary(ACTOR, range);
    expect(result.income).toBe('1000000000');
  });

  it('separates what is still owed from what is already overdue', async () => {
    const { service } = setupSummary();
    const result = await service.summary(ACTOR, range);
    expect(result.receivable).toBe('550000000');
    expect(result.overdue).toBe('250000000');
  });

  it('nets booked expenses and the period depreciation off the income', async () => {
    const { service } = setupSummary();
    const result = await service.summary(ACTOR, range);
    expect(result.expenses).toBe('460000000');
    expect(result.amortization).toBe('27900000');
    expect(result.netProfit).toBe('512100000');
  });

  it('ranks the expense categories of the window only', async () => {
    const { service } = setupSummary();
    const result = await service.summary(ACTOR, range);
    expect(result.expensesByCategory).toEqual([
      { category: ExpenseCategory.FUEL, amount: '400000000' },
      { category: ExpenseCategory.REPAIR, amount: '60000000' },
    ]);
  });

  it('always returns twelve months for the chart', async () => {
    const { service } = setupSummary();
    const result = await service.summary(ACTOR, range);
    expect(result.monthly).toHaveLength(12);
    expect(result.monthly.at(-1)?.month).toBe('2026-08');
    expect(result.monthly.at(0)?.month).toBe('2025-09');
  });
});

describe('resolveRange', () => {
  it('defaults to the current calendar month in UTC', () => {
    const { from, to } = resolveRange({}, new Date('2026-08-19T15:00:00Z'));
    expect(from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('honours an explicit window', () => {
    const { from, to } = resolveRange({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' });
    expect(from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('monthlySeries', () => {
  it('buckets by UTC month and leaves empty months at zero', () => {
    const series = monthlySeries(
      [
        {
          amount: 500n,
          status: 'PAID' as never,
          paymentDate: new Date('2026-08-31T23:00:00Z'),
        },
        { amount: 700n, status: 'PENDING' as never, paymentDate: new Date('2026-08-02T00:00:00Z') },
      ],
      [{ amount: 200n, expenseDate: new Date('2026-08-05T00:00:00Z') }],
      new Date('2026-09-01T00:00:00Z'),
    );

    const august = series.find((point) => point.month === '2026-08');
    expect(august).toEqual({ month: '2026-08', income: '500', expenses: '200', profit: '300' });
    expect(series.find((point) => point.month === '2026-07')).toMatchObject({ profit: '0' });
  });
});
