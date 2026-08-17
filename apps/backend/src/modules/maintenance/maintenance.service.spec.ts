import { AlertType, MaintenanceType } from 'shared';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import type { AlertsService } from '../alerts/alerts.service';
import type { AuditService } from '../audit/audit.service';
import { ListMaintenanceDto } from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

function setup() {
  const { prisma, db, forCompany } = createTenantDbMock(['maintenance', 'vehicle']);
  const alerts = { raise: jest.fn(), raiseMany: jest.fn().mockResolvedValue(0) };
  const audit = { record: jest.fn(), log: jest.fn() };
  const service = new MaintenanceService(
    prisma,
    alerts as unknown as AlertsService,
    audit as unknown as AuditService,
  );
  return { service, db, forCompany, alerts, audit };
}

describe('MaintenanceService.create', () => {
  it('refuses a vehicle from another tenant', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue(null);

    await expect(
      service.create(ACTOR, {
        vehicleId: 'vehicle-of-company-b',
        type: MaintenanceType.PLANNED_TO,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.maintenance!.create).not.toHaveBeenCalled();
  });

  it('stores the cost as BigInt and moves the vehicle service point along', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue({ id: 'v1', currentOdometer: 100_000 });
    db.maintenance!.create!.mockResolvedValue({ id: 'm1' });

    await service.create(ACTOR, {
      vehicleId: 'v1',
      type: MaintenanceType.PLANNED_TO,
      cost: '350000000',
      odometer: 120_000,
      nextServiceOdometer: 135_000,
      serviceDate: '2026-08-10T00:00:00Z',
    });

    expect(db.maintenance!.create!.mock.calls[0][0].data.cost).toBe(350_000_000n);
    expect(db.vehicle!.update!.mock.calls[0][0].data).toEqual({
      nextServiceOdometer: 135_000,
      currentOdometer: 120_000,
    });
  });

  it('never rolls the odometer backwards', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue({ id: 'v1', currentOdometer: 140_000 });
    db.maintenance!.create!.mockResolvedValue({ id: 'm1' });

    await service.create(ACTOR, {
      vehicleId: 'v1',
      type: MaintenanceType.REPAIR,
      odometer: 120_000,
    });
    expect(db.vehicle!.update).not.toHaveBeenCalled();
  });
});

describe('MaintenanceService.list', () => {
  it('filters by vehicle inside the tenant, newest service first', async () => {
    const { service, db, forCompany } = setup();
    await service.list(ACTOR, Object.assign(new ListMaintenanceDto(), { vehicleId: 'v1' }));

    expect(db.maintenance!.findMany!.mock.calls[0][0]).toMatchObject({
      where: { vehicleId: 'v1' },
      orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }],
    });
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });
});

describe('MaintenanceService.remove', () => {
  it('reports NOT_FOUND when the scoped delete matches nothing', async () => {
    const { service, db } = setup();
    db.maintenance!.deleteMany!.mockResolvedValue({ count: 0 });

    await expect(service.remove(ACTOR, 'rec-of-company-b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('MaintenanceService.due', () => {
  it('keeps only vehicles within 1 000 km of service, overdue first', async () => {
    const { service, db } = setup();
    db.vehicle!.findMany!.mockResolvedValue([
      {
        id: 'v1',
        plateNumber: '01 A 123 AA',
        currentOdometer: 134_500,
        nextServiceOdometer: 135_000,
        maintenances: [{ serviceDate: new Date('2026-05-01T00:00:00Z') }],
      },
      {
        id: 'v2',
        plateNumber: '01 B 456 BB',
        currentOdometer: 141_000,
        nextServiceOdometer: 140_000,
        maintenances: [],
      },
      {
        id: 'v3',
        plateNumber: '01 C 789 CC',
        currentOdometer: 10_000,
        nextServiceOdometer: 50_000,
        maintenances: [],
      },
    ]);

    const rows = await service.due(ACTOR);

    expect(rows.map((row) => row.plateNumber)).toEqual(['01 B 456 BB', '01 A 123 AA']);
    expect(rows[0]!.kmLeft).toBe(-1_000);
    expect(rows[0]!.isOverdue).toBe(true);
    expect(rows[1]!.lastServiceDate).toEqual(new Date('2026-05-01T00:00:00Z'));
  });
});

describe('MaintenanceService.checkDue', () => {
  it('raises a due alert and an overdue alert with their own wording', async () => {
    const { service, db, alerts } = setup();
    db.vehicle!.findMany!.mockResolvedValue([
      {
        id: 'v1',
        plateNumber: '01 A 123 AA',
        currentOdometer: 134_500,
        nextServiceOdometer: 135_000,
        maintenances: [],
      },
      {
        id: 'v2',
        plateNumber: '01 B 456 BB',
        currentOdometer: 141_000,
        nextServiceOdometer: 140_000,
        maintenances: [],
      },
    ]);

    await service.checkDue('company-a');

    const raised = alerts.raiseMany.mock.calls[0][1];
    expect(raised[0]).toMatchObject({
      type: AlertType.MAINTENANCE_DUE,
      titleKey: 'alerts.serviceOverdue.title',
      relatedId: 'v2',
      dedupeParam: 'km',
    });
    expect(raised[0].params).toMatchObject({ plate: '01 B 456 BB', km: 1_000 });
    expect(raised[1]).toMatchObject({ titleKey: 'alerts.serviceDue.title', relatedId: 'v1' });
    expect(raised[1].params.km).toBe(500);
  });
});
