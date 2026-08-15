import { HttpStatus, Injectable } from '@nestjs/common';
import type { ExpenseCategory } from '@prisma/client';
import { type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { fromScaledInt, ratioBp } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';
import { periodOf, PeriodDto } from '../finance/dto/finance.dto';
import { costPerKm, roiBp } from '../finance/finance.calc';
import { FinanceService, type PeriodTotals } from '../finance/finance.service';
import type { ReportTable } from './report-table';

const MONTHS_ON_CHART = 12;

export interface DashboardCards {
  vehiclesOnRoad: number;
  vehiclesTotal: number;
  tripsToday: number;
  month: PeriodTotals;
  unreadAlerts: number;
}

export interface DashboardView extends DashboardCards {
  recentEvents: Array<{
    id: string;
    eventType: string;
    eventTime: Date;
    address: string | null;
    driverName: string | null;
    tripNumber: string | null;
  }>;
  profitTrend: Array<{ month: string; revenue: bigint; cost: bigint; profit: bigint }>;
}

/** Report ids exposed by the API (TZ W-9). */
export const REPORT_KEYS = [
  'trips',
  'vehicles',
  'routes',
  'drivers',
  'clients',
  'expenses',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
  ) {}

  /** W-1 dashboard: the six cards, the event feed and the 12-month profit chart. */
  async dashboard(actor: CurrentUserPayload, now = new Date()): Promise<DashboardView> {
    const db = this.prisma.forCompany(actor.companyId);
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const monthPeriod = periodOf(startOfMonth(now), now);

    const [activeTrips, vehiclesTotal, tripsToday, month, unreadAlerts, events, profitTrend] =
      await Promise.all([
        db.trip.findMany({ where: { status: 'IN_PROGRESS' }, select: { vehicleId: true } }),
        db.vehicle.count({ where: { isActive: true, type: { not: 'TRAILER' } } }),
        db.trip.count({ where: { createdAt: { gte: dayStart } } }),
        this.finance.summary(actor, monthPeriod),
        db.notification.count({
          where: { isRead: false, OR: [{ userId: null }, { userId: actor.userId }] },
        }),
        db.tripEvent.findMany({
          orderBy: { eventTime: 'desc' },
          take: 10,
          include: {
            driver: { select: { fullName: true } },
            trip: { select: { tripNumber: true } },
          },
        }),
        this.profitTrend(actor, now),
      ]);

    return {
      vehiclesOnRoad: new Set(activeTrips.map((trip) => trip.vehicleId).filter(Boolean)).size,
      vehiclesTotal,
      tripsToday,
      month,
      unreadAlerts,
      recentEvents: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        eventTime: event.eventTime,
        address: event.address,
        driverName: event.driver?.fullName ?? null,
        tripNumber: event.trip?.tripNumber ?? null,
      })),
      profitTrend,
    };
  }

  /** Revenue/cost/profit per month for the last 12 months (W-1 chart). */
  async profitTrend(
    actor: CurrentUserPayload,
    now = new Date(),
  ): Promise<Array<{ month: string; revenue: bigint; cost: bigint; profit: bigint }>> {
    const from = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_ON_CHART - 1), 1),
    );
    const period = periodOf(from, now);
    const db = this.prisma.forCompany(actor.companyId);

    const buckets = new Map<string, { revenue: bigint; cost: bigint }>();
    for (let index = 0; index < MONTHS_ON_CHART; index += 1) {
      const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + index, 1));
      buckets.set(monthKey(date), { revenue: 0n, cost: 0n });
    }

    const [trips, overhead] = await Promise.all([
      this.finance.tripsWithFinance(actor, period),
      db.expense.findMany({
        where: { tripId: null, expenseDate: { gte: from, lte: period.toDate } },
        select: { amount: true, expenseDate: true },
      }),
    ]);

    for (const { trip, finance } of trips) {
      const bucket = buckets.get(monthKey(trip.finishedAt ?? trip.createdAt));
      if (!bucket) continue;
      bucket.revenue += finance.income;
      bucket.cost += finance.costTotal;
    }
    for (const expense of overhead) {
      const bucket = buckets.get(monthKey(expense.expenseDate));
      if (bucket) bucket.cost += expense.amount;
    }

    return [...buckets.entries()].map(([month, value]) => ({
      month,
      revenue: value.revenue,
      cost: value.cost,
      profit: value.revenue - value.cost,
    }));
  }

  /** Builds one of the W-9 reports as a typed table. */
  async table(actor: CurrentUserPayload, key: ReportKey, period: PeriodDto): Promise<ReportTable> {
    switch (key) {
      case 'trips':
        return this.tripsReport(actor, period);
      case 'vehicles':
        return this.vehiclesReport(actor, period);
      case 'routes':
        return this.routesReport(actor, period);
      case 'drivers':
        return this.driversReport(actor, period);
      case 'clients':
        return this.clientsReport(actor, period);
      case 'expenses':
        return this.expenseStructure(actor, period);
      default:
        throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
  }

  /** «Reys bo'yicha foyda/zarar». */
  private async tripsReport(actor: CurrentUserPayload, period: PeriodDto): Promise<ReportTable> {
    const trips = await this.finance.tripsWithFinance(actor, period);
    let revenue = 0n;
    let cost = 0n;

    const rows = trips.map(({ trip, finance }) => {
      revenue += finance.income;
      cost += finance.costTotal;
      return {
        tripNumber: trip.tripNumber,
        date: trip.finishedAt,
        client: trip.client?.name ?? null,
        vehicle: trip.vehicle?.plateNumber ?? null,
        driver: trip.driver?.fullName ?? null,
        route: routeLabel(trip.loadingAddress, trip.unloadingAddress),
        distanceKm: finance.distanceKmTenths
          ? Number(fromScaledInt(finance.distanceKmTenths, 1))
          : null,
        revenue: finance.income,
        cost: finance.costTotal,
        profit: finance.profit,
        marginBp: finance.marginBp,
      };
    });

    return {
      key: 'trips',
      titleKey: 'reports.trips.title',
      columns: [
        { key: 'tripNumber', labelKey: 'reports.column.tripNumber', type: 'text' },
        { key: 'date', labelKey: 'reports.column.date', type: 'date' },
        { key: 'client', labelKey: 'reports.column.client', type: 'text' },
        { key: 'vehicle', labelKey: 'reports.column.vehicle', type: 'text' },
        { key: 'driver', labelKey: 'reports.column.driver', type: 'text' },
        { key: 'route', labelKey: 'reports.column.route', type: 'text' },
        { key: 'distanceKm', labelKey: 'reports.column.distance', type: 'km' },
        { key: 'revenue', labelKey: 'reports.column.revenue', type: 'money' },
        { key: 'cost', labelKey: 'reports.column.cost', type: 'money' },
        { key: 'profit', labelKey: 'reports.column.profit', type: 'money' },
        { key: 'marginBp', labelKey: 'reports.column.margin', type: 'percent' },
      ],
      rows,
      totals: {
        tripNumber: 'Σ',
        revenue,
        cost,
        profit: revenue - cost,
        marginBp: ratioBp(revenue - cost, revenue),
      },
    };
  }

  /** «Mashina bo'yicha rentabellik». */
  private async vehiclesReport(actor: CurrentUserPayload, period: PeriodDto): Promise<ReportTable> {
    const fleet = await this.finance.fleetEconomics(actor, period);
    let revenue = 0n;
    let cost = 0n;
    for (const row of fleet) {
      revenue += row.revenue;
      cost += row.cost;
    }

    return {
      key: 'vehicles',
      titleKey: 'reports.vehicles.title',
      columns: [
        { key: 'plateNumber', labelKey: 'reports.column.vehicle', type: 'text' },
        { key: 'tripCount', labelKey: 'reports.column.trips', type: 'number' },
        { key: 'distanceKm', labelKey: 'reports.column.distance', type: 'km' },
        { key: 'revenue', labelKey: 'reports.column.revenue', type: 'money' },
        { key: 'cost', labelKey: 'reports.column.cost', type: 'money' },
        { key: 'profit', labelKey: 'reports.column.profit', type: 'money' },
        { key: 'costPerKm', labelKey: 'reports.column.costPerKm', type: 'money' },
        { key: 'roiBp', labelKey: 'reports.column.roi', type: 'percent' },
      ],
      rows: fleet.map((row) => ({
        plateNumber: row.plateNumber,
        tripCount: row.tripCount,
        distanceKm: row.distanceKm === null ? null : Number(row.distanceKm),
        revenue: row.revenue,
        cost: row.cost,
        profit: row.profit,
        costPerKm: row.costPerKm,
        roiBp: row.roiBp,
      })),
      totals: {
        plateNumber: 'Σ',
        revenue,
        cost,
        profit: revenue - cost,
        roiBp: roiBp(revenue, cost),
      },
    };
  }

  /** «Yo'nalish bo'yicha rentabellik» — is Toshkent–Moskva worth it? */
  private async routesReport(actor: CurrentUserPayload, period: PeriodDto): Promise<ReportTable> {
    const trips = await this.finance.tripsWithFinance(actor, period);
    const byRoute = new Map<
      string,
      { tripCount: number; distanceTenths: bigint; revenue: bigint; cost: bigint }
    >();

    for (const { trip, finance } of trips) {
      const label = routeLabel(trip.loadingAddress, trip.unloadingAddress);
      const row = byRoute.get(label) ?? {
        tripCount: 0,
        distanceTenths: 0n,
        revenue: 0n,
        cost: 0n,
      };
      row.tripCount += 1;
      row.distanceTenths += finance.distanceKmTenths ?? 0n;
      row.revenue += finance.income;
      row.cost += finance.costTotal;
      byRoute.set(label, row);
    }

    const rows = [...byRoute.entries()]
      .map(([route, value]) => ({
        route,
        tripCount: value.tripCount,
        distanceKm: value.distanceTenths ? Number(fromScaledInt(value.distanceTenths, 1)) : null,
        revenue: value.revenue,
        cost: value.cost,
        profit: value.revenue - value.cost,
        profitPerKm: costPerKm(value.revenue - value.cost, 0n, value.distanceTenths || null),
        marginBp: ratioBp(value.revenue - value.cost, value.revenue),
      }))
      .sort((a, b) => Number(b.profit - a.profit));

    return {
      key: 'routes',
      titleKey: 'reports.routes.title',
      columns: [
        { key: 'route', labelKey: 'reports.column.route', type: 'text' },
        { key: 'tripCount', labelKey: 'reports.column.trips', type: 'number' },
        { key: 'distanceKm', labelKey: 'reports.column.distance', type: 'km' },
        { key: 'revenue', labelKey: 'reports.column.revenue', type: 'money' },
        { key: 'cost', labelKey: 'reports.column.cost', type: 'money' },
        { key: 'profit', labelKey: 'reports.column.profit', type: 'money' },
        { key: 'profitPerKm', labelKey: 'reports.column.profitPerKm', type: 'money' },
        { key: 'marginBp', labelKey: 'reports.column.margin', type: 'percent' },
      ],
      rows,
    };
  }

  /** «Haydovchi bo'yicha samaradorlik». */
  private async driversReport(actor: CurrentUserPayload, period: PeriodDto): Promise<ReportTable> {
    const trips = await this.finance.tripsWithFinance(actor, period);
    const byDriver = new Map<
      string,
      {
        driver: string;
        tripCount: number;
        distanceTenths: bigint;
        revenue: bigint;
        share: bigint;
        profit: bigint;
      }
    >();

    for (const { trip, finance } of trips) {
      const key = trip.driverId ?? '—';
      const row = byDriver.get(key) ?? {
        driver: trip.driver?.fullName ?? '—',
        tripCount: 0,
        distanceTenths: 0n,
        revenue: 0n,
        share: 0n,
        profit: 0n,
      };
      row.tripCount += 1;
      row.distanceTenths += finance.distanceKmTenths ?? 0n;
      row.revenue += finance.income;
      row.share += finance.driverShare;
      row.profit += finance.profit;
      byDriver.set(key, row);
    }

    return {
      key: 'drivers',
      titleKey: 'reports.drivers.title',
      columns: [
        { key: 'driver', labelKey: 'reports.column.driver', type: 'text' },
        { key: 'tripCount', labelKey: 'reports.column.trips', type: 'number' },
        { key: 'distanceKm', labelKey: 'reports.column.distance', type: 'km' },
        { key: 'revenue', labelKey: 'reports.column.revenue', type: 'money' },
        { key: 'driverShare', labelKey: 'reports.column.driverShare', type: 'money' },
        { key: 'profit', labelKey: 'reports.column.profit', type: 'money' },
      ],
      rows: [...byDriver.values()]
        .map((row) => ({
          driver: row.driver,
          tripCount: row.tripCount,
          distanceKm: row.distanceTenths ? Number(fromScaledInt(row.distanceTenths, 1)) : null,
          revenue: row.revenue,
          driverShare: row.share,
          profit: row.profit,
        }))
        .sort((a, b) => Number(b.profit - a.profit)),
    };
  }

  /** «Mijoz bo'yicha aylanma» — turnover and what is still owed. */
  private async clientsReport(actor: CurrentUserPayload, period: PeriodDto): Promise<ReportTable> {
    const [trips, receivables] = await Promise.all([
      this.finance.tripsWithFinance(actor, period),
      this.finance.receivables(actor),
    ]);
    const debtByClient = new Map(receivables.map((row) => [row.clientId ?? '—', row.total]));

    const byClient = new Map<
      string,
      { client: string; tripCount: number; revenue: bigint; profit: bigint }
    >();
    for (const { trip, finance } of trips) {
      const key = trip.clientId ?? '—';
      const row = byClient.get(key) ?? {
        client: trip.client?.name ?? '—',
        tripCount: 0,
        revenue: 0n,
        profit: 0n,
      };
      row.tripCount += 1;
      row.revenue += finance.income;
      row.profit += finance.profit;
      byClient.set(key, row);
    }

    return {
      key: 'clients',
      titleKey: 'reports.clients.title',
      columns: [
        { key: 'client', labelKey: 'reports.column.client', type: 'text' },
        { key: 'tripCount', labelKey: 'reports.column.trips', type: 'number' },
        { key: 'revenue', labelKey: 'reports.column.revenue', type: 'money' },
        { key: 'profit', labelKey: 'reports.column.profit', type: 'money' },
        { key: 'debt', labelKey: 'reports.column.debt', type: 'money' },
      ],
      rows: [...byClient.entries()]
        .map(([clientId, row]) => ({
          client: row.client,
          tripCount: row.tripCount,
          revenue: row.revenue,
          profit: row.profit,
          debt: debtByClient.get(clientId) ?? 0n,
        }))
        .sort((a, b) => Number(b.revenue - a.revenue)),
    };
  }

  /** «Xarajat strukturasi» — the pie chart behind W-9. */
  private async expenseStructure(
    actor: CurrentUserPayload,
    period: PeriodDto,
  ): Promise<ReportTable> {
    const summary = await this.finance.summary(actor, period);
    const entries = Object.entries(summary.expensesByCategory) as Array<[ExpenseCategory, bigint]>;
    const total = entries.reduce((sum, [, amount]) => sum + amount, 0n);

    return {
      key: 'expenses',
      titleKey: 'reports.expenses.title',
      columns: [
        { key: 'category', labelKey: 'reports.column.category', type: 'text' },
        { key: 'amount', labelKey: 'reports.column.amount', type: 'money' },
        { key: 'shareBp', labelKey: 'reports.column.share', type: 'percent' },
      ],
      rows: entries
        .map(([category, amount]) => ({
          category,
          amount,
          shareBp: ratioBp(amount, total),
        }))
        .sort((a, b) => Number(b.amount - a.amount)),
      totals: { category: 'Σ', amount: total, shareBp: total === 0n ? null : 10_000 },
    };
  }
}

function routeLabel(from: string | null, to: string | null): string {
  return `${from ?? '—'} → ${to ?? '—'}`;
}
