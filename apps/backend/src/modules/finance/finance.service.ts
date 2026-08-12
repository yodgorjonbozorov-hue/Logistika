import { HttpStatus, Injectable } from '@nestjs/common';
import type { Expense, Prisma, Trip } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { amortizationTiyin, costPerKmTiyin, driverShareTiyin, roiPercent } from './finance.calc';

/** Best available trip distance: actual → odometer diff → planned → 0. */
export function tripDistanceKm(
  trip: Pick<Trip, 'actualDistanceKm' | 'startOdometer' | 'endOdometer' | 'plannedDistanceKm'>,
): number {
  if (trip.actualDistanceKm != null) return Number(trip.actualDistanceKm);
  if (
    trip.startOdometer != null &&
    trip.endOdometer != null &&
    trip.endOdometer > trip.startOdometer
  ) {
    return trip.endOdometer - trip.startOdometer;
  }
  if (trip.plannedDistanceKm != null) return Number(trip.plannedDistanceKm);
  return 0;
}

export interface TripPnl {
  tripId: string;
  tripNumber: string;
  status: string;
  distanceKm: number;
  agreedPrice: bigint;
  receivedAmount: bigint;
  expensesByCategory: Record<string, bigint>;
  expensesTotal: bigint;
  /** COMPUTED — from the driver's salary settings; EXPENSES — SALARY rows exist. */
  driverShareSource: 'COMPUTED' | 'EXPENSES';
  driverShare: bigint;
  amortization: bigint;
  totalCost: bigint;
  profit: bigint;
  costPerKm: bigint | null;
}

export interface VehicleStats {
  vehicleId: string;
  plateNumber: string;
  from: Date;
  to: Date;
  tripCount: number;
  distanceKm: number;
  income: bigint;
  expenses: bigint;
  amortization: bigint;
  totalCost: bigint;
  profit: bigint;
  costPerKm: bigint | null;
  roiPercent: number | null;
}

function sumAmounts(rows: Array<{ amount: bigint }>): bigint {
  return rows.reduce((acc, row) => acc + row.amount, 0n);
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** W-4 tab 2: full P&L of one trip (TZ §6 «Reys sof foydasi»). */
  async tripPnl(actor: CurrentUserPayload, tripId: string): Promise<TripPnl> {
    const db = this.prisma.forCompany(actor.companyId);
    const trip = await db.trip.findUnique({
      where: { id: tripId },
      include: { vehicle: true, driver: true },
    });
    if (!trip) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    const [expenses, incomes] = await Promise.all([
      db.expense.findMany({ where: { tripId } }),
      db.income.findMany({ where: { tripId } }),
    ]);

    const distanceKm = tripDistanceKm(trip);
    const expensesByCategory: Record<string, bigint> = {};
    for (const expense of expenses) {
      expensesByCategory[expense.category] =
        (expensesByCategory[expense.category] ?? 0n) + expense.amount;
    }
    const expensesTotal = sumAmounts(expenses);

    // Driver share: recorded SALARY expenses win; otherwise derive from the
    // driver's salary settings — never both (no double counting).
    const salaryExpenses = expensesByCategory['SALARY'] ?? 0n;
    const driverShareSource = salaryExpenses > 0n ? 'EXPENSES' : 'COMPUTED';
    const driverShare =
      driverShareSource === 'EXPENSES'
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

    const totalCost = expensesTotal + driverShare + amortization;
    const receivedAmount = sumAmounts(
      incomes.filter((income) => income.status === 'PAID' || income.status === 'PARTIAL'),
    );

    return {
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      status: trip.status,
      distanceKm,
      agreedPrice: trip.agreedPrice,
      receivedAmount,
      expensesByCategory,
      expensesTotal,
      driverShareSource,
      driverShare,
      amortization,
      totalCost,
      profit: trip.agreedPrice - totalCost,
      costPerKm: costPerKmTiyin(totalCost, distanceKm),
    };
  }

  /** W-5 statistics: what the vehicle earned/ate over a period + cost/km + ROI. */
  async vehicleStats(
    actor: CurrentUserPayload,
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<VehicleStats> {
    const db = this.prisma.forCompany(actor.companyId);
    const vehicle = await db.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    const tripWindow: Prisma.TripWhereInput = {
      vehicleId,
      status: 'COMPLETED',
      finishedAt: { gte: from, lte: to },
    };
    const [trips, expenses] = await Promise.all([
      db.trip.findMany({ where: tripWindow }),
      db.expense.findMany({
        where: {
          expenseDate: { gte: from, lte: to },
          OR: [{ vehicleId }, { trip: { vehicleId } }],
        },
      }),
    ]);

    const income = trips.reduce((acc, trip) => acc + trip.agreedPrice, 0n);
    const distanceKm = trips.reduce((acc, trip) => acc + tripDistanceKm(trip), 0);
    const expensesTotal = sumAmounts(expenses as Expense[]);
    const amortization = amortizationTiyin(
      vehicle.purchasePrice,
      vehicle.plannedTotalKm,
      distanceKm,
    );
    const totalCost = expensesTotal + amortization;

    return {
      vehicleId,
      plateNumber: vehicle.plateNumber,
      from,
      to,
      tripCount: trips.length,
      distanceKm,
      income,
      expenses: expensesTotal,
      amortization,
      totalCost,
      profit: income - totalCost,
      costPerKm: costPerKmTiyin(totalCost, distanceKm),
      roiPercent: roiPercent(income, totalCost),
    };
  }
}
