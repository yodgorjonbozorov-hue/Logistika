import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import {
  amortizationTiyin,
  costPerKmTiyin,
  driverShareTiyin,
  roiPercent,
} from '../finance/finance.calc';
import { tripDistanceKm } from '../finance/finance.service';

export const PROFIT_GROUPS = ['trip', 'vehicle', 'route', 'driver', 'client'] as const;
export type ProfitGroup = (typeof PROFIT_GROUPS)[number];

/** One row of the W-9 profit report (per trip/vehicle/route/driver/client). */
export interface ProfitRow {
  key: string;
  label: string;
  tripCount: number;
  distanceKm: number;
  income: bigint;
  expenses: bigint;
  driverShare: bigint;
  amortization: bigint;
  totalCost: bigint;
  profit: bigint;
  costPerKm: bigint | null;
  roiPercent: number | null;
}

export interface ExpenseStructureRow {
  category: string;
  amount: bigint;
  sharePercent: number;
}

export interface DashboardData {
  vehiclesOnRoute: number;
  vehiclesTotal: number;
  todayTrips: number;
  monthIncome: bigint;
  monthExpense: bigint;
  monthProfit: bigint;
  unreadAlerts: number;
  recentEvents: Array<{
    id: string;
    eventType: string;
    eventTime: Date;
    address: string | null;
    driverName: string | null;
    tripNumber: string | null;
  }>;
  /** Last 12 calendar months, oldest first. */
  profitSeries: Array<{ month: string; income: bigint; expense: bigint; profit: bigint }>;
}

type TripWithRelations = Prisma.TripGetPayload<{
  include: { vehicle: true; driver: true; client: true };
}>;

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** W-9: profit grouped by trip / vehicle / route / driver / client (TZ §6). */
  async profit(
    actor: CurrentUserPayload,
    groupBy: ProfitGroup,
    from: Date,
    to: Date,
  ): Promise<ProfitRow[]> {
    const db = this.prisma.forCompany(actor.companyId);
    const trips = (await db.trip.findMany({
      where: { status: 'COMPLETED', finishedAt: { gte: from, lte: to } },
      include: { vehicle: true, driver: true, client: true },
    })) as TripWithRelations[];

    const expensesByTrip = new Map<string, { total: bigint; salary: bigint }>();
    if (trips.length > 0) {
      const expenses = await db.expense.findMany({
        where: { tripId: { in: trips.map((t) => t.id) } },
      });
      for (const expense of expenses) {
        if (!expense.tripId) continue;
        const entry = expensesByTrip.get(expense.tripId) ?? { total: 0n, salary: 0n };
        entry.total += expense.amount;
        if (expense.category === 'SALARY') entry.salary += expense.amount;
        expensesByTrip.set(expense.tripId, entry);
      }
    }

    const rows = new Map<string, ProfitRow>();
    for (const trip of trips) {
      const distanceKm = tripDistanceKm(trip);
      const tripExpenses = expensesByTrip.get(trip.id) ?? { total: 0n, salary: 0n };
      // Same rule as trip P&L: explicit SALARY expenses replace the computed share.
      const driverShare =
        tripExpenses.salary > 0n
          ? 0n
          : driverShareTiyin(
              trip.driver?.salaryType ?? null,
              trip.driver?.salaryValue ?? null,
              trip.agreedPrice,
              distanceKm,
            );
      const amortization = amortizationTiyin(
        trip.vehicle?.purchasePrice ?? null,
        trip.vehicle?.plannedTotalKm ?? null,
        distanceKm,
      );

      const { key, label } = this.groupKey(groupBy, trip);
      const row = rows.get(key) ?? {
        key,
        label,
        tripCount: 0,
        distanceKm: 0,
        income: 0n,
        expenses: 0n,
        driverShare: 0n,
        amortization: 0n,
        totalCost: 0n,
        profit: 0n,
        costPerKm: null,
        roiPercent: null,
      };
      row.tripCount += 1;
      row.distanceKm += distanceKm;
      row.income += trip.agreedPrice;
      row.expenses += tripExpenses.total;
      row.driverShare += driverShare;
      row.amortization += amortization;
      rows.set(key, row);
    }

    return [...rows.values()]
      .map((row) => {
        const totalCost = row.expenses + row.driverShare + row.amortization;
        return {
          ...row,
          totalCost,
          profit: row.income - totalCost,
          costPerKm: costPerKmTiyin(totalCost, row.distanceKm),
          roiPercent: roiPercent(row.income, totalCost),
        };
      })
      .sort((a, b) => (a.profit > b.profit ? -1 : 1));
  }

  /** W-9 pirog diagramma: expense totals by category over a period. */
  async expenseStructure(
    actor: CurrentUserPayload,
    from: Date,
    to: Date,
  ): Promise<ExpenseStructureRow[]> {
    const expenses = await this.prisma
      .forCompany(actor.companyId)
      .expense.findMany({ where: { expenseDate: { gte: from, lte: to } } });

    const byCategory = new Map<string, bigint>();
    let total = 0n;
    for (const expense of expenses) {
      byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0n) + expense.amount);
      total += expense.amount;
    }
    return [...byCategory.entries()]
      .map(([category, amount]) => ({
        category,
        amount,
        sharePercent: total > 0n ? Number((amount * 10_000n) / total) / 100 : 0,
      }))
      .sort((a, b) => (a.amount > b.amount ? -1 : 1));
  }

  /** W-1: the six cards, the event feed and the 12-month profit chart. */
  async dashboard(actor: CurrentUserPayload): Promise<DashboardData> {
    const db = this.prisma.forCompany(actor.companyId);
    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const yearAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

    const [
      vehiclesTotal,
      inProgressTrips,
      todayTrips,
      completedTrips,
      expenses,
      unreadAlerts,
      recentEvents,
    ] = await Promise.all([
      db.vehicle.count({ where: { isActive: true, type: { not: 'TRAILER' } } }),
      db.trip.findMany({ where: { status: 'IN_PROGRESS' }, select: { vehicleId: true } }),
      db.trip.count({
        where: {
          OR: [
            { startedAt: { gte: todayStart } },
            { loadingDate: { gte: todayStart, lte: new Date(todayStart.getTime() + 86_400_000) } },
          ],
        },
      }),
      db.trip.findMany({
        where: { status: 'COMPLETED', finishedAt: { gte: yearAgo } },
        select: { agreedPrice: true, finishedAt: true },
      }),
      db.expense.findMany({
        where: { expenseDate: { gte: yearAgo } },
        select: { amount: true, expenseDate: true },
      }),
      db.notification.count({ where: { isRead: false } }),
      db.tripEvent.findMany({
        orderBy: { eventTime: 'desc' },
        take: 10,
        include: { driver: true, trip: true },
      }),
    ]);

    // 12-month series, oldest month first.
    const series = new Map<string, { income: bigint; expense: bigint }>();
    for (let i = 11; i >= 0; i -= 1) {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      series.set(monthKey(month), { income: 0n, expense: 0n });
    }
    for (const trip of completedTrips) {
      if (!trip.finishedAt) continue;
      const bucket = series.get(monthKey(trip.finishedAt));
      if (bucket) bucket.income += trip.agreedPrice;
    }
    for (const expense of expenses) {
      const bucket = series.get(monthKey(expense.expenseDate));
      if (bucket) bucket.expense += expense.amount;
    }

    const currentMonth = series.get(monthKey(monthStart)) ?? { income: 0n, expense: 0n };

    return {
      vehiclesOnRoute: new Set(inProgressTrips.map((t) => t.vehicleId).filter(Boolean)).size,
      vehiclesTotal,
      todayTrips,
      monthIncome: currentMonth.income,
      monthExpense: currentMonth.expense,
      monthProfit: currentMonth.income - currentMonth.expense,
      unreadAlerts,
      recentEvents: recentEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        eventTime: event.eventTime,
        address: event.address,
        driverName: event.driver?.fullName ?? null,
        tripNumber: event.trip?.tripNumber ?? null,
      })),
      profitSeries: [...series.entries()].map(([month, value]) => ({
        month,
        income: value.income,
        expense: value.expense,
        profit: value.income - value.expense,
      })),
    };
  }

  private groupKey(groupBy: ProfitGroup, trip: TripWithRelations): { key: string; label: string } {
    switch (groupBy) {
      case 'trip':
        return { key: trip.id, label: trip.tripNumber };
      case 'vehicle':
        return trip.vehicle
          ? { key: trip.vehicle.id, label: trip.vehicle.plateNumber }
          : { key: '—', label: '—' };
      case 'route': {
        const label = `${trip.loadingAddress ?? '—'} → ${trip.unloadingAddress ?? '—'}`;
        return { key: label, label };
      }
      case 'driver':
        return trip.driver
          ? { key: trip.driver.id, label: trip.driver.fullName }
          : { key: '—', label: '—' };
      case 'client':
        return trip.client
          ? { key: trip.client.id, label: trip.client.name }
          : { key: '—', label: '—' };
      default:
        throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST);
    }
  }
}
