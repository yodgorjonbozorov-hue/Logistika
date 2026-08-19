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
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateManyAndReturn: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    };
  }
  const forCompany = jest.fn().mockReturnValue(db);
  // Raw-SQL escape hatches used by the trip-number allocator and DISTINCT ON.
  const $queryRaw = jest.fn().mockResolvedValue([]);
  const $executeRaw = jest.fn().mockResolvedValue(0);
  // RefreshToken is deliberately OUTSIDE the tenant scope (it is keyed by user),
  // so it is reached through the bare client rather than through forCompany().
  const refreshToken = {
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    findUnique: jest.fn(),
    create: jest.fn(),
  };
  return {
    prisma: {
      forCompany,
      $queryRaw,
      $executeRaw,
      refreshToken,
    } as unknown as import('../prisma/prisma.service').PrismaService,
    db,
    forCompany,
    refreshToken,
    $queryRaw,
    $executeRaw,
  };
}

export const ACTOR = {
  userId: 'user-1',
  companyId: 'company-a',
  role: 'OWNER',
} as import('shared').CurrentUserPayload;

/** DriversService stub for the modules that only need the profile lookup. */
export function createDriversStub(driver: { id: string } | null = { id: 'd1' }) {
  return {
    requireProfile: jest.fn(() =>
      driver ? Promise.resolve(driver) : Promise.reject(new Error('DRIVER_PROFILE_MISSING')),
    ),
  } as unknown as import('../modules/drivers/drivers.service').DriversService;
}

/** SessionStateService stub for services that invalidate cached verdicts. */
export function createSessionStateStub() {
  return {
    invalidate: jest.fn(),
    assertUsable: jest.fn(),
  } as unknown as import('../common/guards/session-state.service').SessionStateService;
}
