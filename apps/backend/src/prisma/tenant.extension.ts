import { Prisma } from '@prisma/client';

/**
 * Models that carry `company_id`. Every query against them is forcibly scoped
 * to one tenant (CLAUDE.md rule: no query without a company_id filter).
 * `Company`, `RefreshToken` and `AuditLog` are intentionally outside the scope:
 * Company IS the tenant, RefreshToken is keyed by user, AuditLog may be platform-wide.
 */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'User',
  'Driver',
  'Vehicle',
  'Client',
  'Trip',
  'TripEvent',
  'Expense',
  'FuelLog',
  'Income',
  'GpsTrack',
  'Maintenance',
  'Document',
  'Notification',
  'StoredFile',
]);

type AnyArgs = Record<string, unknown>;

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * Injects the tenant scope into Prisma call arguments.
 * Note: nested writes are not rewritten here — PostgreSQL RLS is the final
 * guard for those (ARCHITECTURE.md, himoya qatlami #3).
 */
export function applyTenantScope(
  operation: string,
  args: AnyArgs | undefined,
  companyId: string,
): AnyArgs {
  const safeArgs: AnyArgs = { ...(args ?? {}) };

  if (operation === 'create') {
    safeArgs.data = { ...((safeArgs.data as AnyArgs) ?? {}), companyId };
    return safeArgs;
  }
  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const rows = Array.isArray(safeArgs.data)
      ? (safeArgs.data as AnyArgs[])
      : [safeArgs.data as AnyArgs];
    safeArgs.data = rows.map((row) => ({ ...row, companyId }));
    return safeArgs;
  }
  if (operation === 'upsert') {
    safeArgs.where = { ...((safeArgs.where as AnyArgs) ?? {}), companyId };
    safeArgs.create = { ...((safeArgs.create as AnyArgs) ?? {}), companyId };
    return safeArgs;
  }
  if (WHERE_OPERATIONS.has(operation)) {
    safeArgs.where = { ...((safeArgs.where as AnyArgs) ?? {}), companyId };
    return safeArgs;
  }
  return safeArgs;
}

export function tenantExtension(companyId: string) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          return query(applyTenantScope(operation, args as AnyArgs, companyId) as typeof args);
        },
      },
    },
  });
}
