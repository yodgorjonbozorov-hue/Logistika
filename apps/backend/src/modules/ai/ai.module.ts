import { Module } from '@nestjs/common';
import { AiClient, AnthropicAiClient } from './ai.client';
import { AiService } from './ai.service';

@Module({
  providers: [AiService, { provide: AiClient, useClass: AnthropicAiClient }],
  exports: [AiService],
})
export class AiModule {}
