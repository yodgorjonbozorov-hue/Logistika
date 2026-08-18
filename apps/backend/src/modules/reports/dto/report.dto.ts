import { IsDateString, IsOptional } from 'class-validator';

/** Reporting window; both ends optional — the service falls back to the last 30 local days. */
export class ReportRangeDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
