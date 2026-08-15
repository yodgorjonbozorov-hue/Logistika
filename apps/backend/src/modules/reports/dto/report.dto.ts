import { IsIn, IsOptional } from 'class-validator';
import { PeriodDto } from '../../finance/dto/finance.dto';
import type { ExportFormat } from '../report-export.service';
import { REPORT_KEYS, type ReportKey } from '../reports.service';

export class ReportKeyParam {
  @IsIn(REPORT_KEYS as unknown as string[])
  key!: ReportKey;
}

/** A report export is a report request plus the file format. */
export class ExportReportDto extends PeriodDto {
  @IsOptional()
  @IsIn(['xlsx', 'csv'])
  format?: ExportFormat;
}
