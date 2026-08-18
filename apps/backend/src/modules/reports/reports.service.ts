import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { CurrentUserPayload, Currency, ExpenseCategory, PaymentStatus } from 'shared';
import type { TripStatus } from 'shared';
import { zonedDayRange, zonedDaysAgo, zonedMonthKey } from '../../common/time';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_RANGE_DAYS = 30;

export interface ReportRange {
  from: Date;
  to: Date;
}

export interface TripsReport {
  range: ReportRange;
  total: number;
  byStatus: Array<{ status: TripStatus; count: number; agreedTotal: bigint }>;
  byMonth: Array<{ month: string; count: number; agreedTotal: bigint }>;
}

export interface FinanceReport {
  range: ReportRange;
  incomeTotal: bigint;
  expenseTotal: bigint;
  net: bigint;
  expenseByCategory: Array<{ category: ExpenseCategory; count: number; amount: bigint }>;
  incomeByStatus: Array<{ status: PaymentStatus; count: number; amount: bigint }>;
  byMonth: Array<{ month: string; income: bigint; expense: bigint }>;
  /** Non-UZS rows are listed apart: cross-currency sums need FX rates (Finance Core). */
  otherCurrencies: Array<{ currency: Currency; income: bigint; expense: bigint }>;
}

export interface VehicleReportRow {
  vehicleId: string;
  plateNumber: string;
  brand: string | null;
  model: string | null;
  trips: number;
  distanceKm: Prisma.Decimal | null;
  revenue: bigint;
  expenses: bigint;
}

export interface DriverReportRow {
  driverId: string;
  fullName: string;
  trips: number;
  completedTrips: number;
  distanceKm: Prisma.Decimal | null;
  revenue: bigint;
}

/**
 * Deterministic aggregation over rows that already exist (trips, incomes,
 * expenses) — no estimates, no AI. The derived TZ §6 metrics (amortization,
 * cost per km, ROI, driver payroll) belong to the finance module and are NOT
 * invented here; the web marks them «Coming in Finance Core».
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get timeZone(): string {
    return this.config.get<string>('DEFAULT_TIMEZONE') ?? 'UTC';
  }

  resolveRange(from?: string, to?: string, now = new Date()): ReportRange {
    const zone = this.timeZone;
    return {
      from: from ? new Date(from) : zonedDaysAgo(now, zone, DEFAULT_RANGE_DAYS),
      to: to ? new Date(to) : zonedDayRange(now, zone).to,
    };
  }

  async trips(actor: CurrentUserPayload, range: ReportRange): Promise<TripsReport> {
    const db = this.prisma.forCompany(actor.companyId);
    const where = { createdAt: { gte: range.from, lt: range.to } };

    const [grouped, rows] = await Promise.all([
      db.trip.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { agreedPrice: true },
      }),
      db.trip.findMany({ where, select: { createdAt: true, agreedPrice: true } }),
    ]);

    const months = new Map<string, { count: number; agreedTotal: bigint }>();
    for (const row of rows) {
      const key = zonedMonthKey(row.createdAt, this.timeZone);
      const bucket = months.get(key) ?? { count: 0, agreedTotal: 0n };
      bucket.count += 1;
      bucket.agreedTotal += row.agreedPrice;
      months.set(key, bucket);
    }

    return {
      range,
      total: rows.length,
      byStatus: grouped.map((group) => ({
        status: group.status as TripStatus,
        count: group._count._all,
        agreedTotal: group._sum.agreedPrice ?? 0n,
      })),
      byMonth: [...months.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, bucket]) => ({ month, ...bucket })),
    };
  }

  async finance(actor: CurrentUserPayload, range: ReportRange): Promise<FinanceReport> {
    const db = this.prisma.forCompany(actor.companyId);
    const incomeWhere = { paymentDate: { gte: range.from, lt: range.to } };
    const expenseWhere = { expenseDate: { gte: range.from, lt: range.to } };

    const [byCategory, byStatus, incomeRows, expenseRows] = await Promise.all([
      db.expense.groupBy({
        by: ['category'],
        where: { ...expenseWhere, currency: 'UZS' },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      db.income.groupBy({
        by: ['status'],
        where: { ...incomeWhere, currency: 'UZS' },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      db.income.findMany({
        where: incomeWhere,
        select: { paymentDate: true, amount: true, currency: true },
      }),
      db.expense.findMany({
        where: expenseWhere,
        select: { expenseDate: true, amount: true, currency: true },
      }),
    ]);

    const months = new Map<string, { income: bigint; expense: bigint }>();
    const bucketOf = (key: string) => months.get(key) ?? { income: 0n, expense: 0n };
    const others = new Map<Currency, { income: bigint; expense: bigint }>();
    const otherOf = (currency: Currency) => others.get(currency) ?? { income: 0n, expense: 0n };

    let incomeTotal = 0n;
    for (const row of incomeRows) {
      if (row.currency !== 'UZS') {
        const currency = row.currency as Currency;
        const bucket = otherOf(currency);
        others.set(currency, { ...bucket, income: bucket.income + row.amount });
        continue;
      }
      incomeTotal += row.amount;
      // paymentDate is the filter above, so it is never null here.
      const key = zonedMonthKey(row.paymentDate as Date, this.timeZone);
      const bucket = bucketOf(key);
      months.set(key, { ...bucket, income: bucket.income + row.amount });
    }

    let expenseTotal = 0n;
    for (const row of expenseRows) {
      if (row.currency !== 'UZS') {
        const currency = row.currency as Currency;
        const bucket = otherOf(currency);
        others.set(currency, { ...bucket, expense: bucket.expense + row.amount });
        continue;
      }
      expenseTotal += row.amount;
      const key = zonedMonthKey(row.expenseDate, this.timeZone);
      const bucket = bucketOf(key);
      months.set(key, { ...bucket, expense: bucket.expense + row.amount });
    }

    return {
      range,
      incomeTotal,
      expenseTotal,
      net: incomeTotal - expenseTotal,
      expenseByCategory: byCategory
        .map((group) => ({
          category: group.category as ExpenseCategory,
          count: group._count._all,
          amount: group._sum.amount ?? 0n,
        }))
        .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0)),
      incomeByStatus: byStatus.map((group) => ({
        status: group.status as PaymentStatus,
        count: group._count._all,
        amount: group._sum.amount ?? 0n,
      })),
      byMonth: [...months.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, bucket]) => ({ month, ...bucket })),
      otherCurrencies: [...others.entries()].map(([currency, bucket]) => ({
        currency,
        ...bucket,
      })),
    };
  }

  async vehicles(actor: CurrentUserPayload, range: ReportRange): Promise<VehicleReportRow[]> {
    const db = this.prisma.forCompany(actor.companyId);
    const window = { gte: range.from, lt: range.to };

    const [vehicles, tripGroups, expenseGroups] = await Promise.all([
      db.vehicle.findMany({
        where: { isActive: true, type: { not: 'TRAILER' } },
        orderBy: { plateNumber: 'asc' },
      }),
      db.trip.groupBy({
        by: ['vehicleId'],
        where: { createdAt: window, vehicleId: { not: null } },
        _count: { _all: true },
        _sum: { agreedPrice: true, actualDistanceKm: true },
      }),
      db.expense.groupBy({
        by: ['vehicleId'],
        where: { expenseDate: window, vehicleId: { not: null }, currency: 'UZS' },
        _sum: { amount: true },
      }),
    ]);

    const tripByVehicle = new Map(tripGroups.map((group) => [group.vehicleId, group]));
    const expenseByVehicle = new Map(expenseGroups.map((group) => [group.vehicleId, group]));

    return vehicles.map((vehicle) => {
      const trips = tripByVehicle.get(vehicle.id);
      return {
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        brand: vehicle.brand,
        model: vehicle.model,
        trips: trips?._count._all ?? 0,
        distanceKm: trips?._sum.actualDistanceKm ?? null,
        revenue: trips?._sum.agreedPrice ?? 0n,
        expenses: expenseByVehicle.get(vehicle.id)?._sum.amount ?? 0n,
      };
    });
  }

  async drivers(actor: CurrentUserPayload, range: ReportRange): Promise<DriverReportRow[]> {
    const db = this.prisma.forCompany(actor.companyId);
    const window = { gte: range.from, lt: range.to };

    const [drivers, tripGroups, completedGroups] = await Promise.all([
      db.driver.findMany({ where: { isActive: true }, orderBy: { fullName: 'asc' } }),
      db.trip.groupBy({
        by: ['driverId'],
        where: { createdAt: window, driverId: { not: null } },
        _count: { _all: true },
        _sum: { agreedPrice: true, actualDistanceKm: true },
      }),
      db.trip.groupBy({
        by: ['driverId'],
        where: { createdAt: window, driverId: { not: null }, status: 'COMPLETED' },
        _count: { _all: true },
      }),
    ]);

    const tripByDriver = new Map(tripGroups.map((group) => [group.driverId, group]));
    const completedByDriver = new Map(completedGroups.map((group) => [group.driverId, group]));

    return drivers.map((driver) => {
      const trips = tripByDriver.get(driver.id);
      return {
        driverId: driver.id,
        fullName: driver.fullName,
        trips: trips?._count._all ?? 0,
        completedTrips: completedByDriver.get(driver.id)?._count._all ?? 0,
        distanceKm: trips?._sum.actualDistanceKm ?? null,
        revenue: trips?._sum.agreedPrice ?? 0n,
      };
    });
  }
}
