import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Reporting window. Both ends are optional; the service falls back to the
 * current calendar month in UTC (times are stored and compared in UTC —
 * CLAUDE.md), and the resolved range is echoed back in every response.
 */
export class DateRangeDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
