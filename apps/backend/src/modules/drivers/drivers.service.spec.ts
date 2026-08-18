import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { DriversService } from './drivers.service';

/**
 * Deactivating a driver used to be unconditional (TASK-3.10).
 *
 * `listMine` and `requireDriverProfile` both filter on `isActive`, so a driver
 * switched off mid-route lost the trip from their phone and had every event
 * refused — the receipts and delivery proof for the rest of that run were
 * simply never recorded.
 */
describe('DriversService.deactivate', () => {
  const audit = {
    log: jest.fn(),
    logInTx: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  function setup() {
    const { prisma, db } = createTenantDbMock(['driver', 'trip']);
    db.driver!.findUnique!.mockResolvedValue({ id: 'd1', fullName: 'Anvar', isActive: true });
    db.driver!.update!.mockResolvedValue({ id: 'd1', isActive: false });
    db.trip!.findFirst!.mockResolvedValue(null);
    return { service: new DriversService(prisma, audit), db };
  }

  it('retires a driver who is not on any trip', async () => {
    const { service, db } = setup();

    await service.deactivate(ACTOR, 'd1');

    expect(db.driver!.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { isActive: false },
    });
  });

  it('refuses while the driver is out on a trip, and names it', async () => {
    const { service, db } = setup();
    db.trip!.findFirst!.mockResolvedValue({
      id: 't9',
      tripNumber: 'TR-2026-0041',
      status: 'IN_PROGRESS',
    });

    await expect(service.deactivate(ACTOR, 'd1')).rejects.toMatchObject({
      code: 'RESOURCE_IN_USE',
      httpStatus: 409,
      details: { tripId: 't9', tripNumber: 'TR-2026-0041', status: 'IN_PROGRESS' },
    });
    expect(db.driver!.update).not.toHaveBeenCalled();
  });

  it('refuses for a planned trip too, not only one under way', async () => {
    const { service, db } = setup();
    db.trip!.findFirst!.mockResolvedValue({
      id: 't9',
      tripNumber: 'TR-2026-0042',
      status: 'ASSIGNED',
    });

    // An ASSIGNED trip whose driver was retired is a trip that can never
    // start, and nothing would say so until the morning it was due.
    await expect(service.deactivate(ACTOR, 'd1')).rejects.toMatchObject({
      code: 'RESOURCE_IN_USE',
    });
  });

  it('only looks at planned and running trips', async () => {
    const { service, db } = setup();

    await service.deactivate(ACTOR, 'd1');

    // A driver with a hundred finished trips is exactly who gets retired.
    expect(db.trip!.findFirst!.mock.calls[0][0].where).toEqual({
      driverId: 'd1',
      status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
    });
  });

  it('reports a driver from another tenant as missing, not as busy', async () => {
    const { service, db } = setup();
    db.driver!.findUnique!.mockResolvedValue(null);

    await expect(service.deactivate(ACTOR, 'someone-elses-driver')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(db.trip!.findFirst).not.toHaveBeenCalled();
  });
});
