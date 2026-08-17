import { Prisma, type PrismaClient } from '@prisma/client';

/** Postgres session variable the tenant_isolation policies read. */
export const TENANT_SETTING = 'app.company_id';

/**
 * Declares the acting tenant to PostgreSQL for the duration of one query.
 *
 * `set_config(..., true)` is transaction-local, so the value cannot leak to the
 * next request that borrows the same pooled connection. Every model operation
 * therefore runs as a two-statement transaction: declare the tenant, then run
 * the query. That is the cost of having the database enforce isolation instead
 * of trusting application code to remember a WHERE clause.
 *
 * Raw queries ($queryRaw/$executeRaw) are not covered — they bypass the model
 * layer entirely. Use PrismaService.forCompanyTx() when raw SQL needs tenant
 * context.
 */
export function rlsExtension(client: PrismaClient, companyId: string) {
  return Prisma.defineExtension({
    name: 'rls-tenant-context',
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await client.$transaction([
            client.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${companyId}, true)`,
            query(args) as Prisma.PrismaPromise<unknown>,
          ]);
          return result;
        },
      },
    },
  });
}
