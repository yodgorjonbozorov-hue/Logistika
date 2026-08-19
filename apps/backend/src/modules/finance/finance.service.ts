import { HttpStatus, Injectable } from '@nestjs/common';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancePeriodDto, FinanceTripsDto, MonthlyDto } from './dto/finance-query.dto';
import {
  asBigInt,
  consumptionCl100km,
  consumptionDeviationBp,
  divRound,
  intToDecimalString,
  marginBp,
  perKm,
} from './finance.math';

/**
 * Finance analytics (TZ §6).
 *
 * ## Where the numbers come from
 *
 * These are read-only rollups over rows the rest of the system already writes.
 * Nothing here creates or edits a financial record, so there is no idempotency
 * or audit concern on this path — the writes it reads (expenses, incomes, fuel
 * logs) carry both.
 *
 * ## Period attribution
 *
 * A company rollup counts every record **by its own date**, which is what a
 * monthly P&L means to an accountant:
 *   trip revenue → COALESCE(finished_at, started_at, created_at)
 *   expense      → expense_date
 *   income       → COALESCE(payment_date, created_at)
 *   fuel         → refuel_time
 *
 * A **per-trip** P&L is a different question — the lifetime economics of one
 * job — so it counts every expense linked to that trip whatever its date. The
 * two therefore do not tie out to the tiyin across a month boundary, and that
 * is correct rather than a bug.
 *
 * ## Revenue
 *
 * `revenue` is the agreed price of the trips in the period: what the company
 * earned by running them. `invoiced` and `received` are the income ledger's
 * view of the same work and are reported alongside, never added — summing both
 * would double-count every trip that has been invoiced.
 *
 * ## Raw SQL
 *
 * The aggregations join across trips, expenses, incomes and fuel logs, which is
 * past what Prisma's `groupBy` can express. Raw SQL bypasses the tenant
 * extension, so **every query below binds `company_id` explicitly** as a
 * parameter — never interpolated — and the tenant-isolation e2e suite proves
 * each endpoint honours it.
 */

/** Money and distance travel out as strings; scale is fixed and documented. */
export interface FinanceTotals {
  /** Agreed price of the trips in the period, in tiyin. */
  revenue: string;
  /** Income rows booked in the period, in tiyin. Reported, never added to revenue. */
  invoiced: string;
  /** Income rows marked PAID, in tiyin. */
  received: string;
  /** Outstanding = invoiced − received, in tiyin. */
  outstanding: string;
  /** All expenses in the period, in tiyin. */
  expenses: string;
  /** The FUEL slice of `expenses` plus fuel-log totals, in tiyin. */
  fuelCost: string;
  /** revenue − expenses, in tiyin. Negative when the period lost money. */
  profit: string;
  /** profit ÷ revenue in basis points (1% = 100). */
  marginBp: number;
}

export interface FinanceSummary extends FinanceTotals {
  from: string;
  to: string;
  trips: { total: number; completed: number; cancelled: number; inProgress: number };
  /** Distinct vehicles that started a trip in the period ("oyda nechta mashina jo'natildi"). */
  trucksDispatched: number;
  routesUsed: number;
  /** Total measured distance, km with one decimal. */
  distanceKm: string;
  /** Fuel burned, litres with two decimals. */
  fuelLitres: string;
  /** Tiyin per km, or null when no distance was recorded. */
  costPerKm: string | null;
  revenuePerKm: string | null;
  profitPerKm: string | null;
  /** Mean profit across the trips in the period, in tiyin. */
  profitPerTrip: string | null;
  expensesByCategory: Array<{ category: string; amount: string; shareBp: number }>;
}

export interface TripFinanceRow {
  tripId: string;
  tripNumber: string;
  status: string;
  periodAt: string;
  routeId: string | null;
  routeName: string | null;
  vehicleId: string | null;
  plateNumber: string | null;
  driverName: string | null;
  clientName: string | null;
  distanceKm: string;
  revenue: string;
  expenses: string;
  fuelCost: string;
  profit: string;
  marginBp: number;
  profitPerKm: string | null;
}

export interface RouteFinanceRow {
  routeId: string | null;
  routeName: string;
  trips: number;
  completedTrips: number;
  distanceKm: string;
  revenue: string;
  expenses: string;
  profit: string;
  marginBp: number;
  profitPerTrip: string | null;
  profitPerKm: string | null;
}

export interface VehicleFinanceRow {
  vehicleId: string;
  plateNumber: string;
  trips: number;
  distanceKm: string;
  revenue: string;
  /** Trip-linked expenses plus expenses booked directly against the vehicle. */
  expenses: string;
  profit: string;
  marginBp: number;
  profitPerKm: string | null;
  fuelLitres: string;
  fuelCost: string;
  /** Actual L/100km with two decimals, or null without distance or fuel. */
  consumption: string | null;
  /** The vehicle's configured norm, L/100km. */
  normConsumption: string | null;
  /** Actual vs norm in basis points; positive means burning more than the norm. */
  deviationBp: number | null;
}

export interface MonthlyRow {
  month: string;
  trips: number;
  trucksDispatched: number;
  routesUsed: number;
  distanceKm: string;
  revenue: string;
  expenses: string;
  profit: string;
  marginBp: number;
  /** Change against the previous month in basis points; null for the first month. */
  revenueChangeBp: number | null;
  profitChangeBp: number | null;
}

export interface FuelRow {
  vehicleId: string;
  plateNumber: string;
  refuels: number;
  litres: string;
  cost: string;
  distanceKm: string;
  consumption: string | null;
  normConsumption: string | null;
  deviationBp: number | null;
  /** True when the truck is over its norm by more than the alert threshold. */
  overNorm: boolean;
}

/** TZ §8: flag a vehicle once it burns more than 7% over its norm. */
const FUEL_ALERT_THRESHOLD_BP = 700;

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  private tenant(actor: CurrentUserPayload): string {
    if (!actor.companyId) throw new AppException('TENANT_MISSING', HttpStatus.FORBIDDEN);
    return actor.companyId;
  }

  // ---------------------------------------------------------------------------
  // Company summary
  // ---------------------------------------------------------------------------

  async summary(actor: CurrentUserPayload, period: FinancePeriodDto): Promise<FinanceSummary> {
    const companyId = this.tenant(actor);
    const { from, to } = period;

    const [tripRows, expenseRows, incomeRows, fuelRows, categoryRows] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          total: bigint;
          completed: bigint;
          cancelled: bigint;
          in_progress: bigint;
          revenue: bigint;
          distance_hm: bigint;
          trucks_dispatched: bigint;
          routes_used: bigint;
        }>
      >`
        SELECT
          COUNT(*)::bigint                                                        AS total,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint                    AS completed,
          COUNT(*) FILTER (WHERE status = 'CANCELLED')::bigint                    AS cancelled,
          COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::bigint                  AS in_progress,
          COALESCE(SUM(agreed_price), 0)::bigint                                  AS revenue,
          COALESCE(SUM(ROUND(COALESCE(actual_distance_km, 0) * 10)), 0)::bigint   AS distance_hm,
          COUNT(DISTINCT vehicle_id) FILTER (
            WHERE started_at >= ${from} AND started_at < ${to}
          )::bigint                                                               AS trucks_dispatched,
          COUNT(DISTINCT route_id)::bigint                                        AS routes_used
        FROM trips
        WHERE company_id = ${companyId}
          AND COALESCE(finished_at, started_at, created_at) >= ${from}
          AND COALESCE(finished_at, started_at, created_at) < ${to}
      `,
      this.prisma.$queryRaw<Array<{ total: bigint; fuel: bigint }>>`
        SELECT
          COALESCE(SUM(amount), 0)::bigint                                        AS total,
          COALESCE(SUM(amount) FILTER (WHERE category = 'FUEL'), 0)::bigint       AS fuel
        FROM expenses
        WHERE company_id = ${companyId} AND expense_date >= ${from} AND expense_date < ${to}
      `,
      this.prisma.$queryRaw<Array<{ invoiced: bigint; received: bigint }>>`
        SELECT
          COALESCE(SUM(amount), 0)::bigint                                        AS invoiced,
          COALESCE(SUM(amount) FILTER (WHERE status = 'PAID'), 0)::bigint         AS received
        FROM incomes
        WHERE company_id = ${companyId}
          AND COALESCE(payment_date, created_at) >= ${from}
          AND COALESCE(payment_date, created_at) < ${to}
      `,
      this.prisma.$queryRaw<Array<{ litres_cl: bigint; cost: bigint }>>`
        SELECT
          COALESCE(SUM(ROUND(liters * 100)), 0)::bigint                           AS litres_cl,
          COALESCE(SUM(total_amount), 0)::bigint                                  AS cost
        FROM fuel_logs
        WHERE company_id = ${companyId} AND refuel_time >= ${from} AND refuel_time < ${to}
      `,
      this.prisma.$queryRaw<Array<{ category: string; amount: bigint }>>`
        SELECT category::text AS category, SUM(amount)::bigint AS amount
        FROM expenses
        WHERE company_id = ${companyId} AND expense_date >= ${from} AND expense_date < ${to}
        GROUP BY category
        ORDER BY SUM(amount) DESC
      `,
    ]);

    const trips = tripRows[0]!;
    const expenseTotal = asBigInt(expenseRows[0]?.total);
    const revenue = asBigInt(trips.revenue);
    const distanceHm = asBigInt(trips.distance_hm);
    const profit = revenue - expenseTotal;
    const tripCount = Number(trips.total);
    const invoiced = asBigInt(incomeRows[0]?.invoiced);
    const received = asBigInt(incomeRows[0]?.received);

    // Fuel bought on a card shows up as a FUEL expense; fuel logged at the pump
    // shows up as a fuel log. Whichever the company uses, the larger of the two
    // is the honest figure — adding them would double-count a company that
    // records both for the same litres.
    const fuelExpense = asBigInt(expenseRows[0]?.fuel);
    const fuelLogCost = asBigInt(fuelRows[0]?.cost);
    const fuelCost = fuelExpense > fuelLogCost ? fuelExpense : fuelLogCost;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      trips: {
        total: tripCount,
        completed: Number(trips.completed),
        cancelled: Number(trips.cancelled),
        inProgress: Number(trips.in_progress),
      },
      trucksDispatched: Number(trips.trucks_dispatched),
      routesUsed: Number(trips.routes_used),
      distanceKm: intToDecimalString(distanceHm, 1),
      fuelLitres: intToDecimalString(asBigInt(fuelRows[0]?.litres_cl), 2),
      revenue: revenue.toString(),
      invoiced: invoiced.toString(),
      received: received.toString(),
      outstanding: (invoiced - received).toString(),
      expenses: expenseTotal.toString(),
      fuelCost: fuelCost.toString(),
      profit: profit.toString(),
      marginBp: marginBp(profit, revenue),
      costPerKm: perKm(expenseTotal, distanceHm)?.toString() ?? null,
      revenuePerKm: perKm(revenue, distanceHm)?.toString() ?? null,
      profitPerKm: perKm(profit, distanceHm)?.toString() ?? null,
      profitPerTrip: tripCount > 0 ? divRound(profit, BigInt(tripCount)).toString() : null,
      expensesByCategory: categoryRows.map((row) => ({
        category: row.category,
        amount: asBigInt(row.amount).toString(),
        shareBp: expenseTotal > 0n ? marginBp(asBigInt(row.amount), expenseTotal) : 0,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Per trip
  // ---------------------------------------------------------------------------

  async byTrip(
    actor: CurrentUserPayload,
    query: FinanceTripsDto,
  ): Promise<{ data: TripFinanceRow[]; total: number }> {
    const companyId = this.tenant(actor);
    const { from, to, skip, limit, routeId, vehicleId } = query;

    // Sub-selects rather than joins: a trip with three expenses and two fuel
    // logs would otherwise be multiplied out and every sum inflated.
    const rows = await this.prisma.$queryRaw<
      Array<{
        trip_id: string;
        trip_number: string;
        status: string;
        period_at: Date;
        route_id: string | null;
        route_name: string | null;
        vehicle_id: string | null;
        plate_number: string | null;
        driver_name: string | null;
        client_name: string | null;
        distance_hm: bigint;
        revenue: bigint;
        expenses: bigint;
        fuel_cost: bigint;
      }>
    >`
      SELECT
        t.id                                                    AS trip_id,
        t.trip_number                                           AS trip_number,
        t.status::text                                          AS status,
        COALESCE(t.finished_at, t.started_at, t.created_at)      AS period_at,
        t.route_id                                              AS route_id,
        r.name                                                  AS route_name,
        t.vehicle_id                                            AS vehicle_id,
        v.plate_number                                          AS plate_number,
        d.full_name                                             AS driver_name,
        c.name                                                  AS client_name,
        COALESCE(ROUND(t.actual_distance_km * 10), 0)::bigint   AS distance_hm,
        t.agreed_price                                          AS revenue,
        COALESCE((
          SELECT SUM(e.amount) FROM expenses e
          WHERE e.company_id = t.company_id AND e.trip_id = t.id
        ), 0)::bigint                                           AS expenses,
        COALESCE((
          SELECT SUM(e.amount) FROM expenses e
          WHERE e.company_id = t.company_id AND e.trip_id = t.id AND e.category = 'FUEL'
        ), 0)::bigint                                           AS fuel_cost
      FROM trips t
      LEFT JOIN routes   r ON r.id = t.route_id   AND r.company_id = t.company_id
      LEFT JOIN vehicles v ON v.id = t.vehicle_id AND v.company_id = t.company_id
      LEFT JOIN drivers  d ON d.id = t.driver_id  AND d.company_id = t.company_id
      LEFT JOIN clients  c ON c.id = t.client_id  AND c.company_id = t.company_id
      WHERE t.company_id = ${companyId}
        AND COALESCE(t.finished_at, t.started_at, t.created_at) >= ${from}
        AND COALESCE(t.finished_at, t.started_at, t.created_at) < ${to}
        AND (${routeId ?? null}::text IS NULL OR t.route_id = ${routeId ?? null})
        AND (${vehicleId ?? null}::text IS NULL OR t.vehicle_id = ${vehicleId ?? null})
      ORDER BY COALESCE(t.finished_at, t.started_at, t.created_at) DESC
      LIMIT ${limit} OFFSET ${skip}
    `;

    const countRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total FROM trips t
      WHERE t.company_id = ${companyId}
        AND COALESCE(t.finished_at, t.started_at, t.created_at) >= ${from}
        AND COALESCE(t.finished_at, t.started_at, t.created_at) < ${to}
        AND (${routeId ?? null}::text IS NULL OR t.route_id = ${routeId ?? null})
        AND (${vehicleId ?? null}::text IS NULL OR t.vehicle_id = ${vehicleId ?? null})
    `;

    return {
      total: Number(asBigInt(countRows[0]?.total)),
      data: rows.map((row) => {
        const revenue = asBigInt(row.revenue);
        const expenses = asBigInt(row.expenses);
        const profit = revenue - expenses;
        const distanceHm = asBigInt(row.distance_hm);
        return {
          tripId: row.trip_id,
          tripNumber: row.trip_number,
          status: row.status,
          periodAt: row.period_at.toISOString(),
          routeId: row.route_id,
          routeName: row.route_name,
          vehicleId: row.vehicle_id,
          plateNumber: row.plate_number,
          driverName: row.driver_name,
          clientName: row.client_name,
          distanceKm: intToDecimalString(distanceHm, 1),
          revenue: revenue.toString(),
          expenses: expenses.toString(),
          fuelCost: asBigInt(row.fuel_cost).toString(),
          profit: profit.toString(),
          marginBp: marginBp(profit, revenue),
          profitPerKm: perKm(profit, distanceHm)?.toString() ?? null,
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Per route
  // ---------------------------------------------------------------------------

  async byRoute(actor: CurrentUserPayload, period: FinancePeriodDto): Promise<RouteFinanceRow[]> {
    const companyId = this.tenant(actor);
    const { from, to } = period;

    const rows = await this.prisma.$queryRaw<
      Array<{
        route_id: string | null;
        route_name: string | null;
        trips: bigint;
        completed: bigint;
        distance_hm: bigint;
        revenue: bigint;
        expenses: bigint;
      }>
    >`
      WITH scoped AS (
        SELECT
          t.id, t.route_id, t.status,
          COALESCE(ROUND(t.actual_distance_km * 10), 0)::bigint AS distance_hm,
          t.agreed_price,
          COALESCE((
            SELECT SUM(e.amount) FROM expenses e
            WHERE e.company_id = t.company_id AND e.trip_id = t.id
          ), 0)::bigint AS trip_expenses
        FROM trips t
        WHERE t.company_id = ${companyId}
          AND COALESCE(t.finished_at, t.started_at, t.created_at) >= ${from}
          AND COALESCE(t.finished_at, t.started_at, t.created_at) < ${to}
      )
      SELECT
        s.route_id                                            AS route_id,
        r.name                                                AS route_name,
        COUNT(*)::bigint                                      AS trips,
        COUNT(*) FILTER (WHERE s.status = 'COMPLETED')::bigint AS completed,
        COALESCE(SUM(s.distance_hm), 0)::bigint               AS distance_hm,
        COALESCE(SUM(s.agreed_price), 0)::bigint              AS revenue,
        COALESCE(SUM(s.trip_expenses), 0)::bigint             AS expenses
      FROM scoped s
      LEFT JOIN routes r ON r.id = s.route_id AND r.company_id = ${companyId}
      GROUP BY s.route_id, r.name
      ORDER BY COALESCE(SUM(s.agreed_price), 0) DESC
    `;

    return rows.map((row) => {
      const revenue = asBigInt(row.revenue);
      const expenses = asBigInt(row.expenses);
      const profit = revenue - expenses;
      const trips = Number(row.trips);
      const distanceHm = asBigInt(row.distance_hm);
      return {
        routeId: row.route_id,
        // Trips with no route are a real bucket, not an error — labelling it
        // explicitly is more useful than hiding them from the totals.
        routeName: row.route_name ?? 'UNASSIGNED',
        trips,
        completedTrips: Number(row.completed),
        distanceKm: intToDecimalString(distanceHm, 1),
        revenue: revenue.toString(),
        expenses: expenses.toString(),
        profit: profit.toString(),
        marginBp: marginBp(profit, revenue),
        profitPerTrip: trips > 0 ? divRound(profit, BigInt(trips)).toString() : null,
        profitPerKm: perKm(profit, distanceHm)?.toString() ?? null,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Per vehicle
  // ---------------------------------------------------------------------------

  async byVehicle(
    actor: CurrentUserPayload,
    period: FinancePeriodDto,
  ): Promise<VehicleFinanceRow[]> {
    const companyId = this.tenant(actor);
    const { from, to } = period;

    const rows = await this.prisma.$queryRaw<
      Array<{
        vehicle_id: string;
        plate_number: string;
        norm_cl: bigint | null;
        trips: bigint;
        distance_hm: bigint;
        revenue: bigint;
        trip_expenses: bigint;
        direct_expenses: bigint;
        fuel_cl: bigint;
        fuel_cost: bigint;
      }>
    >`
      SELECT
        v.id                                                     AS vehicle_id,
        v.plate_number                                           AS plate_number,
        ROUND(v.fuel_norm_per_100km * 100)::bigint               AS norm_cl,
        COALESCE(t.trips, 0)::bigint                             AS trips,
        COALESCE(t.distance_hm, 0)::bigint                       AS distance_hm,
        COALESCE(t.revenue, 0)::bigint                           AS revenue,
        COALESCE(t.trip_expenses, 0)::bigint                     AS trip_expenses,
        COALESCE(de.direct_expenses, 0)::bigint                  AS direct_expenses,
        COALESCE(f.fuel_cl, 0)::bigint                           AS fuel_cl,
        COALESCE(f.fuel_cost, 0)::bigint                         AS fuel_cost
      FROM vehicles v
      LEFT JOIN (
        SELECT
          tr.vehicle_id,
          COUNT(*)                                                        AS trips,
          SUM(COALESCE(ROUND(tr.actual_distance_km * 10), 0))             AS distance_hm,
          SUM(tr.agreed_price)                                            AS revenue,
          SUM(COALESCE((
            SELECT SUM(e.amount) FROM expenses e
            WHERE e.company_id = tr.company_id AND e.trip_id = tr.id
          ), 0))                                                          AS trip_expenses
        FROM trips tr
        WHERE tr.company_id = ${companyId}
          AND tr.vehicle_id IS NOT NULL
          AND COALESCE(tr.finished_at, tr.started_at, tr.created_at) >= ${from}
          AND COALESCE(tr.finished_at, tr.started_at, tr.created_at) < ${to}
        GROUP BY tr.vehicle_id
      ) t ON t.vehicle_id = v.id
      LEFT JOIN (
        -- Expenses booked against the truck itself rather than a trip: repairs,
        -- insurance, tax. Omitting them would make every vehicle look cheaper
        -- to run than it is.
        SELECT e.vehicle_id, SUM(e.amount) AS direct_expenses
        FROM expenses e
        WHERE e.company_id = ${companyId}
          AND e.vehicle_id IS NOT NULL
          AND e.trip_id IS NULL
          AND e.expense_date >= ${from} AND e.expense_date < ${to}
        GROUP BY e.vehicle_id
      ) de ON de.vehicle_id = v.id
      LEFT JOIN (
        SELECT fl.vehicle_id,
               SUM(ROUND(fl.liters * 100))   AS fuel_cl,
               SUM(COALESCE(fl.total_amount, 0)) AS fuel_cost
        FROM fuel_logs fl
        WHERE fl.company_id = ${companyId}
          AND fl.refuel_time >= ${from} AND fl.refuel_time < ${to}
        GROUP BY fl.vehicle_id
      ) f ON f.vehicle_id = v.id
      WHERE v.company_id = ${companyId}
        AND (t.trips IS NOT NULL OR de.direct_expenses IS NOT NULL OR f.fuel_cl IS NOT NULL)
      ORDER BY COALESCE(t.revenue, 0) DESC
    `;

    return rows.map((row) => {
      const revenue = asBigInt(row.revenue);
      const expenses = asBigInt(row.trip_expenses) + asBigInt(row.direct_expenses);
      const profit = revenue - expenses;
      const distanceHm = asBigInt(row.distance_hm);
      const fuelCl = asBigInt(row.fuel_cl);
      const normCl = row.norm_cl === null ? null : asBigInt(row.norm_cl);
      const consumption = consumptionCl100km(fuelCl, distanceHm);

      return {
        vehicleId: row.vehicle_id,
        plateNumber: row.plate_number,
        trips: Number(row.trips),
        distanceKm: intToDecimalString(distanceHm, 1),
        revenue: revenue.toString(),
        expenses: expenses.toString(),
        profit: profit.toString(),
        marginBp: marginBp(profit, revenue),
        profitPerKm: perKm(profit, distanceHm)?.toString() ?? null,
        fuelLitres: intToDecimalString(fuelCl, 2),
        fuelCost: asBigInt(row.fuel_cost).toString(),
        consumption: consumption === null ? null : intToDecimalString(consumption, 2),
        normConsumption: normCl === null ? null : intToDecimalString(normCl, 2),
        deviationBp: consumptionDeviationBp(consumption, normCl),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Monthly series
  // ---------------------------------------------------------------------------

  async monthly(actor: CurrentUserPayload, query: MonthlyDto): Promise<MonthlyRow[]> {
    const companyId = this.tenant(actor);

    // generate_series builds the calendar so a month with no activity still
    // appears as a zero row — a gap in a trend chart reads as missing data.
    //
    // Every timestamp column here is `timestamp without time zone` holding UTC
    // (CLAUDE.md: «Barcha vaqtlar bazada UTC»), so the calendar is anchored with
    // `now() AT TIME ZONE 'UTC'` rather than a bare `now()`. A bare `now()` is a
    // timestamptz rendered in the SERVER's session timezone: on a database set
    // to Asia/Tashkent every month bucket would slide five hours and rows near a
    // month boundary would land in the wrong month. `to_char` formats the label
    // in SQL for the same reason — `Date#toISOString()` in Node would re-apply a
    // timezone shift on the way out.
    const rows = await this.prisma.$queryRaw<
      Array<{
        month: string;
        trips: bigint;
        trucks: bigint;
        routes: bigint;
        distance_hm: bigint;
        revenue: bigint;
        expenses: bigint;
      }>
    >`
      WITH months AS (
        SELECT generate_series(
          -- The ::int cast is required, not decorative: Prisma binds a JS number
          -- as bigint, and make_interval has no bigint overload, so without it
          -- every call to this endpoint is a 500.
          date_trunc('month', now() AT TIME ZONE 'UTC')
            - make_interval(months => ${query.months - 1}::int),
          date_trunc('month', now() AT TIME ZONE 'UTC'),
          '1 month'
        ) AS month
      ),
      trip_stats AS (
        SELECT
          date_trunc('month', COALESCE(t.finished_at, t.started_at, t.created_at)) AS month,
          COUNT(*)                                                      AS trips,
          COUNT(DISTINCT t.route_id)                                    AS routes,
          SUM(COALESCE(ROUND(t.actual_distance_km * 10), 0))            AS distance_hm,
          SUM(t.agreed_price)                                           AS revenue
        FROM trips t
        WHERE t.company_id = ${companyId}
        GROUP BY 1
      ),
      dispatch_stats AS (
        -- "How many trucks did we send out this month" is a dispatch question,
        -- so it keys on started_at rather than on the P&L period.
        SELECT date_trunc('month', t.started_at) AS month,
               COUNT(DISTINCT t.vehicle_id)      AS trucks
        FROM trips t
        WHERE t.company_id = ${companyId} AND t.started_at IS NOT NULL
        GROUP BY 1
      ),
      expense_stats AS (
        SELECT date_trunc('month', e.expense_date) AS month, SUM(e.amount) AS expenses
        FROM expenses e
        WHERE e.company_id = ${companyId}
        GROUP BY 1
      )
      SELECT
        to_char(m.month, 'YYYY-MM')                AS month,
        COALESCE(ts.trips, 0)::bigint              AS trips,
        COALESCE(ds.trucks, 0)::bigint             AS trucks,
        COALESCE(ts.routes, 0)::bigint             AS routes,
        COALESCE(ts.distance_hm, 0)::bigint        AS distance_hm,
        COALESCE(ts.revenue, 0)::bigint            AS revenue,
        COALESCE(es.expenses, 0)::bigint           AS expenses
      FROM months m
      LEFT JOIN trip_stats    ts ON ts.month = m.month
      LEFT JOIN dispatch_stats ds ON ds.month = m.month
      LEFT JOIN expense_stats es ON es.month = m.month
      ORDER BY m.month ASC
    `;

    let previousRevenue: bigint | null = null;
    let previousProfit: bigint | null = null;

    return rows.map((row) => {
      const revenue = asBigInt(row.revenue);
      const expenses = asBigInt(row.expenses);
      const profit = revenue - expenses;
      const distanceHm = asBigInt(row.distance_hm);

      const revenueChangeBp =
        previousRevenue === null || previousRevenue === 0n
          ? null
          : marginBp(revenue - previousRevenue, previousRevenue);
      const profitChangeBp =
        previousProfit === null || previousProfit === 0n
          ? null
          : marginBp(
              profit - previousProfit,
              previousProfit < 0n ? -previousProfit : previousProfit,
            );

      previousRevenue = revenue;
      previousProfit = profit;

      return {
        month: row.month,
        trips: Number(row.trips),
        trucksDispatched: Number(row.trucks),
        routesUsed: Number(row.routes),
        distanceKm: intToDecimalString(distanceHm, 1),
        revenue: revenue.toString(),
        expenses: expenses.toString(),
        profit: profit.toString(),
        marginBp: marginBp(profit, revenue),
        revenueChangeBp,
        profitChangeBp,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Fuel
  // ---------------------------------------------------------------------------

  /**
   * Fuel per vehicle, with the norm comparison that drives the theft alert.
   *
   * The distance side comes from the trips in the period, the volume side from
   * the fuel logs. A vehicle with fuel but no measured distance still appears,
   * with a null consumption rather than a fabricated one.
   */
  async fuel(actor: CurrentUserPayload, period: FinancePeriodDto): Promise<FuelRow[]> {
    const companyId = this.tenant(actor);
    const { from, to } = period;

    const rows = await this.prisma.$queryRaw<
      Array<{
        vehicle_id: string;
        plate_number: string;
        norm_cl: bigint | null;
        refuels: bigint;
        fuel_cl: bigint;
        fuel_cost: bigint;
        distance_hm: bigint;
      }>
    >`
      SELECT
        v.id                                        AS vehicle_id,
        v.plate_number                              AS plate_number,
        ROUND(v.fuel_norm_per_100km * 100)::bigint  AS norm_cl,
        f.refuels::bigint                           AS refuels,
        f.fuel_cl::bigint                           AS fuel_cl,
        f.fuel_cost::bigint                         AS fuel_cost,
        COALESCE(t.distance_hm, 0)::bigint          AS distance_hm
      FROM vehicles v
      JOIN (
        SELECT fl.vehicle_id,
               COUNT(*)                              AS refuels,
               SUM(ROUND(fl.liters * 100))           AS fuel_cl,
               SUM(COALESCE(fl.total_amount, 0))     AS fuel_cost
        FROM fuel_logs fl
        WHERE fl.company_id = ${companyId}
          AND fl.refuel_time >= ${from} AND fl.refuel_time < ${to}
        GROUP BY fl.vehicle_id
      ) f ON f.vehicle_id = v.id
      LEFT JOIN (
        SELECT tr.vehicle_id,
               SUM(COALESCE(ROUND(tr.actual_distance_km * 10), 0)) AS distance_hm
        FROM trips tr
        WHERE tr.company_id = ${companyId}
          AND tr.vehicle_id IS NOT NULL
          AND COALESCE(tr.finished_at, tr.started_at, tr.created_at) >= ${from}
          AND COALESCE(tr.finished_at, tr.started_at, tr.created_at) < ${to}
        GROUP BY tr.vehicle_id
      ) t ON t.vehicle_id = v.id
      WHERE v.company_id = ${companyId}
      ORDER BY f.fuel_cost DESC
    `;

    return rows.map((row) => {
      const fuelCl = asBigInt(row.fuel_cl);
      const distanceHm = asBigInt(row.distance_hm);
      const normCl = row.norm_cl === null ? null : asBigInt(row.norm_cl);
      const consumption = consumptionCl100km(fuelCl, distanceHm);
      const deviationBp = consumptionDeviationBp(consumption, normCl);

      return {
        vehicleId: row.vehicle_id,
        plateNumber: row.plate_number,
        refuels: Number(row.refuels),
        litres: intToDecimalString(fuelCl, 2),
        cost: asBigInt(row.fuel_cost).toString(),
        distanceKm: intToDecimalString(distanceHm, 1),
        consumption: consumption === null ? null : intToDecimalString(consumption, 2),
        normConsumption: normCl === null ? null : intToDecimalString(normCl, 2),
        deviationBp,
        overNorm: deviationBp !== null && deviationBp > FUEL_ALERT_THRESHOLD_BP,
      };
    });
  }
}
