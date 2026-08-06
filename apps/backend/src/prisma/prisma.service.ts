import { HttpStatus, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { tenantExtension } from './tenant.extension';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
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
