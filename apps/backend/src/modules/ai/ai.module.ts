import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { CompaniesModule } from '../companies/companies.module';
import { FilesModule } from '../files/files.module';
import { FinanceModule } from '../finance/finance.module';
import { DocumentsModule } from '../documents/documents.module';
import { FuelModule } from '../fuel/fuel.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { AiClient, AnthropicAiClient } from './ai.client';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AnomalyService } from './anomaly.service';
import { ChatService } from './chat.service';
import { DigestService } from './digest.service';
import { TranscribeClient, WhisperTranscribeClient } from './transcribe.client';
import { VoiceService } from './voice.service';
import { OcrService } from './ocr.service';

@Module({
  imports: [
    FilesModule,
    AlertsModule,
    CompaniesModule,
    FuelModule,
    FinanceModule,
    ReportsModule,
    DocumentsModule,
    NotificationsModule,
  ],
  controllers: [AiController],
  providers: [
    AiService,
    OcrService,
    AnomalyService,
    ChatService,
    DigestService,
    VoiceService,
    { provide: AiClient, useClass: AnthropicAiClient },
    { provide: TranscribeClient, useClass: WhisperTranscribeClient },
  ],
  exports: [AiService, AnomalyService, DigestService],
})
export class AiModule {}
