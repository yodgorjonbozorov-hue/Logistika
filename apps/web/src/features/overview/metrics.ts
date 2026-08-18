/**
 * Dashboard arithmetic. Pure functions over the API entities so the numbers on
 * the overview screen are testable and never computed inside JSX.
 * Money is BigInt tiyin throughout — floats are forbidden (CLAUDE.md).
 */
import { PaymentStatus, TripStatus } from 'shared';
import type { Client, Expense, Income, Trip } from '../../shared/api/entities';
import { OPEN_TRIP_STATUSES } from '../../shared/utils/status';

export type StatusCounts = Record<TripStatus, number>;

export function countByStatus(trips: readonly Trip[]): StatusCounts {
  const counts = Object.fromEntries(
    Object.values(TripStatus).map((status) => [status, 0]),
  ) as StatusCounts;
  for (const trip of trips) counts[trip.status] += 1;
  return counts;
}

/** Trips still needing work — the dashboard's "active" figure. */
export function openTrips(trips: readonly Trip[]): Trip[] {
  return trips.filter((trip) => OPEN_TRIP_STATUSES.includes(trip.status));
}

export function isSameMonth(iso: string | null, reference: Date): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  return date.getFullYear() === reference.getFullYear() && date.getMonth() === reference.getMonth();
}

export function completedThisMonth(trips: readonly Trip[], reference: Date): Trip[] {
  return trips.filter(
    (trip) => trip.status === TripStatus.COMPLETED && isSameMonth(trip.finishedAt, reference),
  );
}

export interface DayBucket {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  count: number;
}

/**
 * Completed trips per day for the last `days` days, oldest first — the source
 * of the dashboard's 14-bar dynamics chart.
 */
export function completedPerDay(
  trips: readonly Trip[],
  days: number,
  reference: Date,
): DayBucket[] {
  const buckets = new Map<string, number>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(reference);
    date.setDate(date.getDate() - offset);
    buckets.set(localDay(date), 0);
  }
  for (const trip of trips) {
    if (trip.status !== TripStatus.COMPLETED || !trip.finishedAt) continue;
    const day = localDay(new Date(trip.finishedAt));
    const current = buckets.get(day);
    if (current !== undefined) buckets.set(day, current + 1);
  }
  return [...buckets].map(([day, count]) => ({ day, count }));
}

/** Local (not UTC) calendar day — users read the chart in their own timezone. */
export function localDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const dayOfMonth = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

export function sumAmounts(rows: ReadonlyArray<{ amount: string }>): bigint {
  return rows.reduce((total, row) => total + BigInt(row.amount), 0n);
}

export interface IncomeTotals {
  total: bigint;
  paid: bigint;
  pending: bigint;
  overdue: bigint;
}

export function incomeTotals(incomes: readonly Income[]): IncomeTotals {
  const totals: IncomeTotals = { total: 0n, paid: 0n, pending: 0n, overdue: 0n };
  for (const income of incomes) {
    const amount = BigInt(income.amount);
    totals.total += amount;
    if (income.status === PaymentStatus.PAID) totals.paid += amount;
    else if (income.status === PaymentStatus.OVERDUE) totals.overdue += amount;
    else totals.pending += amount;
  }
  return totals;
}

/** Outstanding client debt — the sum of positive balances. */
export function receivables(clients: readonly Client[]): bigint {
  return clients.reduce((total, client) => {
    const balance = BigInt(client.balance);
    return balance > 0n ? total + balance : total;
  }, 0n);
}

export interface CategoryShare {
  category: string;
  amount: bigint;
  percent: number;
}

/** Expense totals per category, largest first — the reports breakdown. */
export function expensesByCategory(expenses: readonly Expense[]): CategoryShare[] {
  const totals = new Map<string, bigint>();
  let grand = 0n;
  for (const expense of expenses) {
    const amount = BigInt(expense.amount);
    totals.set(expense.category, (totals.get(expense.category) ?? 0n) + amount);
    grand += amount;
  }
  return [...totals]
    .map(([category, amount]) => ({
      category,
      amount,
      percent: grand === 0n ? 0 : Number((amount * 1000n) / grand) / 10,
    }))
    .sort((a, b) => (a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : 0));
}

/** Ids of vehicles/drivers currently carrying an open trip. */
export function busyResourceIds(trips: readonly Trip[]): {
  vehicles: Set<string>;
  drivers: Set<string>;
} {
  const vehicles = new Set<string>();
  const drivers = new Set<string>();
  for (const trip of openTrips(trips)) {
    if (trip.vehicleId) vehicles.add(trip.vehicleId);
    if (trip.driverId) drivers.add(trip.driverId);
  }
  return { vehicles, drivers };
}

/** Segments of the status donut, in the design's order, skipping empty slices. */
export function donutSegments(counts: StatusCounts): Array<{ status: TripStatus; count: number }> {
  const order: TripStatus[] = [
    TripStatus.IN_PROGRESS,
    TripStatus.ASSIGNED,
    TripStatus.COMPLETED,
    TripStatus.DRAFT,
    TripStatus.CANCELLED,
  ];
  return order.map((status) => ({ status, count: counts[status] })).filter((s) => s.count > 0);
}
