import { UserRole } from 'shared';
import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { UsersService } from './users.service';
import type { TokenVersionService } from '../../common/auth/token-version.service';

describe('UsersService (tenant-scoped CRUD)', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  function setup() {
    const { prisma, db, forCompany } = createTenantDbMock(['user']);
    // Revoking sessions is exercised in the auth specs; here it only has to
    // exist so the tenant-scoped CRUD can be asserted.
    (prisma as unknown as { refreshToken: unknown }).refreshToken = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const tokenVersions = { invalidate: jest.fn() } as unknown as TokenVersionService;
    const service = new UsersService(prisma, audit, tokenVersions);
    return { service, db, forCompany };
  }

  it('always resolves the tenant client with the actor companyId', async () => {
    const { service, db, forCompany } = setup();
    db.user!.findMany!.mockResolvedValue([]);
    await service.list(
      ACTOR,
      Object.assign(new (await import('../../common/dto/pagination.dto')).PaginationDto()),
    );
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });

  it('hashes the password and never returns the hash', async () => {
    const { service, db } = setup();
    db.user!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'u2', ...data }),
    );

    const result = await service.create(ACTOR, {
      fullName: 'New Logist',
      email: 'logist@test.uz',
      password: 'secret-password',
      role: UserRole.LOGIST,
    });

    const passed = db.user!.create!.mock.calls[0][0].data;
    expect(passed.passwordHash).toBeDefined();
    expect(passed.passwordHash).not.toBe('secret-password');
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('refuses self-deactivation', async () => {
    const { service } = setup();
    await expect(service.deactivate(ACTOR, ACTOR.userId)).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('deactivates instead of deleting, and ends every session', async () => {
    const { service, db } = setup();
    db.user!.update!.mockResolvedValue({ id: 'u2', isActive: false, passwordHash: 'x' });

    await service.deactivate(ACTOR, 'u2');

    // The token version is what stops the access token the user is holding —
    // without it a switched-off account kept full access for 15 minutes (M-2).
    expect(db.user!.update).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { isActive: false, tokenVersion: { increment: 1 } },
    });
    expect(db.user!.delete).not.toHaveBeenCalled();
  });

  it('ends every session when a user is demoted', async () => {
    const { service, db } = setup();
    db.user!.update!.mockResolvedValue({ id: 'u2', role: 'DRIVER', passwordHash: 'x' });

    await service.update(ACTOR, 'u2', { role: 'DRIVER' } as never);

    // An OWNER demoted to DRIVER kept owner rights until their token expired.
    expect(db.user!.update!.mock.calls[0][0].data.tokenVersion).toEqual({ increment: 1 });
  });

  it('leaves sessions alone for a harmless edit', async () => {
    const { service, db } = setup();
    db.user!.update!.mockResolvedValue({ id: 'u2', passwordHash: 'x' });

    await service.update(ACTOR, 'u2', { fullName: 'Yangi Ism' } as never);

    // Renaming somebody is not a reason to log them out of everything.
    expect(db.user!.update!.mock.calls[0][0].data.tokenVersion).toBeUndefined();
  });
});
