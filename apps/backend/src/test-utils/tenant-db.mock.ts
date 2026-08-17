/** Builds a PrismaService mock whose forCompany() returns per-model jest.fn stubs. */
export function createTenantDbMock(models: string[]) {
  const db: Record<string, Record<string, jest.Mock>> = {};
  for (const model of models) {
    db[model] = {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    };
  }
  // Interactive transactions run their callback against the same scoped stubs,
  // so a test can assert on the writes made inside one.
  (db as Record<string, unknown>).$transaction = jest.fn(
    (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(db) : arg),
  );
  const forCompany = jest.fn().mockReturnValue(db);
  // forCompanyTx hands the callback the same scoped stubs, so a test can assert
  // on writes made inside a tenant transaction.
  const forCompanyTx = jest.fn(
    (_companyId: unknown, fn: (tx: unknown) => unknown) => fn(db),
  );
  return {
    prisma: { forCompany, forCompanyTx } as unknown as import('../prisma/prisma.service').PrismaService,
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
