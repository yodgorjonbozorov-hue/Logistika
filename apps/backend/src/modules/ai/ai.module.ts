import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { CompaniesModule } from '../companies/companies.module';
import { FilesModule } from '../files/files.module';
import { FinanceModule } from '../finance/finance.module';
import { FuelModule } from '../fuel/fuel.module';
import { ReportsModule } from '../reports/reports.module';
import { AiClient, AnthropicAiClient } from './ai.client';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AnomalyService } from './anomaly.service';
import { ChatService } from './chat.service';
import { OcrService } from './ocr.service';

@Module({
  imports: [FilesModule, AlertsModule, CompaniesModule, FuelModule, FinanceModule, ReportsModule],
  controllers: [AiController],
  providers: [
    AiService,
    OcrService,
    AnomalyService,
    ChatService,
    { provide: AiClient, useClass: AnthropicAiClient },
  ],
  exports: [AiService, AnomalyService],
})
export class AiModule {}
