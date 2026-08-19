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
  'Route',
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
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * Drops any caller-supplied tenant pointer from a write payload.
 *
 * The tenant context is AUTHORITATIVE: `companyId` in `data` is never honoured.
 * Before this, `update({ where: { id }, data: { companyId: otherCompany } })`
 * was scoped correctly on the WHERE side but happily handed the row to another
 * tenant (C-4). Prisma accepts the FK either flat (`companyId`) or nested
 * (`company: { connect: … }`), so both spellings are neutralised.
 */
function stripTenant(data: unknown): AnyArgs {
  const { companyId: _flat, company: _relation, ...rest } = (data ?? {}) as AnyArgs;
  return rest;
}

/**
 * Same as {@link stripTenant}, then stamps the real tenant on. Used for the
 * create side, where the column has to be populated from the context.
 */
function stampTenant(data: unknown, companyId: string): AnyArgs {
  return { ...stripTenant(data), companyId };
}

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

  if (operation === 'create' || operation === 'createManyAndReturn') {
    if (operation === 'createManyAndReturn' && Array.isArray(safeArgs.data)) {
      safeArgs.data = (safeArgs.data as AnyArgs[]).map((row) => stampTenant(row, companyId));
      return safeArgs;
    }
    safeArgs.data = stampTenant(safeArgs.data, companyId);
    return safeArgs;
  }
  if (operation === 'createMany') {
    const rows = Array.isArray(safeArgs.data)
      ? (safeArgs.data as AnyArgs[])
      : [safeArgs.data as AnyArgs];
    safeArgs.data = rows.map((row) => stampTenant(row, companyId));
    return safeArgs;
  }
  if (operation === 'upsert') {
    safeArgs.where = { ...((safeArgs.where as AnyArgs) ?? {}), companyId };
    safeArgs.create = stampTenant(safeArgs.create, companyId);
    // Update side only strips: the WHERE clause already pins the tenant, and
    // re-adding the FK would clash with Prisma's checked/unchecked input union.
    safeArgs.update = stripTenant(safeArgs.update);
    return safeArgs;
  }
  if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn') {
    safeArgs.where = { ...((safeArgs.where as AnyArgs) ?? {}), companyId };
    safeArgs.data = stripTenant(safeArgs.data);
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
