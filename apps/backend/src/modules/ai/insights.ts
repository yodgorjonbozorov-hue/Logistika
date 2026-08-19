/**
 * Dashboard insights.
 *
 * Entirely deterministic — no provider is involved, and none should be. An
 * insight is a threshold applied to a rollup ("this truck is 18 % over its fuel
 * norm"), which is arithmetic, and arithmetic that appears unprompted on the
 * owner's dashboard is exactly the kind that must never be approximated by a
 * language model.
 *
 * The backend emits a `kind` and typed parameters; the web app renders the
 * sentence through its own i18n, the same contract as error codes. That keeps
 * one translation of each phrase rather than two, and it means an insight card
 * costs nothing to display when the AI provider is down or absent.
 */
import { bpToPercent, decimalToDisplay, tiyinToSom } from './facts';
import type {
  FuelRow,
  MonthlyRow,
  RouteFinanceRow,
  VehicleFinanceRow,
} from '../finance/finance.service';
import type { FinanceSummary } from '../finance/finance.service';

export const INSIGHT_KINDS = [
  'REVENUE_UP',
  'REVENUE_DOWN',
  'PROFIT_UP',
  'PROFIT_DOWN',
  'LOSS_PERIOD',
  'TOP_ROUTE',
  'LOSS_ROUTE',
  'TOP_VEHICLE',
  'HIGH_EXPENSE_VEHICLE',
  'FUEL_ANOMALY',
  'NO_DATA',
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export type InsightSeverity = 'info' | 'good' | 'warning';

export interface Insight {
  kind: InsightKind;
  severity: InsightSeverity;
  /** Already formatted: so'm strings, percentages, plates. */
  params: Record<string, string>;
}

export interface InsightInput {
  summary: FinanceSummary;
  monthly: MonthlyRow[];
  routes: RouteFinanceRow[];
  vehicles: VehicleFinanceRow[];
  fuel: FuelRow[];
}

/** A month-over-month move smaller than this is noise, not news. */
const MATERIAL_CHANGE_BP = 500; // 5%
/** A truck taking more than this share of all expenses is worth a look. */
const EXPENSE_SHARE_BP = 3500; // 35%

const toBigInt = (value: string): bigint => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

export function buildInsights(input: InsightInput): Insight[] {
  const insights: Insight[] = [];
  const { summary } = input;

  if (summary.trips.total === 0) {
    return [{ kind: 'NO_DATA', severity: 'info', params: {} }];
  }

  // ---- trend -------------------------------------------------------------
  const current = input.monthly.at(-1);
  if (current?.revenueChangeBp !== null && current?.revenueChangeBp !== undefined) {
    if (Math.abs(current.revenueChangeBp) >= MATERIAL_CHANGE_BP) {
      insights.push({
        kind: current.revenueChangeBp > 0 ? 'REVENUE_UP' : 'REVENUE_DOWN',
        severity: current.revenueChangeBp > 0 ? 'good' : 'warning',
        params: {
          change: bpToPercent(Math.abs(current.revenueChangeBp), 0) ?? '',
          revenue: tiyinToSom(current.revenue) ?? '0',
        },
      });
    }
  }
  if (current?.profitChangeBp !== null && current?.profitChangeBp !== undefined) {
    if (Math.abs(current.profitChangeBp) >= MATERIAL_CHANGE_BP) {
      insights.push({
        kind: current.profitChangeBp > 0 ? 'PROFIT_UP' : 'PROFIT_DOWN',
        severity: current.profitChangeBp > 0 ? 'good' : 'warning',
        params: {
          change: bpToPercent(Math.abs(current.profitChangeBp), 0) ?? '',
          profit: tiyinToSom(current.profit) ?? '0',
        },
      });
    }
  }

  // A loss-making period outranks any trend: it is the one thing the owner
  // must see whatever else is on the card.
  if (toBigInt(summary.profit) < 0n) {
    insights.unshift({
      kind: 'LOSS_PERIOD',
      severity: 'warning',
      params: {
        profit: tiyinToSom(summary.profit) ?? '0',
        margin: bpToPercent(summary.marginBp) ?? '',
      },
    });
  }

  // ---- routes ------------------------------------------------------------
  const namedRoutes = input.routes.filter((route) => route.routeId !== null);
  const byProfit = [...namedRoutes].sort((a, b) =>
    toBigInt(b.profit) > toBigInt(a.profit) ? 1 : -1,
  );
  const bestRoute = byProfit[0];
  if (bestRoute && toBigInt(bestRoute.profit) > 0n) {
    insights.push({
      kind: 'TOP_ROUTE',
      severity: 'good',
      params: {
        route: bestRoute.routeName,
        profit: tiyinToSom(bestRoute.profit) ?? '0',
        margin: bpToPercent(bestRoute.marginBp) ?? '',
        trips: String(bestRoute.trips),
      },
    });
  }
  const worstRoute = byProfit.at(-1);
  if (worstRoute && toBigInt(worstRoute.profit) < 0n) {
    insights.push({
      kind: 'LOSS_ROUTE',
      severity: 'warning',
      params: {
        route: worstRoute.routeName,
        profit: tiyinToSom(worstRoute.profit) ?? '0',
        trips: String(worstRoute.trips),
      },
    });
  }

  // ---- vehicles ----------------------------------------------------------
  const byVehicleProfit = [...input.vehicles].sort((a, b) =>
    toBigInt(b.profit) > toBigInt(a.profit) ? 1 : -1,
  );
  const bestVehicle = byVehicleProfit[0];
  if (bestVehicle && toBigInt(bestVehicle.profit) > 0n) {
    insights.push({
      kind: 'TOP_VEHICLE',
      severity: 'good',
      params: {
        plate: bestVehicle.plateNumber,
        profit: tiyinToSom(bestVehicle.profit) ?? '0',
        trips: String(bestVehicle.trips),
      },
    });
  }

  const totalExpenses = toBigInt(summary.expenses);
  if (totalExpenses > 0n) {
    for (const vehicle of input.vehicles) {
      const share = Number((toBigInt(vehicle.expenses) * 10_000n) / totalExpenses);
      // One truck in a two-truck fleet is always "most of the expenses"; the
      // observation is only worth making when there is a fleet to compare with.
      if (share >= EXPENSE_SHARE_BP && input.vehicles.length >= 3) {
        insights.push({
          kind: 'HIGH_EXPENSE_VEHICLE',
          severity: 'warning',
          params: {
            plate: vehicle.plateNumber,
            expenses: tiyinToSom(vehicle.expenses) ?? '0',
            share: bpToPercent(share, 0) ?? '',
          },
        });
        break;
      }
    }
  }

  // ---- fuel --------------------------------------------------------------
  for (const row of input.fuel) {
    if (!row.overNorm || row.deviationBp === null) continue;
    insights.push({
      kind: 'FUEL_ANOMALY',
      severity: 'warning',
      params: {
        plate: row.plateNumber,
        deviation: bpToPercent(row.deviationBp, 0) ?? '',
        consumption: decimalToDisplay(row.consumption) ?? '',
        norm: decimalToDisplay(row.normConsumption) ?? '',
      },
    });
    break; // one is a prompt to look; five is a wall the owner scrolls past
  }

  return insights;
}
