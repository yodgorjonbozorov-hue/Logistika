import { Transform, Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Longest window a single finance query may span. */
const MAX_PERIOD_DAYS = 400;
const DEFAULT_PERIOD_DAYS = 30;

const startOfDefaultPeriod = (): Date => new Date(Date.now() - DEFAULT_PERIOD_DAYS * 86_400_000);

/**
 * `from` inclusive, `to` exclusive.
 *
 * Both are bounded and validated: an unbounded finance query walks every trip,
 * expense and fuel log a company has ever recorded, which is the one shape of
 * request that can take the API down without anyone meaning to (the same
 * lesson as H-8 on the GPS history).
 */
export class FinancePeriodDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @Transform(({ value }) => value ?? startOfDefaultPeriod(), { toClassOnly: true })
  from: Date = startOfDefaultPeriod();

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to: Date = new Date();

  /** Called by the controller; keeps the range check next to the range itself. */
  assertValid(): void {
    if (this.to.getTime() < this.from.getTime()) {
      throw new RangeError('to must not be earlier than from');
    }
    const days = (this.to.getTime() - this.from.getTime()) / 86_400_000;
    if (days > MAX_PERIOD_DAYS) {
      throw new RangeError(`date range must not exceed ${MAX_PERIOD_DAYS} days`);
    }
  }
}

export class FinanceTripsDto extends FinancePeriodDto {
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export class MonthlyDto {
  /** How many months back to report, ending with the current one. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  months = 12;
}

export const FINANCE_MAX_PERIOD_DAYS = MAX_PERIOD_DAYS;
