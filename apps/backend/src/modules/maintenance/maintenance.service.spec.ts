import { MaintenanceType } from 'shared';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import type { AuditService } from '../audit/audit.service';
import { MaintenanceService } from './maintenance.service';

function setup() {
  const { prisma, db, forCompany } = createTenantDbMock(['maintenance', 'vehicle']);
  const audit = { log: jest.fn() } as unknown as AuditService;
  return { service: new MaintenanceService(prisma, audit), db, forCompany, audit };
}

describe('MaintenanceService', () => {
  it('stores the cost as BigInt tiyin and the date as a Date', async () => {
    const { service, db } = setup();
    db.maintenance!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'm1', ...data }),
    );

    await service.create(ACTOR, {
      vehicleId: '11111111-1111-1111-1111-111111111111',
      type: MaintenanceType.PLANNED_TO,
      cost: '112000000',
      serviceDate: '2026-08-15T00:00:00Z',
    });

    const data = db.maintenance!.create!.mock.calls[0][0].data;
    expect(data.cost).toBe(112_000_000n);
    expect(typeof data.cost).toBe('bigint');
    expect(data.serviceDate).toBeInstanceOf(Date);
  });

  it('moves the vehicle’s next-service plan, which is what the alert reads', async () => {
    const { service, db } = setup();
    db.maintenance!.create!.mockResolvedValue({ id: 'm1', type: 'PLANNED_TO', odometer: 412_000 });

    await service.create(ACTOR, {
      vehicleId: 'v1',
      type: MaintenanceType.PLANNED_TO,
      odometer: 412_000,
      nextServiceOdometer: 427_000,
    });

    expect(db.vehicle!.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { nextServiceOdometer: 427_000 },
    });
  });

  it('leaves the plan alone when the record does not mention it', async () => {
    const { service, db } = setup();
    db.maintenance!.create!.mockResolvedValue({ id: 'm1', type: 'REPAIR' });

    await service.create(ACTOR, { vehicleId: 'v1', type: MaintenanceType.REPAIR });

    expect(db.vehicle!.update).not.toHaveBeenCalled();
  });

  it("cannot touch another company's record — the scoped read finds nothing", async () => {
    const { service, db, forCompany } = setup();
    db.maintenance!.findUnique!.mockResolvedValue(null);

    await expect(service.update(ACTOR, 'm-of-company-b', {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.remove(ACTOR, 'm-of-company-b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(forCompany).toHaveBeenCalledWith(ACTOR.companyId);
  });

  it('lists a vehicle’s history newest first', async () => {
    const { service, db } = setup();
    await service.list(ACTOR, { vehicleId: 'v1', page: 1, limit: 20, skip: 0 } as never);

    const args = db.maintenance!.findMany!.mock.calls[0][0];
    expect(args.where).toEqual({ vehicleId: 'v1' });
    expect(args.orderBy).toEqual([{ serviceDate: 'desc' }, { createdAt: 'desc' }]);
  });
});
