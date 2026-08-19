/**
 * The deterministic answer.
 *
 * It has two jobs, and the second one is the important one:
 *
 *  1. It is what the user gets when no provider is configured, when the
 *     provider times out, when it declines, and when its answer fails
 *     verification. The assistant therefore always answers, and always with
 *     figures that came out of the finance core.
 *  2. It is handed to the provider as the ground truth to rephrase. The model
 *     is not asked to read a fact sheet and decide what matters — that decision
 *     is already made here, in code — so the worst a bad completion can do is
 *     produce worse prose about the same numbers, and verification catches it
 *     if it tries to produce different ones.
 *
 * Every sentence comes from the i18n catalogue with parameters, never from a
 * string literal in this file (CLAUDE.md: no user-facing text in code).
 */
import type { Locale } from 'shared';
import type { I18nService } from '../../i18n/i18n.service';
import type { AiIntent } from './intent';
import { bpToPercent, decimalToDisplay, tiyinToSom, type FactSheet } from './facts';
import type {
  FuelRow,
  MonthlyRow,
  RouteFinanceRow,
  VehicleFinanceRow,
} from '../finance/finance.service';
import type { FinanceSummary } from '../finance/finance.service';
import type { FleetCounts } from './analytics.facade';

export interface ComposerInput {
  intents: AiIntent[];
  periodLabel: string;
  summary: FinanceSummary;
  routes?: RouteFinanceRow[];
  vehicles?: VehicleFinanceRow[];
  fuel?: FuelRow[];
  monthly?: MonthlyRow[];
  counts?: FleetCounts;
  sheet: FactSheet;
}

/**
 * `"1300.5"` → `13005n`, textually.
 *
 * Only ever used to ORDER rows, but still parsed without `Number`: the same
 * habit that keeps the money right, and a distance in a fleet with a decade of
 * history will eventually be large enough for it to matter.
 */
function decimalToInt(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  return `${sign}${whole}${fraction.padEnd(2, '0').slice(0, 2)}`;
}

/** Highest first, `null` last — the ordering every "which is the best" answer needs. */
function topBy<T>(rows: T[] | undefined, value: (row: T) => string | null): T | null {
  if (!rows || rows.length === 0) return null;
  let best: T | null = null;
  let bestValue = 0n;
  for (const row of rows) {
    const raw = value(row);
    if (raw === null) continue;
    let parsed: bigint;
    try {
      parsed = BigInt(raw);
    } catch {
      continue;
    }
    if (best === null || parsed > bestValue) {
      best = row;
      bestValue = parsed;
    }
  }
  return best;
}

export function composeAnswer(input: ComposerInput, i18n: I18nService, locale: Locale): string {
  const t = (key: string, params?: Record<string, string | number>): string =>
    i18n.translate(key, locale, params);
  const sentences: string[] = [t('AI_ANSWER_PERIOD', { period: input.periodLabel })];

  if (input.sheet.empty) {
    return [sentences[0]!, t('AI_ANSWER_NO_DATA')].join(' ');
  }

  const wants = (intent: AiIntent): boolean => input.intents.includes(intent);
  const { summary } = input;

  if (wants('REVENUE')) {
    sentences.push(t('AI_ANSWER_REVENUE', { revenue: tiyinToSom(summary.revenue) ?? '0' }));
  }
  if (wants('EXPENSE')) {
    sentences.push(t('AI_ANSWER_EXPENSE', { expenses: tiyinToSom(summary.expenses) ?? '0' }));
  }
  if (wants('PROFIT') || wants('MARGIN')) {
    sentences.push(
      t('AI_ANSWER_PROFIT', {
        profit: tiyinToSom(summary.profit) ?? '0',
        margin: bpToPercent(summary.marginBp) ?? '0 %',
      }),
    );
  }
  if (wants('TRIPS')) {
    sentences.push(
      t('AI_ANSWER_TRIPS', {
        trips: summary.trips.total,
        completed: summary.trips.completed,
        inProgress: summary.trips.inProgress,
      }),
    );
  }
  if (wants('DISTANCE')) {
    sentences.push(
      t('AI_ANSWER_DISTANCE', { distance: decimalToDisplay(summary.distanceKm) ?? '0' }),
    );
    const longest = topBy(input.vehicles, (v) => decimalToInt(v.distanceKm));
    if (longest) {
      sentences.push(
        t('AI_ANSWER_LONGEST_VEHICLE', {
          plate: longest.plateNumber,
          distance: decimalToDisplay(longest.distanceKm) ?? '0',
        }),
      );
    }
  }
  if (wants('FUEL')) {
    sentences.push(
      t('AI_ANSWER_FUEL', {
        litres: decimalToDisplay(summary.fuelLitres) ?? '0',
        fuelCost: tiyinToSom(summary.fuelCost) ?? '0',
      }),
    );
    const worstFuel = (input.fuel ?? []).filter((row) => row.overNorm)[0];
    if (worstFuel) {
      sentences.push(
        t('AI_ANSWER_FUEL_ALERT', {
          plate: worstFuel.plateNumber,
          deviation: bpToPercent(worstFuel.deviationBp) ?? '',
          consumption: decimalToDisplay(worstFuel.consumption) ?? '',
          norm: decimalToDisplay(worstFuel.normConsumption) ?? '',
        }),
      );
    }
  }
  if (wants('ROUTES')) {
    const best = topBy(input.routes, (r) => r.profit);
    if (best) {
      sentences.push(
        t('AI_ANSWER_TOP_ROUTE', {
          route: best.routeId ? best.routeName : t('AI_ROUTE_UNASSIGNED'),
          profit: tiyinToSom(best.profit) ?? '0',
          margin: bpToPercent(best.marginBp) ?? '0 %',
          trips: best.trips,
        }),
      );
    }
  }
  if (wants('VEHICLES')) {
    // "which truck cost the most" and "which truck earned the most" are
    // different questions, and the intent pair says which one was asked.
    if (wants('EXPENSE')) {
      const costliest = topBy(input.vehicles, (v) => v.expenses);
      if (costliest) {
        sentences.push(
          t('AI_ANSWER_TOP_EXPENSE_VEHICLE', {
            plate: costliest.plateNumber,
            expenses: tiyinToSom(costliest.expenses) ?? '0',
          }),
        );
      }
    } else {
      const best = topBy(input.vehicles, (v) => v.profit);
      if (best) {
        sentences.push(
          t('AI_ANSWER_TOP_VEHICLE', {
            plate: best.plateNumber,
            profit: tiyinToSom(best.profit) ?? '0',
            trips: best.trips,
          }),
        );
      }
    }
  }
  if (wants('DRIVERS') && input.counts) {
    sentences.push(
      t('AI_ANSWER_FLEET', {
        vehicles: input.counts.vehicles,
        drivers: input.counts.drivers,
        routes: input.counts.routes,
      }),
    );
  }
  if (wants('MONTHLY_COMPARISON') && input.monthly && input.monthly.length >= 2) {
    const current = input.monthly[input.monthly.length - 1]!;
    const previous = input.monthly[input.monthly.length - 2]!;
    sentences.push(
      t('AI_ANSWER_MONTHLY', {
        month: previous.month,
        revenue: tiyinToSom(previous.revenue) ?? '0',
        profit: tiyinToSom(previous.profit) ?? '0',
      }),
      t('AI_ANSWER_MONTHLY', {
        month: current.month,
        revenue: tiyinToSom(current.revenue) ?? '0',
        profit: tiyinToSom(current.profit) ?? '0',
      }),
    );
    if (current.revenueChangeBp !== null) {
      sentences.push(
        t('AI_ANSWER_MONTH_CHANGE', {
          revenueChange: bpToPercent(current.revenueChangeBp, 0) ?? '',
          profitChange: bpToPercent(current.profitChangeBp, 0) ?? '',
        }),
      );
    }
  }

  // A question that matched only ANOMALY or RECOMMENDATION would otherwise be
  // answered with a period and nothing else.
  if (sentences.length === 1) {
    sentences.push(
      t('AI_ANSWER_REVENUE', { revenue: tiyinToSom(summary.revenue) ?? '0' }),
      t('AI_ANSWER_PROFIT', {
        profit: tiyinToSom(summary.profit) ?? '0',
        margin: bpToPercent(summary.marginBp) ?? '0 %',
      }),
    );
  }

  return sentences.join(' ');
}
