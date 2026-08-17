import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { tenantExtension } from './tenant.extension';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.warnIfRlsIsBypassed();
  }

  /**
   * Row-level security is the third isolation layer, and PostgreSQL grants a
   * superuser (or a BYPASSRLS role) a silent exemption from it — the policies
   * stay in `pg_policy`, look installed, and do nothing. That failure is
   * invisible from inside the application, so it is said out loud at boot
   * rather than discovered during an incident (docs/SECURITY.md F-4).
   */
  private async warnIfRlsIsBypassed(): Promise<void> {
    const [role] = await this.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    if (role?.rolsuper || role?.rolbypassrls) {
      this.logger.warn(
        'Database role bypasses row-level security; the tenant policies are inert. ' +
          'Use a non-superuser role without BYPASSRLS (docs/DEPLOY.md §3).',
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
