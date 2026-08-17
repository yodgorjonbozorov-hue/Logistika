import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/** Keys are only useful while a client might still retry. */
const KEY_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyCleanup {
  private readonly logger = new Logger(IdempotencyCleanup.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredKeys(): Promise<void> {
    try {
      const { count } = await this.prisma.idempotencyKey.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - KEY_TTL_MS) } },
      });
      if (count > 0) this.logger.log(`Purged ${count} expired idempotency keys`);
    } catch (error) {
      this.logger.error(
        `Idempotency key purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
