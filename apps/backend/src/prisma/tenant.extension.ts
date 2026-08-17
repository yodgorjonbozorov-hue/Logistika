import { Prisma } from '@prisma/client';

/**
 * Models that carry `company_id`. Every query against them is forcibly scoped
 * to one tenant (CLAUDE.md rule: no query without a company_id filter).
 * `Company`, `RefreshToken`, `AuditLog` and `TrackingLink` are intentionally
 * outside the scope: Company IS the tenant, RefreshToken is keyed by user,
 * AuditLog may be platform-wide, TrackingLink is looked up by bare public token.
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
  'GpsTrackArchive',
  'AiSettings',
  'AiRequest',
  'AiInsight',
  'ChatMessage',
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

/**
 * Scopes the arguments AND hands the tenant to PostgreSQL, so the row-level
 * security policies of migration `20260818000000_rls` apply to the same query.
 *
 * The setting is transaction-local, which is why the operation is run as a
 * two-statement batch: a pooled connection cannot carry one request's tenant
 * into the next request's query. The bare client (auth, cron jobs, seed) sets
 * nothing and stays unrestricted — that escape hatch is documented with the
 * policies themselves.
 *
 * The setting is sent for every model, not only the scoped ones: a model
 * missing from TENANT_MODELS is precisely the mistake this second layer is
 * here to catch.
 */
export function tenantExtension(companyId: string) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'tenant-scope',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const scoped = TENANT_MODELS.has(model)
              ? query(applyTenantScope(operation, args as AnyArgs, companyId) as typeof args)
              : query(args);
            const [, result] = await client.$transaction([
              client.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`,
              scoped,
            ]);
            return result;
          },
        },
      },
    }),
  );
}
