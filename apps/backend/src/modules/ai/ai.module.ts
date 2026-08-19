import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { FinanceModule } from '../finance/finance.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AnalyticsFacade } from './analytics.facade';
import { AI_PROVIDER, createAiProvider } from './providers/provider.factory';

/**
 * The assistant depends on FinanceModule rather than on Prisma directly for the
 * money: every figure it quotes therefore comes from the same rollups the
 * dashboard and the reports use, and cannot drift from them.
 */
@Module({
  imports: [FinanceModule, AuditModule],
  controllers: [AiController],
  providers: [
    AiService,
    AnalyticsFacade,
    { provide: AI_PROVIDER, useFactory: createAiProvider, inject: [ConfigService] },
  ],
  exports: [AiService],
})
export class AiModule {}
