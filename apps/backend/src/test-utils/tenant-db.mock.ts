/** Builds a PrismaService mock whose forCompany() returns per-model jest.fn stubs. */
export function createTenantDbMock(models: string[]) {
  const db: Record<string, Record<string, jest.Mock>> = {};
  for (const model of models) {
    db[model] = {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
      groupBy: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      // A guarded write lands by default; a test that cares about losing the
      // race overrides this with { count: 0 }.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    // A guarded write reads the row back after its updateMany. Delegating keeps
    // one mock per model: a test still only has to stub findUnique.
    db[model]!.findUniqueOrThrow = jest.fn((args: unknown) => db[model]!.findUnique!(args));
  }
  // Interactive transactions run their callback against the same scoped stubs,
  // so a test can assert on the writes made inside one.
  (db as Record<string, unknown>).$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(db) : arg,
  );
  const forCompany = jest.fn().mockReturnValue(db);
  // forCompanyTx hands the callback the same scoped stubs, so a test can assert
  // on writes made inside a tenant transaction.
  const forCompanyTx = jest.fn((_companyId: unknown, fn: (tx: unknown) => unknown) => fn(db));
  return {
    prisma: {
      forCompany,
      forCompanyTx,
    } as unknown as import('../prisma/prisma.service').PrismaService,
    db,
    forCompany,
    forCompanyTx,
  };
}

export const ACTOR = {
  userId: 'user-1',
  companyId: 'company-a',
  role: 'OWNER',
} as import('shared').CurrentUserPayload;

/**
 * A cron lock that always lets the work through, for tests about what a job
 * *does*. A test about the lock itself passes `{ acquired: false }`.
 */
export function createCronLockMock(options: { acquired?: boolean } = {}) {
  const acquired = options.acquired ?? true;
  const runExclusive = jest.fn(async (_name: string, work: () => Promise<void>) => {
    if (!acquired) return false;
    await work();
    return true;
  });
  return {
    cronLock: {
      runExclusive,
    } as unknown as import('../common/jobs/cron-lock.service').CronLockService,
    runExclusive,
  };
}

/** A ConfigService double backed by a plain object. */
export function createConfigMock(values: Record<string, string> = {}) {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Missing configuration: ${key}`);
      return value;
    },
  } as unknown as import('@nestjs/config').ConfigService;
}
