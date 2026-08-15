import { Controller, Get, Headers, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { I18nService } from '../../i18n/i18n.service';
import { PeriodDto } from '../finance/dto/finance.dto';
import { ExportReportDto, ReportKeyParam } from './dto/report.dto';
import { ReportExportService } from './report-export.service';
import { ReportsService } from './reports.service';

@Controller('reports')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly exportService: ReportExportService,
    private readonly i18n: I18nService,
  ) {}

  /** W-1 dashboard. */
  @Get('dashboard')
  dashboard(@CurrentUser() user: CurrentUserPayload) {
    return this.reportsService.dashboard(user);
  }

  @Get('trend')
  trend(@CurrentUser() user: CurrentUserPayload) {
    return this.reportsService.profitTrend(user);
  }

  /** W-9 report as a typed table the client renders itself. */
  @Get(':key')
  table(
    @CurrentUser() user: CurrentUserPayload,
    @Param() params: ReportKeyParam,
    @Query() period: PeriodDto,
  ) {
    return this.reportsService.table(user, params.key, period);
  }

  /** Same report as a downloadable Excel/CSV file. */
  @Get(':key/export')
  async exportFile(
    @CurrentUser() user: CurrentUserPayload,
    @Param() params: ReportKeyParam,
    @Query() query: ExportReportDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const table = await this.reportsService.table(user, params.key, query);
    const file = await this.exportService.export(
      table,
      query.format ?? 'xlsx',
      this.i18n.resolveLocale(acceptLanguage),
    );
    response
      .status(200)
      .setHeader('Content-Type', file.contentType)
      .setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
      .send(file.body);
  }
}
