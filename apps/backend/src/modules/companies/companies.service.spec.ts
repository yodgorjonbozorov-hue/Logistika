import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { CompaniesService } from './companies.service';

describe('CompaniesService.adminDelete', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  /** The transaction client, so a test can see the order deletes ran in. */
  function setup(company: { id: string; name: string } | null = { id: 'c1', name: 'Yo‘l Trans' }) {
    // Every tenant-owned delegate the service walks, plus the ones around it.
    const order: string[] = [];
    const deleteMany = (model: string) =>
      jest.fn((args: unknown) => {
        order.push(model);
        void args;
        return Promise.resolve({ count: 0 });
      });
    const tx = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }]), deleteMany: jest.fn() },
      refreshToken: { deleteMany: jest.fn() },
      company: { delete: jest.fn() },
      gpsTrackArchive: { deleteMany: deleteMany('gpsTrackArchive') },
      gpsTrack: { deleteMany: deleteMany('gpsTrack') },
      trackingLink: { deleteMany: deleteMany('trackingLink') },
      tripEvent: { deleteMany: deleteMany('tripEvent') },
      fuelLog: { deleteMany: deleteMany('fuelLog') },
      expense: { deleteMany: deleteMany('expense') },
      income: { deleteMany: deleteMany('income') },
      document: { deleteMany: deleteMany('document') },
      notification: { deleteMany: deleteMany('notification') },
      maintenance: { deleteMany: deleteMany('maintenance') },
      auditLog: { deleteMany: deleteMany('auditLog') },
      storedFile: { deleteMany: deleteMany('storedFile') },
      trip: { deleteMany: deleteMany('trip') },
      driver: { deleteMany: deleteMany('driver') },
      vehicle: { deleteMany: deleteMany('vehicle') },
      client: { deleteMany: deleteMany('client') },
      order,
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

    // Children before parents: a trip's events cannot outlive the trip.
    const { order } = tx;
    expect(order.indexOf('tripEvent')).toBeLessThan(order.indexOf('trip'));
    expect(order.indexOf('expense')).toBeLessThan(order.indexOf('trip'));
    expect(order.indexOf('gpsTrack')).toBeLessThan(order.indexOf('trip'));
    expect(order.indexOf('income')).toBeLessThan(order.indexOf('trip'));
    expect(order.indexOf('trackingLink')).toBeLessThan(order.indexOf('trip'));
    expect(order.indexOf('trip')).toBeLessThan(order.indexOf('vehicle'));
    expect(order.indexOf('trip')).toBeLessThan(order.indexOf('driver'));
    expect(order.indexOf('trip')).toBeLessThan(order.indexOf('client'));

    expect(tx.user.deleteMany).toHaveBeenCalledWith({ where: { companyId: 'c1' } });
    expect(tx.company.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('reaches every table a tenant owns', async () => {
    const { service, tx } = setup();
    await service.adminDelete('admin-1', 'c1', 'Yo‘l Trans');
    // Every model with a company_id, per the schema — a new one added there
    // without being listed in the service would leave orphan rows behind.
    expect([...tx.order].sort()).toEqual(
      [
        'auditLog',
        'client',
        'document',
        'driver',
        'expense',
        'fuelLog',
        'gpsTrack',
        'gpsTrackArchive',
        'income',
        'maintenance',
        'notification',
        'storedFile',
        'trackingLink',
        'trip',
        'tripEvent',
        'vehicle',
      ].sort(),
    );
  });

  it('scopes every delete to the one company', async () => {
    const { service, tx } = setup();
    await service.adminDelete('admin-1', 'c1', 'Yo‘l Trans');
    for (const model of tx.order) {
      const delegate = (tx as unknown as Record<string, { deleteMany: jest.Mock }>)[model]!;
      expect(delegate.deleteMany).toHaveBeenCalledWith({ where: { companyId: 'c1' } });
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
