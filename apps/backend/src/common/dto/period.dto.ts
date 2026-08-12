import { IsDateString, IsOptional } from 'class-validator';

/** Reporting period; defaults to the current calendar month (UTC). */
export class PeriodDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  get fromDate(): Date {
    if (this.from) return new Date(this.from);
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  get toDate(): Date {
    return this.to ? new Date(this.to) : new Date();
  }
}
