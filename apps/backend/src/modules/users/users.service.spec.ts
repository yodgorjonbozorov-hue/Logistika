import { UserRole } from 'shared';
import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { UsersService } from './users.service';

describe('UsersService (tenant-scoped CRUD)', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  function setup() {
    const { prisma, db, forCompany } = createTenantDbMock(['user']);
    const service = new UsersService(prisma, audit);
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

  it('deactivates instead of deleting', async () => {
    const { service, db } = setup();
    db.user!.update!.mockResolvedValue({ id: 'u2', isActive: false, passwordHash: 'x' });
    await service.deactivate(ACTOR, 'u2');
    expect(db.user!.update).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { isActive: false },
    });
    expect(db.user!.delete).not.toHaveBeenCalled();
  });
});
