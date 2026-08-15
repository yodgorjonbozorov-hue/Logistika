import { HttpStatus, Injectable } from '@nestjs/common';
import type { ExpenseCategory, Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { fromScaledInt } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';
import {
  calcTripFinance,
  costPerKm,
  roiBp,
  tripDistanceKmTenths,
  type ExpenseLine,
  type TripFinance,
} from './finance.calc';
import { PeriodDto } from './dto/finance.dto';

/**
 * Money reporting rules used across this module (documented once, applied everywhere):
 *
 * - Revenue is recognised on the TRIP (accrual): a completed trip's agreed price is the
 *   income. The `incomes` table is the payment ledger; only incomes NOT linked to a trip
 *   are added on top, so client payments for a trip are never counted twice.
 * - Trip-linked expenses, the driver share and depreciation come from `calcTripFinance`.
 *   Expenses with no trip (office, taxes, fixed salaries…) are added as period overhead.
 * - `maintenance.cost` is service history, not a ledger entry — repairs enter the P&L as
 *   REPAIR/PARTS expenses. Counting both would double the cost.
 */

/** Selection every P&L query needs: the trip plus what the formulas depend on. */
const TRIP_FINANCE_INCLUDE = {
  expenses: { select: { category: true, amount: true } },
  vehicle: { select: { id: true, plateNumber: true, purchasePrice: true, plannedTotalKm: true } },
  driver: { select: { id: true, fullName: true, salaryType: true, salaryValue: true } },
  client: { select: { id: true, name: true } },
} satisfies Prisma.TripInclude;

type TripWithFinance = Prisma.TripGetPayload<{ include: typeof TRIP_FINANCE_INCLUDE }>;

export interface TripFinanceView extends Omit<TripFinance, 'distanceKmTenths'> {
  tripId: string;
  tripNumber: string;
  distanceKm: string | null;
}

export interface PeriodTotals {
  from: Date;
  to: Date;
  revenue: bigint;
  tripCost: bigint;
  overhead: bigint;
  cost: bigint;
  profit: bigint;
  marginBp: number | null;
  tripCount: number;
  distanceKm: string | null;
  costPerKm: bigint | null;
  expensesByCategory: Partial<Record<ExpenseCategory, bigint>>;
}

export interface VehicleEconomics {
  vehicleId: string;
  plateNumber: string;
  tripCount: number;
  distanceKm: string | null;
  revenue: bigint;
  cost: bigint;
  profit: bigint;
  depreciation: bigint;
  costPerKm: bigint | null;
  roiBp: number | null;
}

function financeOf(trip: TripWithFinance): TripFinance {
  return calcTripFinance({
    agreedPrice: trip.agreedPrice,
    expenses: trip.expenses as ExpenseLine[],
    distanceKmTenths: tripDistanceKmTenths(trip),
    vehicle: trip.vehicle,
    driver: trip.driver,
  });
}

function toView(trip: TripWithFinance, finance: TripFinance): TripFinanceView {
  const { distanceKmTenths, ...rest } = finance;
  return {
    tripId: trip.id,
    tripNumber: trip.tripNumber,
    distanceKm: distanceKmTenths === null ? null : fromScaledInt(distanceKmTenths, 1),
    ...rest,
  };
}

function addCategories(
  target: Partial<Record<ExpenseCategory, bigint>>,
  source: Partial<Record<ExpenseCategory, bigint>>,
): void {
  for (const [category, amount] of Object.entries(source) as Array<[ExpenseCategory, bigint]>) {
    target[category] = (target[category] ?? 0n) + amount;
  }
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** W-4 «Moliya» tab: the full P&L of one trip. */
  async tripPnl(actor: CurrentUserPayload, tripId: string): Promise<TripFinanceView> {
    const trip = await this.prisma
      .forCompany(actor.companyId)
      .trip.findUnique({ where: { id: tripId }, include: TRIP_FINANCE_INCLUDE });
    if (!trip) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return toView(trip, financeOf(trip));
  }

  /**
   * Trips of a period (completed ones carry the revenue) together with their P&L.
   * `where` narrows the set further — by vehicle, driver, client or route.
   */
  async tripsWithFinance(
    actor: CurrentUserPayload,
    period: PeriodDto,
    where: Prisma.TripWhereInput = {},
  ): Promise<Array<{ trip: TripWithFinance; finance: TripFinance }>> {
    const trips = await this.prisma.forCompany(actor.companyId).trip.findMany({
      where: {
        ...where,
        status: 'COMPLETED',
        finishedAt: { gte: period.fromDate, lte: period.toDate },
      },
      include: TRIP_FINANCE_INCLUDE,
      orderBy: { finishedAt: 'desc' },
    });
    return trips.map((trip) => ({ trip, finance: financeOf(trip) }));
  }

  /** W-1 dashboard / W-7 finance: company totals for a period. */
  async summary(actor: CurrentUserPayload, period: PeriodDto): Promise<PeriodTotals> {
    const db = this.prisma.forCompany(actor.companyId);
    const [trips, overheadExpenses, standaloneIncomes] = await Promise.all([
      this.tripsWithFinance(actor, period),
      db.expense.findMany({
        where: { tripId: null, expenseDate: { gte: period.fromDate, lte: period.toDate } },
        select: { category: true, amount: true },
      }),
      db.income.aggregate({
        where: { tripId: null, paymentDate: { gte: period.fromDate, lte: period.toDate } },
        _sum: { amount: true },
      }),
    ]);

    const expensesByCategory: Partial<Record<ExpenseCategory, bigint>> = {};
    let revenue = standaloneIncomes._sum.amount ?? 0n;
    let tripCost = 0n;
    let distanceKmTenths = 0n;
    let hasDistance = false;

    for (const { finance } of trips) {
      revenue += finance.income;
      tripCost += finance.costTotal;
      addCategories(expensesByCategory, finance.expensesByCategory);
      if (finance.driverShare > 0n) {
        expensesByCategory.SALARY = (expensesByCategory.SALARY ?? 0n) + finance.driverShare;
      }
      if (finance.distanceKmTenths) {
        distanceKmTenths += finance.distanceKmTenths;
        hasDistance = true;
      }
    }

    let overhead = 0n;
    for (const expense of overheadExpenses) {
      overhead += expense.amount;
      expensesByCategory[expense.category] =
        (expensesByCategory[expense.category] ?? 0n) + expense.amount;
    }

    const cost = tripCost + overhead;
    const profit = revenue - cost;
    return {
      from: period.fromDate,
      to: period.toDate,
      revenue,
      tripCost,
      overhead,
      cost,
      profit,
      marginBp: revenue === 0n ? null : Number((profit * 10_000n) / revenue),
      tripCount: trips.length,
      distanceKm: hasDistance ? fromScaledInt(distanceKmTenths, 1) : null,
      costPerKm: hasDistance ? costPerKm(cost, 0n, distanceKmTenths) : null,
      expensesByCategory,
    };
  }

  /** W-5 statistics / W-9 «Mashina bo'yicha rentabellik». */
  async fleetEconomics(actor: CurrentUserPayload, period: PeriodDto): Promise<VehicleEconomics[]> {
    const db = this.prisma.forCompany(actor.companyId);
    const [vehicles, trips, vehicleExpenses] = await Promise.all([
      db.vehicle.findMany({
        where: { isActive: true, type: { not: 'TRAILER' } },
        select: { id: true, plateNumber: true },
        orderBy: { plateNumber: 'asc' },
      }),
      this.tripsWithFinance(actor, period),
      db.expense.findMany({
        where: {
          tripId: null,
          vehicleId: { not: null },
          expenseDate: { gte: period.fromDate, lte: period.toDate },
        },
        select: { vehicleId: true, amount: true },
      }),
    ]);

    const byVehicle = new Map<string, VehicleEconomics>(
      vehicles.map((vehicle) => [
        vehicle.id,
        {
          vehicleId: vehicle.id,
          plateNumber: vehicle.plateNumber,
          tripCount: 0,
          distanceKm: null,
          revenue: 0n,
          cost: 0n,
          profit: 0n,
          depreciation: 0n,
          costPerKm: null,
          roiBp: null,
        },
      ]),
    );
    const distanceByVehicle = new Map<string, bigint>();

    for (const { trip, finance } of trips) {
      const row = trip.vehicleId ? byVehicle.get(trip.vehicleId) : undefined;
      if (!row) continue;
      row.tripCount += 1;
      row.revenue += finance.income;
      row.cost += finance.costTotal;
      row.depreciation += finance.depreciation;
      if (finance.distanceKmTenths) {
        distanceByVehicle.set(
          trip.vehicleId as string,
          (distanceByVehicle.get(trip.vehicleId as string) ?? 0n) + finance.distanceKmTenths,
        );
      }
    }

    for (const expense of vehicleExpenses) {
      const row = expense.vehicleId ? byVehicle.get(expense.vehicleId) : undefined;
      if (row) row.cost += expense.amount;
    }

    return [...byVehicle.values()].map((row) => {
      const distance = distanceByVehicle.get(row.vehicleId) ?? null;
      return {
        ...row,
        profit: row.revenue - row.cost,
        distanceKm: distance === null ? null : fromScaledInt(distance, 1),
        costPerKm: costPerKm(row.cost, 0n, distance),
        roiBp: roiBp(row.revenue, row.cost),
      };
    });
  }

  /** W-7 «Qarzdorlar»: who owes how much, oldest debt first. */
  async receivables(actor: CurrentUserPayload): Promise<
    Array<{
      clientId: string | null;
      clientName: string | null;
      pending: bigint;
      overdue: bigint;
      total: bigint;
      oldestDate: Date | null;
    }>
  > {
    const db = this.prisma.forCompany(actor.companyId);
    const incomes = await db.income.findMany({
      where: { status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } },
      select: {
        clientId: true,
        amount: true,
        status: true,
        createdAt: true,
        client: { select: { name: true } },
      },
    });

    const byClient = new Map<
      string,
      {
        clientId: string | null;
        clientName: string | null;
        pending: bigint;
        overdue: bigint;
        total: bigint;
        oldestDate: Date | null;
      }
    >();
    for (const income of incomes) {
      const key = income.clientId ?? '—';
      const row = byClient.get(key) ?? {
        clientId: income.clientId,
        clientName: income.client?.name ?? null,
        pending: 0n,
        overdue: 0n,
        total: 0n,
        oldestDate: null,
      };
      if (income.status === 'OVERDUE') row.overdue += income.amount;
      else row.pending += income.amount;
      row.total += income.amount;
      if (!row.oldestDate || income.createdAt < row.oldestDate) row.oldestDate = income.createdAt;
      byClient.set(key, row);
    }

    return [...byClient.values()].sort((a, b) => (b.total > a.total ? 1 : -1));
  }
}
