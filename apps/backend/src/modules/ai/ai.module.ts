import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { AiClientService } from './ai-client.service';
import { AiController } from './ai.controller';
import { OcrService } from './ocr.service';

@Module({
  imports: [FilesModule],
  controllers: [AiController],
  providers: [AiClientService, OcrService],
  exports: [AiClientService],
})
export class AiModule {}
