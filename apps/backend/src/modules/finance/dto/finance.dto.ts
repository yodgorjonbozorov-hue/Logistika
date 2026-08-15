import { IsDateString, IsOptional } from 'class-validator';

/** Start of the current month in UTC — the default reporting window (TZ W-1 «oylik»). */
function startOfCurrentMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * Reporting window shared by finance, fuel and report endpoints.
 * Dates travel as ISO strings and are stored/compared in UTC (CLAUDE.md).
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
    this.cachedFrom ??= this.from ? new Date(this.from) : startOfCurrentMonth(new Date());
    return this.cachedFrom;
  }

  get toDate(): Date {
    this.cachedTo ??= this.to ? new Date(this.to) : new Date();
    return this.cachedTo;
  }
}

export function periodOf(from: Date, to: Date): PeriodDto {
  const period = new PeriodDto();
  period.from = from.toISOString();
  period.to = to.toISOString();
  return period;
}
