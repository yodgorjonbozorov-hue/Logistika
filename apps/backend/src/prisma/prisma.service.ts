import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { tenantExtension } from './tenant.extension';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Warms the pool at start-up, but never blocks it. Prisma connects lazily on
   * the first query anyway, and on a serverless platform a database that is
   * briefly unreachable would otherwise fail every cold start instead of a
   * single request.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      this.logger.error(
        `Initial database connection failed, will retry on first query: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Tenant-scoped client: every query on tenant models is automatically
   * filtered/stamped with the given company_id. All request-handling code
   * MUST use this instead of the bare client (except auth/user lookup,
   * which happens before the tenant is known).
   */
  forCompany(companyId: string | null | undefined) {
    if (!companyId) {
      throw new AppException('TENANT_MISSING', HttpStatus.FORBIDDEN);
    }
    return this.$extends(tenantExtension(companyId));
  }
}
