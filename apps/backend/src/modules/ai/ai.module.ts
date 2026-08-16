import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { CompaniesModule } from '../companies/companies.module';
import { FilesModule } from '../files/files.module';
import { AiClient, AnthropicAiClient } from './ai.client';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { OcrService } from './ocr.service';

@Module({
  imports: [FilesModule, AlertsModule, CompaniesModule],
  controllers: [AiController],
  providers: [AiService, OcrService, { provide: AiClient, useClass: AnthropicAiClient }],
  exports: [AiService],
})
export class AiModule {}
