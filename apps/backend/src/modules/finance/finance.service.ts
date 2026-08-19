import { HttpStatus, Injectable } from '@nestjs/common';
import { PaymentStatus, TripStatus } from '@prisma/client';
import type {
  CategoryAmount,
  CurrentUserPayload,
  DateRange,
  ExpenseCategory,
  FinanceSummaryView,
  MonthlyProfitPoint,
  TripPnlView,
  VehicleStatsView,
} from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { DateRangeDto } from './dto/finance.dto';
import {
  amortization,
  costPerKm,
  roiBp,
  toKm10,
  tripPnl,
  type TripPnl,
} from './finance.calculator';

/** BigInt leaves the service as a decimal string — see `MoneyTiyin` in shared. */
const money = (value: bigint): string => value.toString();

const MONTHS_IN_CHART = 12;

/** The period a report covers; defaults to the current calendar month in UTC. */
export function resolveRange(dto: DateRangeDto, now = new Date()): { from: Date; to: Date } {
  const from = dto.from
    ? new Date(dto.from)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = dto.to
    ? new Date(dto.to)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
}

const asRange = (from: Date, to: Date): DateRange => ({
  from: from.toISOString(),
  to: to.toISOString(),
});

/** A trip carries its real distance once driven; before that, the plan. */
function tripKm10(trip: { actualDistanceKm: unknown; plannedDistanceKm: unknown }): number {
  const actual = toKm10(trip.actualDistanceKm as string | null);
  return actual > 0 ? actual : toKm10(trip.plannedDistanceKm as string | null);
}

function sortedCategories(totals: Map<string, bigint>): CategoryAmount[] {
  return [...totals.entries()]
    .map(([category, amount]) => ({ category: category as ExpenseCategory, amount: money(amount) }))
    .sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));
}

const TRIP_PNL_INCLUDE = {
  expenses: { select: { category: true, amount: true } },
  incomes: { select: { amount: true, status: true } },
  driver: { select: { salaryType: true, salaryValue: true } },
  vehicle: { select: { purchasePrice: true, plannedTotalKm: true, plateNumber: true } },
} as const;

type TripWithFinance = {
  id: string;
  tripNumber: string;
  agreedPrice: bigint;
  driverAdvance: bigint;
  actualDistanceKm: unknown;
  plannedDistanceKm: unknown;
  expenses: Array<{ category: string; amount: bigint }>;
  incomes: Array<{ amount: bigint; status: PaymentStatus }>;
  driver: { salaryType: string | null; salaryValue: bigint | null } | null;
  vehicle: { purchasePrice: bigint | null; plannedTotalKm: number | null } | null;
};

/** Money actually received for a trip — PARTIAL counts, PENDING does not. */
function paidIncomeOf(trip: TripWithFinance): bigint {
  return trip.incomes
    .filter(
      (income) => income.status === PaymentStatus.PAID || income.status === PaymentStatus.PARTIAL,
    )
    .reduce((sum, income) => sum + income.amount, 0n);
}

function pnlOf(trip: TripWithFinance): TripPnl {
  const paid = paidIncomeOf(trip);
  return tripPnl({
    agreedPrice: trip.agreedPrice,
    paidIncome: paid,
    expenses: trip.expenses.map((expense) => ({
      category: expense.category as ExpenseCategory,
      amount: expense.amount,
    })),
    driverAdvance: trip.driverAdvance,
    driver: trip.driver
      ? {
          salaryType: trip.driver.salaryType as never,
          salaryValue: trip.driver.salaryValue,
        }
      : null,
    vehicle: trip.vehicle,
    km10: tripKm10(trip),
  });
}

/**
 * TZ §6 in service form. Every figure here comes from `finance.calculator`;
 * this class only fetches rows and shapes the response — no arithmetic of its
 * own, so the formulas stay in one tested place.
 */
@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** W-4 «Moliya» tab. */
  async tripPnl(actor: CurrentUserPayload, tripId: string): Promise<TripPnlView> {
    const db = this.prisma.forCompany(actor.companyId);
    const trip = (await db.trip.findUnique({
      where: { id: tripId },
      include: TRIP_PNL_INCLUDE,
    })) as TripWithFinance | null;
    if (!trip) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    const result = pnlOf(trip);
    return {
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      distanceKm10: tripKm10(trip),
      revenue: money(result.revenue),
      revenueFromPayments: paidIncomeOf(trip) > 0n,
      expensesByCategory: result.expensesByCategory.map((item) => ({
        category: item.category,
        amount: money(item.amount),
      })),
      expenseTotal: money(result.expenseTotal),
      driverShare: money(result.driverShare),
      driverAdvance: money(trip.driverAdvance),
      driverBalance: money(result.driverBalance),
      amortization: money(result.amortization),
      netProfit: money(result.netProfit),
      marginBp: result.marginBp,
      costPerKm: money(result.costPerKm),
    };
  }

  /** W-5 statistics — what this vehicle earned and cost over a period. */
  async vehicleStats(
    actor: CurrentUserPayload,
    vehicleId: string,
    range: DateRangeDto,
  ): Promise<VehicleStatsView> {
    const db = this.prisma.forCompany(actor.companyId);
    const { from, to } = resolveRange(range);

    const vehicle = await db.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, plateNumber: true, purchasePrice: true, plannedTotalKm: true },
    });
    if (!vehicle) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    const trips = (await db.trip.findMany({
      where: { vehicleId, createdAt: { gte: from, lt: to } },
      include: TRIP_PNL_INCLUDE,
    })) as unknown as TripWithFinance[];

    let distanceKm10 = 0;
    let revenue = 0n;
    let expenseTotal = 0n;
    let share = 0n;
    let depreciation = 0n;

    for (const trip of trips) {
      const result = pnlOf(trip);
      distanceKm10 += tripKm10(trip);
      revenue += result.revenue;
      expenseTotal += result.expenseTotal;
      share += result.driverShare;
      depreciation += result.amortization;
    }

    const totalCost = expenseTotal + share + depreciation;
    return {
      vehicleId: vehicle.id,
      plateNumber: vehicle.plateNumber,
      range: asRange(from, to),
      tripCount: trips.length,
      distanceKm10,
      revenue: money(revenue),
      expenseTotal: money(expenseTotal),
      driverShare: money(share),
      amortization: money(depreciation),
      totalCost: money(totalCost),
      netProfit: money(revenue - totalCost),
      costPerKm: money(costPerKm({ totalCost, km10: distanceKm10 })),
      roiBp: roiBp({ revenue, cost: totalCost }),
    };
  }

  /**
   * W-1 dashboard. Company level is cash-based — payments received against
   * expenses booked — plus the depreciation of the period's trips, which no
   * expense row carries but which TZ §6 counts as a cost.
   */
  async summary(actor: CurrentUserPayload, range: DateRangeDto): Promise<FinanceSummaryView> {
    const db = this.prisma.forCompany(actor.companyId);
    const { from, to } = resolveRange(range);
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const chartFrom = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - MONTHS_IN_CHART, 1),
    );

    const [vehiclesTotal, vehiclesOnRoad, tripsToday, tripsActive, incomes, expenses, trips] =
      await Promise.all([
        db.vehicle.count({ where: { isActive: true } }),
        db.trip.count({ where: { status: TripStatus.IN_PROGRESS } }),
        db.trip.count({ where: { createdAt: { gte: startOfToday } } }),
        db.trip.count({
          where: { status: { in: [TripStatus.ASSIGNED, TripStatus.IN_PROGRESS] } },
        }),
        db.income.findMany({
          where: { OR: [{ paymentDate: { gte: chartFrom } }, { paymentDate: null }] },
          select: { amount: true, status: true, paymentDate: true, createdAt: true },
        }),
        db.expense.findMany({
          where: { expenseDate: { gte: chartFrom } },
          select: { amount: true, category: true, expenseDate: true },
        }),
        db.trip.findMany({
          where: { createdAt: { gte: from, lt: to } },
          select: {
            actualDistanceKm: true,
            plannedDistanceKm: true,
            vehicle: { select: { purchasePrice: true, plannedTotalKm: true } },
          },
        }),
      ]);

    const inRange = (date: Date | null): boolean => date !== null && date >= from && date < to;
    const isPaid = (status: PaymentStatus): boolean =>
      status === PaymentStatus.PAID || status === PaymentStatus.PARTIAL;

    let income = 0n;
    let receivable = 0n;
    let overdue = 0n;
    for (const row of incomes) {
      if (isPaid(row.status) && inRange(row.paymentDate)) income += row.amount;
      if (!isPaid(row.status)) {
        receivable += row.amount;
        if (row.status === PaymentStatus.OVERDUE) overdue += row.amount;
      }
    }

    let expenseTotal = 0n;
    const byCategory = new Map<string, bigint>();
    for (const row of expenses) {
      if (!inRange(row.expenseDate)) continue;
      expenseTotal += row.amount;
      byCategory.set(row.category, (byCategory.get(row.category) ?? 0n) + row.amount);
    }

    const depreciation = trips.reduce(
      (sum, trip) =>
        sum +
        amortization({
          purchasePrice: trip.vehicle?.purchasePrice ?? null,
          plannedTotalKm: trip.vehicle?.plannedTotalKm ?? null,
          km10: tripKm10(trip),
        }),
      0n,
    );

    return {
      range: asRange(from, to),
      vehiclesTotal,
      vehiclesOnRoad,
      tripsToday,
      tripsActive,
      income: money(income),
      expenses: money(expenseTotal),
      amortization: money(depreciation),
      netProfit: money(income - expenseTotal - depreciation),
      receivable: money(receivable),
      overdue: money(overdue),
      expensesByCategory: sortedCategories(byCategory),
      monthly: monthlySeries(incomes, expenses, to),
    };
  }
}

/** The dashboard's 12-month profit curve, bucketed by UTC month. */
export function monthlySeries(
  incomes: Array<{ amount: bigint; status: PaymentStatus; paymentDate: Date | null }>,
  expenses: Array<{ amount: bigint; expenseDate: Date }>,
  end: Date,
): MonthlyProfitPoint[] {
  const buckets = new Map<string, { income: bigint; expenses: bigint }>();
  const key = (date: Date): string =>
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

  for (let offset = MONTHS_IN_CHART - 1; offset >= 0; offset -= 1) {
    const month = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - offset - 1, 1));
    buckets.set(key(month), { income: 0n, expenses: 0n });
  }

  for (const row of incomes) {
    if (!row.paymentDate) continue;
    if (row.status !== PaymentStatus.PAID && row.status !== PaymentStatus.PARTIAL) continue;
    const bucket = buckets.get(key(row.paymentDate));
    if (bucket) bucket.income += row.amount;
  }
  for (const row of expenses) {
    const bucket = buckets.get(key(row.expenseDate));
    if (bucket) bucket.expenses += row.amount;
  }

  return [...buckets.entries()].map(([month, value]) => ({
    month,
    income: money(value.income),
    expenses: money(value.expenses),
    profit: money(value.income - value.expenses),
  }));
}
