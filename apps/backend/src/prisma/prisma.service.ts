import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { rlsExtension, TENANT_SETTING } from './rls.extension';
import { tenantExtension } from './tenant.extension';

interface RolePrivileges {
  role: string;
  superuser: boolean;
  bypassRls: boolean;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Connection used for tenant-scoped traffic. In production it must be a role
   * WITHOUT BYPASSRLS (DATABASE_URL_APP), so that row-level security actually
   * applies to it; the privileged connection this service extends stays for
   * platform work — login lookups before a tenant is known, SUPERADMIN
   * operations, migrations and health checks.
   */
  private readonly tenantClient: PrismaClient;
  private readonly usesSeparateTenantRole: boolean;

  constructor(private readonly config: ConfigService) {
    super();
    const appUrl = config.get<string>('DATABASE_URL_APP');
    this.usesSeparateTenantRole = Boolean(appUrl);
    this.tenantClient = appUrl
      ? new PrismaClient({ datasources: { db: { url: appUrl } } })
      : (this as PrismaClient);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    if (this.usesSeparateTenantRole) await this.tenantClient.$connect();
    await this.assertTenantRoleCannotBypassRls();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.usesSeparateTenantRole) await this.tenantClient.$disconnect();
    await this.$disconnect();
  }

  /**
   * Tenant-scoped client: every query on tenant models is automatically
   * filtered/stamped with the given company_id (layer 2) and runs with the
   * PostgreSQL tenant context set (layer 3). All request-handling code MUST use
   * this instead of the bare client (except auth/user lookup, which happens
   * before the tenant is known).
   */
  forCompany(companyId: string | null | undefined) {
    const id = this.requireCompany(companyId);
    return this.tenantClient
      .$extends(rlsExtension(this.tenantClient, id))
      .$extends(tenantExtension(id));
  }

  /**
   * Same guarantees, but for work that must be atomic: the tenant context is
   * declared once for the whole transaction, so the callback's client carries
   * the tenant scope without opening a nested transaction per statement.
   */
  async forCompanyTx<T>(
    companyId: string | null | undefined,
    fn: (tx: TenantScopedClient) => Promise<T>,
  ): Promise<T> {
    const id = this.requireCompany(companyId);
    // Extend first, open the transaction second: a transaction client has no
    // $extends of its own, but it inherits the extensions of the client that
    // started it.
    const scoped = tenantScoped(this.tenantClient, id);
    return scoped.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${id}, true)`;
      return fn(tx);
    });
  }

  private requireCompany(companyId: string | null | undefined): string {
    if (!companyId) {
      throw new AppException('TENANT_MISSING', HttpStatus.FORBIDDEN);
    }
    return companyId;
  }

  /**
   * A tenant connection that can bypass RLS turns the third isolation layer
   * into decoration. In production that is a fatal misconfiguration; elsewhere
   * it is normal (the dev database runs as its owner) and only warned about.
   */
  private async assertTenantRoleCannotBypassRls(): Promise<void> {
    let privileges: RolePrivileges;
    try {
      const rows = await this.tenantClient.$queryRaw<
        Array<{ role: string; superuser: boolean; bypass_rls: boolean }>
      >`SELECT current_user AS role, rolsuper AS superuser, rolbypassrls AS bypass_rls
          FROM pg_roles WHERE rolname = current_user`;
      const row = rows[0];
      if (!row) return;
      privileges = { role: row.role, superuser: row.superuser, bypassRls: row.bypass_rls };
    } catch (error) {
      // Never block startup on a diagnostic query.
      this.logger.warn(
        `Could not determine database role privileges: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    if (!privileges.superuser && !privileges.bypassRls) {
      this.logger.log(`Row-level security active for database role "${privileges.role}"`);
      return;
    }

    const message =
      `Database role "${privileges.role}" bypasses row-level security ` +
      `(superuser=${privileges.superuser}, bypassrls=${privileges.bypassRls}). ` +
      'Set DATABASE_URL_APP to a restricted role — see docs/DEPLOYMENT.md.';

    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new Error(message);
    }
    this.logger.warn(`${message} Tolerated outside production.`);
  }
}

function tenantScoped(client: PrismaClient, companyId: string) {
  return client.$extends(tenantExtension(companyId));
}

/**
 * The tenant-scoped client handed to forCompanyTx callbacks: a transaction
 * client, so the connection-level methods are not part of it.
 */
export type TenantScopedClient = Omit<
  ReturnType<typeof tenantScoped>,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
