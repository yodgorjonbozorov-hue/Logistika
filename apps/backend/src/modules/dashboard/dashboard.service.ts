import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Expense, Income, Trip } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { zonedDayRange } from '../../common/time';
import { PrismaService } from '../../prisma/prisma.service';

/** Trips a logist still has to watch (TZ §4.1 W-1 «faol reyslar»). */
const ACTIVE_TRIP_STATUSES = ['ASSIGNED', 'IN_PROGRESS'] as const;
/** Invoiced but not yet collected — the receivables KPI. */
const OPEN_PAYMENT_STATUSES = ['PENDING', 'PARTIAL', 'OVERDUE'] as const;

const ACTIVE_TRIP_LIMIT = 10;
const RECENT_TRANSACTION_LIMIT = 5;

export interface DashboardKpi {
  activeTrips: number;
  todayTrips: number;
  activeVehicles: number;
  activeDrivers: number;
  todayIncome: bigint;
  todayExpense: bigint;
  receivables: bigint;
}

export interface DashboardSummary {
  kpi: DashboardKpi;
  activeTrips: Trip[];
  recentIncomes: Income[];
  recentExpenses: Expense[];
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** W-1 dashboard: counters plus the lists the boss looks at first. */
  async summary(actor: CurrentUserPayload, now = new Date()): Promise<DashboardSummary> {
    const db = this.prisma.forCompany(actor.companyId);
    const timeZone = this.config.get<string>('DEFAULT_TIMEZONE') ?? 'UTC';
    const today = zonedDayRange(now, timeZone);
    const todayWindow = { gte: today.from, lt: today.to };

    const [
      activeTripCount,
      todayTripCount,
      activeVehicles,
      activeDrivers,
      todayIncome,
      todayExpense,
      receivables,
      activeTrips,
      recentIncomes,
      recentExpenses,
    ] = await Promise.all([
      db.trip.count({ where: { status: { in: [...ACTIVE_TRIP_STATUSES] } } }),
      db.trip.count({ where: { createdAt: todayWindow } }),
      db.vehicle.count({ where: { isActive: true, type: { not: 'TRAILER' } } }),
      db.driver.count({ where: { isActive: true } }),
      db.income.aggregate({ _sum: { amount: true }, where: { paymentDate: todayWindow } }),
      db.expense.aggregate({ _sum: { amount: true }, where: { expenseDate: todayWindow } }),
      db.income.aggregate({
        _sum: { amount: true },
        where: { status: { in: [...OPEN_PAYMENT_STATUSES] } },
      }),
      db.trip.findMany({
        where: { status: { in: [...ACTIVE_TRIP_STATUSES] } },
        orderBy: { createdAt: 'desc' },
        take: ACTIVE_TRIP_LIMIT,
        include: { client: true, vehicle: true, driver: true },
      }),
      db.income.findMany({
        orderBy: { createdAt: 'desc' },
        take: RECENT_TRANSACTION_LIMIT,
        include: { client: true, trip: { select: { id: true, tripNumber: true } } },
      }),
      db.expense.findMany({
        orderBy: { expenseDate: 'desc' },
        take: RECENT_TRANSACTION_LIMIT,
        include: { trip: { select: { id: true, tripNumber: true } } },
      }),
    ]);

    return {
      kpi: {
        activeTrips: activeTripCount,
        todayTrips: todayTripCount,
        activeVehicles,
        activeDrivers,
        todayIncome: todayIncome._sum.amount ?? 0n,
        todayExpense: todayExpense._sum.amount ?? 0n,
        receivables: receivables._sum.amount ?? 0n,
      },
      activeTrips,
      recentIncomes,
      recentExpenses,
    };
  }
}
