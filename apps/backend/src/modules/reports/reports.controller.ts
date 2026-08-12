import { Controller, Get, Headers, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsEnum, IsIn } from 'class-validator';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PeriodDto } from '../../common/dto/period.dto';
import { I18nService } from '../../i18n/i18n.service';
import { ReportsExportService } from './reports-export.service';
import { PROFIT_GROUPS, ReportsService, type ProfitGroup } from './reports.service';

class ProfitQueryDto extends PeriodDto {
  @IsIn(PROFIT_GROUPS)
  groupBy!: ProfitGroup;
}

class ExportQueryDto extends PeriodDto {
  @IsIn([...PROFIT_GROUPS, 'expense-structure'])
  report!: ProfitGroup | 'expense-structure';

  @IsEnum({ xlsx: 'xlsx', pdf: 'pdf' })
  format!: 'xlsx' | 'pdf';
}

@Controller('reports')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly exportService: ReportsExportService,
    private readonly i18n: I18nService,
  ) {}

  /** W-1 dashboard: cards + event feed + 12-month profit chart. */
  @Get('dashboard')
  dashboard(@CurrentUser() user: CurrentUserPayload) {
    return this.reportsService.dashboard(user);
  }

  /** W-9: profit by trip/vehicle/route/driver/client. */
  @Get('profit')
  profit(@CurrentUser() user: CurrentUserPayload, @Query() query: ProfitQueryDto) {
    return this.reportsService.profit(user, query.groupBy, query.fromDate, query.toDate);
  }

  /** W-9 pirog diagramma. */
  @Get('expense-structure')
  expenseStructure(@CurrentUser() user: CurrentUserPayload, @Query() period: PeriodDto) {
    return this.reportsService.expenseStructure(user, period.fromDate, period.toDate);
  }

  /** Excel/PDF eksport (TZ §4.1 W-9). */
  @Get('export')
  async export(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ExportQueryDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res() res: Response,
  ) {
    const locale = this.i18n.resolveLocale(acceptLanguage);
    const file =
      query.report === 'expense-structure'
        ? await this.exportService.exportExpenseStructure(
            await this.reportsService.expenseStructure(user, query.fromDate, query.toDate),
            query.format,
            locale,
          )
        : await this.exportService.exportProfit(
            await this.reportsService.profit(user, query.report, query.fromDate, query.toDate),
            `REPORT_PROFIT_${query.report.toUpperCase()}`,
            query.format,
            locale,
          );

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }
}
