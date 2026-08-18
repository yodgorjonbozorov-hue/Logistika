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
      delete: jest.fn(),
      deleteMany: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
      groupBy: jest.fn().mockResolvedValue([]),
    };
  }
  const forCompany = jest.fn().mockReturnValue(db);
  return {
    prisma: { forCompany } as unknown as import('../prisma/prisma.service').PrismaService,
    db,
    forCompany,
  };
}

export const ACTOR = {
  userId: 'user-1',
  companyId: 'company-a',
  role: 'OWNER',
} as import('shared').CurrentUserPayload;
