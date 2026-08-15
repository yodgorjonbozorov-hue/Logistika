import { IsDateString, IsOptional } from 'class-validator';

/** Start of the current month in UTC — the default reporting window (TZ W-1 «oylik»). */
function startOfCurrentMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** ISO string → Date; missing «from» means «since the start of this month». */
export const resolveFrom = (from?: string): Date =>
  from ? new Date(from) : startOfCurrentMonth(new Date());

/** Missing «to» means «up to now». */
export const resolveTo = (to?: string): Date => (to ? new Date(to) : new Date());

/**
 * Reporting window shared by finance, fuel and report endpoints.
 * Dates travel as ISO strings and are stored/compared in UTC (CLAUDE.md).
 * Both ends are resolved once per request so every query in one response
 * sees exactly the same window.
 */
export class PeriodDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  private cachedFrom?: Date;
  private cachedTo?: Date;

  get fromDate(): Date {
    this.cachedFrom ??= resolveFrom(this.from);
    return this.cachedFrom;
  }

  get toDate(): Date {
    this.cachedTo ??= resolveTo(this.to);
    return this.cachedTo;
  }
}

export function periodOf(from: Date, to: Date): PeriodDto {
  const period = new PeriodDto();
  period.from = from.toISOString();
  period.to = to.toISOString();
  return period;
}
