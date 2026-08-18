import { describe, expect, it } from 'vitest';
import { ExpenseCategory, PaymentStatus, TripStatus } from 'shared';
import type { Client, Expense, Income, Trip } from '../../shared/api/entities';
import {
  busyResourceIds,
  completedPerDay,
  completedThisMonth,
  countByStatus,
  donutSegments,
  expensesByCategory,
  incomeTotals,
  localDay,
  openTrips,
  receivables,
  sumAmounts,
} from './metrics';

function trip(overrides: Partial<Trip>): Trip {
  return {
    id: 'trip-1',
    tripNumber: 'TR-2026-0001',
    clientId: null,
    vehicleId: null,
    trailerId: null,
    driverId: null,
    cargoName: null,
    cargoWeight: null,
    cargoVolume: null,
    loadingAddress: null,
    loadingDate: null,
    unloadingAddress: null,
    unloadingDate: null,
    plannedDistanceKm: null,
    actualDistanceKm: null,
    agreedPrice: '0',
    currency: 'UZS' as Trip['currency'],
    driverAdvance: '0',
    status: TripStatus.DRAFT,
    startOdometer: null,
    endOdometer: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('countByStatus', () => {
  it('counts every status, including the empty ones', () => {
    const counts = countByStatus([
      trip({ id: 'a', status: TripStatus.IN_PROGRESS }),
      trip({ id: 'b', status: TripStatus.IN_PROGRESS }),
      trip({ id: 'c', status: TripStatus.COMPLETED }),
    ]);
    expect(counts[TripStatus.IN_PROGRESS]).toBe(2);
    expect(counts[TripStatus.COMPLETED]).toBe(1);
    expect(counts[TripStatus.CANCELLED]).toBe(0);
  });
});

describe('openTrips', () => {
  it('keeps draft, assigned and in-progress but drops finished work', () => {
    const rows = [
      trip({ id: 'a', status: TripStatus.DRAFT }),
      trip({ id: 'b', status: TripStatus.ASSIGNED }),
      trip({ id: 'c', status: TripStatus.IN_PROGRESS }),
      trip({ id: 'd', status: TripStatus.COMPLETED }),
      trip({ id: 'e', status: TripStatus.CANCELLED }),
    ];
    expect(openTrips(rows).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('completedThisMonth', () => {
  const reference = new Date(2026, 7, 18); // August 2026, local time

  it('counts only trips finished inside the reference month', () => {
    const rows = [
      trip({
        id: 'a',
        status: TripStatus.COMPLETED,
        finishedAt: new Date(2026, 7, 3).toISOString(),
      }),
      trip({
        id: 'b',
        status: TripStatus.COMPLETED,
        finishedAt: new Date(2026, 6, 30).toISOString(),
      }),
      trip({ id: 'c', status: TripStatus.IN_PROGRESS, finishedAt: null }),
    ];
    expect(completedThisMonth(rows, reference).map((row) => row.id)).toEqual(['a']);
  });
});

describe('completedPerDay', () => {
  const reference = new Date(2026, 7, 18, 12, 0, 0);

  it('returns one bucket per day, oldest first, ending on the reference day', () => {
    const buckets = completedPerDay([], 14, reference);
    expect(buckets).toHaveLength(14);
    expect(buckets[13]?.day).toBe(localDay(reference));
    expect(buckets[0]?.day).toBe(localDay(new Date(2026, 7, 5)));
  });

  it('buckets completed trips by their local finish day', () => {
    const buckets = completedPerDay(
      [
        trip({
          id: 'a',
          status: TripStatus.COMPLETED,
          finishedAt: new Date(2026, 7, 18, 9).toISOString(),
        }),
        trip({
          id: 'b',
          status: TripStatus.COMPLETED,
          finishedAt: new Date(2026, 7, 18, 20).toISOString(),
        }),
        trip({
          id: 'c',
          status: TripStatus.COMPLETED,
          finishedAt: new Date(2026, 7, 17, 9).toISOString(),
        }),
      ],
      14,
      reference,
    );
    expect(buckets[13]?.count).toBe(2);
    expect(buckets[12]?.count).toBe(1);
  });

  it('ignores trips finished outside the window and trips still running', () => {
    const buckets = completedPerDay(
      [
        trip({
          id: 'old',
          status: TripStatus.COMPLETED,
          finishedAt: new Date(2026, 6, 1).toISOString(),
        }),
        trip({ id: 'running', status: TripStatus.IN_PROGRESS, finishedAt: null }),
      ],
      14,
      reference,
    );
    expect(buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });
});

describe('busyResourceIds', () => {
  it('collects vehicles and drivers held by open trips only', () => {
    const busy = busyResourceIds([
      trip({ id: 'a', status: TripStatus.IN_PROGRESS, vehicleId: 'v1', driverId: 'd1' }),
      trip({ id: 'b', status: TripStatus.ASSIGNED, vehicleId: 'v2', driverId: null }),
      trip({ id: 'c', status: TripStatus.COMPLETED, vehicleId: 'v3', driverId: 'd3' }),
    ]);
    expect([...busy.vehicles].sort()).toEqual(['v1', 'v2']);
    expect([...busy.drivers]).toEqual(['d1']);
  });
});

describe('donutSegments', () => {
  it('orders slices as the design does and drops empty ones', () => {
    const segments = donutSegments({
      [TripStatus.DRAFT]: 3,
      [TripStatus.ASSIGNED]: 0,
      [TripStatus.IN_PROGRESS]: 12,
      [TripStatus.COMPLETED]: 9,
      [TripStatus.CANCELLED]: 0,
    });
    expect(segments.map((segment) => segment.status)).toEqual([
      TripStatus.IN_PROGRESS,
      TripStatus.COMPLETED,
      TripStatus.DRAFT,
    ]);
  });
});

describe('money aggregation', () => {
  function income(overrides: Partial<Income>): Income {
    return {
      id: 'i1',
      tripId: null,
      clientId: null,
      amount: '0',
      currency: 'UZS' as Income['currency'],
      paymentDate: null,
      paymentMethod: null,
      invoiceNumber: null,
      status: PaymentStatus.PENDING,
      createdAt: '2026-08-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('sums amounts in BigInt, never float', () => {
    const total = sumAmounts([{ amount: '9007199254740993' }, { amount: '1' }]);
    expect(total).toBe(9007199254740994n);
  });

  it('splits income by payment status', () => {
    const totals = incomeTotals([
      income({ id: 'a', amount: '1000', status: PaymentStatus.PAID }),
      income({ id: 'b', amount: '2000', status: PaymentStatus.OVERDUE }),
      income({ id: 'c', amount: '300', status: PaymentStatus.PENDING }),
      income({ id: 'd', amount: '700', status: PaymentStatus.PARTIAL }),
    ]);
    expect(totals).toEqual({ total: 4000n, paid: 1000n, overdue: 2000n, pending: 1000n });
  });

  it('counts only positive client balances as receivables', () => {
    const clients = [{ balance: '5000' }, { balance: '-2000' }, { balance: '0' }] as Client[];
    expect(receivables(clients)).toBe(5000n);
  });
});

describe('expensesByCategory', () => {
  function expense(category: ExpenseCategory, amount: string): Expense {
    return {
      id: `${category}-${amount}`,
      tripId: null,
      vehicleId: null,
      driverId: null,
      category,
      amount,
      currency: 'UZS' as Expense['currency'],
      quantity: null,
      unitPrice: null,
      description: null,
      paymentMethod: null,
      expenseDate: '2026-08-01T00:00:00.000Z',
      isApproved: true,
    };
  }

  it('totals per category, largest first, with percentages summing to 100', () => {
    const shares = expensesByCategory([
      expense(ExpenseCategory.FUEL, '600'),
      expense(ExpenseCategory.SALARY, '300'),
      expense(ExpenseCategory.FUEL, '0'),
      expense(ExpenseCategory.REPAIR, '100'),
    ]);
    expect(shares.map((share) => share.category)).toEqual([
      ExpenseCategory.FUEL,
      ExpenseCategory.SALARY,
      ExpenseCategory.REPAIR,
    ]);
    expect(shares[0]).toMatchObject({ amount: 600n, percent: 60 });
    expect(shares.reduce((sum, share) => sum + share.percent, 0)).toBe(100);
  });

  it('returns an empty list rather than dividing by zero', () => {
    expect(expensesByCategory([])).toEqual([]);
  });
});
