import { Module } from '@nestjs/common';
import { I18nModule } from '../../i18n/i18n.module';
import { FinanceModule } from '../finance/finance.module';
import { ReportExportService } from './report-export.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [FinanceModule, I18nModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportExportService],
  exports: [ReportsService],
})
export class ReportsModule {}
