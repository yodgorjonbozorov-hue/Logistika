import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { CompaniesService } from './companies.service';

describe('CompaniesService (superadmin surface)', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  function setup() {
    const company = {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };
    const user = { count: jest.fn().mockResolvedValue(0) };
    const trip = { count: jest.fn().mockResolvedValue(0) };
    const prisma = {
      company,
      user,
      trip,
      // The real $transaction takes an array of promises and resolves them.
      $transaction: jest.fn((calls: Promise<unknown>[]) => Promise.all(calls)),
    } as unknown as PrismaService;
    return { service: new CompaniesService(prisma, audit), company, user, trip };
  }

  it('flattens owner and counts onto the company row', async () => {
    const { service, company } = setup();
    company.findMany.mockResolvedValue([
      {
        id: 'c1',
        name: 'Demo',
        _count: { users: 4, trips: 12 },
        users: [{ id: 'u1', fullName: 'Owner', email: 'o@x.uz', phone: null, isActive: true }],
      },
    ]);

    const { data } = await service.adminList({ page: 1, limit: 20, skip: 0 });

    expect(data[0]).toMatchObject({
      id: 'c1',
      userCount: 4,
      tripCount: 12,
      owner: { id: 'u1', fullName: 'Owner' },
    });
    expect(data[0]).not.toHaveProperty('_count');
  });

  it('reports no owner rather than throwing when a tenant has none', async () => {
    const { service, company } = setup();
    company.findUnique.mockResolvedValue({
      id: 'c1',
      name: 'Demo',
      _count: { users: 0, trips: 0 },
      users: [],
    });

    await expect(service.adminGetById('c1')).resolves.toMatchObject({ owner: null });
  });

  it('404s on an unknown company', async () => {
    const { service, company } = setup();
    company.findUnique.mockResolvedValue(null);
    await expect(service.adminGetById('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('counts trial tenants as "no plan or TRIAL" and expired by subscription date', async () => {
    const { service, company } = setup();
    const now = new Date('2026-08-18T00:00:00Z');

    await service.adminStats(now);

    const trialWhere = company.count.mock.calls[2][0].where;
    expect(trialWhere.OR).toEqual([{ tariffPlan: null }, { tariffPlan: 'TRIAL' }]);
    const expiredWhere = company.count.mock.calls[3][0].where;
    expect(expiredWhere.subscriptionUntil.lt).toBe(now);
  });
});
