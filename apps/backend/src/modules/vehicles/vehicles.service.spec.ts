import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { VehiclesService } from './vehicles.service';

/**
 * Retiring a vehicle used to be unconditional (TASK-3.10).
 *
 * A truck that is out on a run is not something that can be retired today: the
 * trip still has to collect its fuel, its kilometres and its costs.
 */
describe('VehiclesService.deactivate', () => {
  const audit = {
    log: jest.fn(),
    logInTx: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  function setup() {
    const { prisma, db } = createTenantDbMock(['vehicle', 'trip']);
    db.vehicle!.findUnique!.mockResolvedValue({ id: 'v1', plateNumber: '01A123BC' });
    db.vehicle!.update!.mockResolvedValue({ id: 'v1', isActive: false });
    db.trip!.findFirst!.mockResolvedValue(null);
    return { service: new VehiclesService(prisma, audit), db };
  }

  it('retires a truck that is not committed to any trip', async () => {
    const { service, db } = setup();

    await service.deactivate(ACTOR, 'v1');

    expect(db.vehicle!.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { isActive: false },
    });
  });

  it('refuses while the truck is out, and names the trip', async () => {
    const { service, db } = setup();
    db.trip!.findFirst!.mockResolvedValue({
      id: 't9',
      tripNumber: 'TR-2026-0041',
      status: 'IN_PROGRESS',
    });

    await expect(service.deactivate(ACTOR, 'v1')).rejects.toMatchObject({
      code: 'RESOURCE_IN_USE',
      httpStatus: 409,
      details: { tripNumber: 'TR-2026-0041' },
    });
    expect(db.vehicle!.update).not.toHaveBeenCalled();
  });

  it('counts a planned trip as well as one under way', async () => {
    const { service, db } = setup();

    await service.deactivate(ACTOR, 'v1');

    expect(db.trip!.findFirst!.mock.calls[0][0].where).toEqual({
      vehicleId: 'v1',
      status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
    });
  });

  it('reports a vehicle from another tenant as missing, not as busy', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue(null);

    await expect(service.deactivate(ACTOR, 'someone-elses-truck')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(db.trip!.findFirst).not.toHaveBeenCalled();
  });
});
