import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { CompaniesService } from './companies.service';

describe('CompaniesService.adminDelete', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  /** The transaction client, so a test can see the order deletes ran in. */
  function setup(company: { id: string; name: string } | null = { id: 'c1', name: 'Yo‘l Trans' }) {
    const tx = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }]), deleteMany: jest.fn() },
      refreshToken: { deleteMany: jest.fn() },
      company: { delete: jest.fn() },
      $executeRawUnsafe: jest.fn(),
    };
    const prisma = {
      company: { findUnique: jest.fn().mockResolvedValue(company) },
      $transaction: jest.fn((run: (t: typeof tx) => unknown) => run(tx)),
    } as unknown as PrismaService;
    return { service: new CompaniesService(prisma, audit), prisma, tx };
  }

  beforeEach(() => jest.clearAllMocks());

  it('refuses a name that does not match, and touches nothing', async () => {
    const { service, prisma } = setup();
    await expect(service.adminDelete('admin-1', 'c1', 'Wrong Name')).rejects.toMatchObject({
      code: 'CONFIRMATION_MISMATCH',
      httpStatus: 400,
    });
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).not.toHaveBeenCalled();
  });

  it('refuses a company that does not exist', async () => {
    const { service } = setup(null);
    await expect(service.adminDelete('admin-1', 'ghost', 'anything')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('accepts the name with surrounding whitespace trimmed', async () => {
    const { service } = setup();
    await expect(service.adminDelete('admin-1', 'c1', '  Yo‘l Trans  ')).resolves.toEqual({
      deleted: true,
      name: 'Yo‘l Trans',
    });
  });

  it('clears sessions, then tenant rows, then users, then the company itself', async () => {
    const { service, tx } = setup();
    await service.adminDelete('admin-1', 'c1', 'Yo‘l Trans');

    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: { in: ['u1'] } } });

    const tables = tx.$executeRawUnsafe.mock.calls.map(
      ([sql]) => /FROM "([a-z_]+)"/.exec(sql as string)?.[1],
    );
    // Children before parents: a trip's events cannot outlive the trip.
    expect(tables.indexOf('trip_events')).toBeLessThan(tables.indexOf('trips'));
    expect(tables.indexOf('expenses')).toBeLessThan(tables.indexOf('trips'));
    expect(tables.indexOf('gps_tracks')).toBeLessThan(tables.indexOf('trips'));
    expect(tables.indexOf('trips')).toBeLessThan(tables.indexOf('vehicles'));
    expect(tables.indexOf('trips')).toBeLessThan(tables.indexOf('drivers'));
    expect(tables.indexOf('trips')).toBeLessThan(tables.indexOf('clients'));

    expect(tx.user.deleteMany).toHaveBeenCalledWith({ where: { companyId: 'c1' } });
    expect(tx.company.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('scopes every raw delete to the one company', async () => {
    const { service, tx } = setup();
    await service.adminDelete('admin-1', 'c1', 'Yo‘l Trans');
    for (const [sql, id] of tx.$executeRawUnsafe.mock.calls) {
      expect(sql as string).toContain('WHERE company_id = $1');
      expect(id).toBe('c1');
    }
  });

  it('does not try to clear sessions when the tenant has no users', async () => {
    const { service, tx } = setup();
    tx.user.findMany.mockResolvedValue([]);
    await service.adminDelete('admin-1', 'c1', 'Yo‘l Trans');
    expect(tx.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it('records the deletion without pointing the audit row at the deleted company', async () => {
    const { service } = setup();
    await service.adminDelete('admin-1', 'c1', 'Yo‘l Trans');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: null,
        userId: 'admin-1',
        action: 'DELETE',
        entityType: 'Company',
        entityId: 'c1',
      }),
    );
  });
});
