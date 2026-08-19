/**
 * The reporting window a dashboard query covers.
 *
 * `from` is inclusive and `to` exclusive, matching the backend. Both are built
 * from UTC parts because every timestamp in the database is UTC: taking local
 * month boundaries would put an evening trip in Tashkent (UTC+5) into the wrong
 * month for five hours of every day.
 */
export type PeriodPreset = 'thisMonth' | 'lastMonth' | 'last30' | 'last90' | 'thisYear' | 'custom';

export interface Period {
  from: string;
  to: string;
  /** Lets a Period be handed straight to the API client's `query` bag. */
  [key: string]: string;
}

/** Matches the backend's FinancePeriodDto cap, so the UI cannot build a 400. */
export const MAX_PERIOD_DAYS = 400;

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 86_400_000);

/**
 * Resolves a preset into an absolute window.
 *
 * `now` is a parameter rather than a `new Date()` inside so this is testable
 * without freezing the clock.
 */
export function resolvePeriod(preset: Exclude<PeriodPreset, 'custom'>, now = new Date()): Period {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const tomorrow = addDays(startOfUtcDay(now), 1);

  switch (preset) {
    case 'thisMonth':
      return {
        from: new Date(Date.UTC(year, month, 1)).toISOString(),
        to: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
      };
    case 'lastMonth':
      return {
        from: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
        to: new Date(Date.UTC(year, month, 1)).toISOString(),
      };
    case 'last30':
      return { from: addDays(tomorrow, -30).toISOString(), to: tomorrow.toISOString() };
    case 'last90':
      return { from: addDays(tomorrow, -90).toISOString(), to: tomorrow.toISOString() };
    case 'thisYear':
      // Capped: a full year plus the run-up would exceed the backend's limit in
      // a leap year, and a 400 is a worse answer than a slightly shorter window.
      return {
        from: new Date(Date.UTC(year, 0, 1)).toISOString(),
        to: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
      };
  }
}

/** `yyyy-mm-dd` from a date input → the ISO instant the API expects. */
export function customPeriod(fromInput: string, toInput: string): Period | null {
  if (!fromInput || !toInput) return null;
  const from = new Date(`${fromInput}T00:00:00.000Z`);
  // The picker's end date is inclusive to a human; the API's `to` is exclusive.
  const to = addDays(new Date(`${toInput}T00:00:00.000Z`), 1);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (to.getTime() <= from.getTime()) return null;
  if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_PERIOD_DAYS) return null;
  return { from: from.toISOString(), to: to.toISOString() };
}

/** The `to` an inclusive date picker should show for a period. */
export function periodEndInput(period: Period): string {
  return addDays(new Date(period.to), -1).toISOString().slice(0, 10);
}

export function periodStartInput(period: Period): string {
  return period.from.slice(0, 10);
}
