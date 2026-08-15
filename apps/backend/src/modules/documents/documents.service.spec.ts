import { AlertType, DocumentOwnerType } from 'shared';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import type { AlertsService } from '../alerts/alerts.service';
import { daysUntil, DocumentsService, reminderBucket } from './documents.service';
import { ListDocumentsDto } from './dto/document.dto';

const NOW = new Date('2026-08-15T00:00:00Z');

function setup() {
  const { prisma, db, forCompany } = createTenantDbMock(['document', 'vehicle', 'driver', 'trip']);
  const alerts = { raise: jest.fn(), raiseMany: jest.fn().mockResolvedValue(0) };
  const service = new DocumentsService(prisma, alerts as unknown as AlertsService);
  return { service, db, forCompany, alerts };
}

describe('daysUntil', () => {
  it('counts whole days ahead and behind', () => {
    expect(daysUntil(new Date('2026-08-22T00:00:00Z'), NOW)).toBe(7);
    expect(daysUntil(new Date('2026-08-15T00:00:00Z'), NOW)).toBe(0);
    expect(daysUntil(new Date('2026-08-10T00:00:00Z'), NOW)).toBe(-5);
  });
});

describe('reminderBucket', () => {
  it('maps a countdown onto the 15/7/1 steps', () => {
    expect(reminderBucket(15)).toBe(15);
    expect(reminderBucket(9)).toBe(15);
    expect(reminderBucket(7)).toBe(7);
    expect(reminderBucket(2)).toBe(7);
    expect(reminderBucket(1)).toBe(1);
    expect(reminderBucket(0)).toBe(1);
  });

  it('marks an expired document with step 0', () => {
    expect(reminderBucket(-1)).toBe(0);
  });

  it('stays silent while the expiry is far away', () => {
    expect(reminderBucket(16)).toBeNull();
    expect(reminderBucket(400)).toBeNull();
  });
});

describe('DocumentsService.create', () => {
  it('refuses an owner that lives in another tenant', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue(null);

    await expect(
      service.create(ACTOR, {
        ownerType: DocumentOwnerType.VEHICLE,
        ownerId: 'vehicle-of-company-b',
        docType: 'INSURANCE',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.document!.create).not.toHaveBeenCalled();
  });

  it('accepts a COMPANY document only for the caller own company', async () => {
    const { service, db } = setup();
    db.document!.create!.mockResolvedValue({ id: 'doc1' });

    await service.create(ACTOR, {
      ownerType: DocumentOwnerType.COMPANY,
      ownerId: 'company-a',
      docType: 'LICENSE',
      expiryDate: '2026-12-31T00:00:00Z',
    });
    expect(db.document!.create!.mock.calls[0][0].data.expiryDate).toEqual(
      new Date('2026-12-31T00:00:00Z'),
    );

    await expect(
      service.create(ACTOR, {
        ownerType: DocumentOwnerType.COMPANY,
        ownerId: 'company-b',
        docType: 'LICENSE',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DocumentsService.update', () => {
  it('restarts the reminder cycle when the expiry moves', async () => {
    const { service, db } = setup();
    db.document!.findUnique!.mockResolvedValue({ id: 'doc1' });
    db.document!.update!.mockResolvedValue({ id: 'doc1' });

    await service.update(ACTOR, 'doc1', { expiryDate: '2027-01-01T00:00:00Z' });
    expect(db.document!.update!.mock.calls[0][0].data.reminderSent).toBe(false);
  });

  it('reports NOT_FOUND for a document of another tenant', async () => {
    const { service, db } = setup();
    db.document!.findUnique!.mockResolvedValue(null);

    await expect(service.update(ACTOR, 'doc-of-company-b', {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('DocumentsService.list', () => {
  it('sorts by expiry so the nearest deadline comes first', async () => {
    const { service, db, forCompany } = setup();
    await service.list(ACTOR, Object.assign(new ListDocumentsDto(), { ownerId: 'v1' }));

    expect(db.document!.findMany!.mock.calls[0][0].orderBy).toEqual([
      { expiryDate: 'asc' },
      { createdAt: 'desc' },
    ]);
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });
});

describe('DocumentsService.expiring', () => {
  it('folds vehicle and driver card expiries in with stored documents', async () => {
    const { service, db } = setup();
    db.document!.findMany!.mockResolvedValue([
      {
        id: 'doc1',
        ownerType: 'VEHICLE',
        ownerId: 'v1',
        docType: 'PERMIT',
        docNumber: 'P-1',
        expiryDate: new Date('2026-08-20T00:00:00Z'),
      },
    ]);
    db.vehicle!.findMany!.mockResolvedValue([
      {
        id: 'v1',
        plateNumber: '01 A 123 AA',
        insuranceExpiry: new Date('2026-08-16T00:00:00Z'),
        techInspectionExpiry: null,
      },
    ]);
    db.driver!.findMany!.mockResolvedValue([
      {
        id: 'd1',
        fullName: 'Alisher A.',
        licenseNumber: 'AA123',
        licenseExpiry: new Date('2026-08-10T00:00:00Z'),
      },
    ]);

    const rows = await service.expiring(ACTOR, 15, NOW);

    // Sorted by urgency: expired licence, then insurance, then the permit.
    expect(rows.map((row) => row.docType)).toEqual(['DRIVER_LICENSE', 'INSURANCE', 'PERMIT']);
    expect(rows[0]!.daysLeft).toBe(-5);
    expect(rows[0]!.ownerLabel).toBe('Alisher A.');
    expect(rows[1]!.id).toBe('vehicle:v1:INSURANCE');
    expect(rows[2]!.ownerLabel).toBe('01 A 123 AA');
  });

  it('reads every source through the tenant client', async () => {
    const { service, forCompany } = setup();
    await service.expiring(ACTOR, 15, NOW);
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });
});

describe('DocumentsService.checkExpiries', () => {
  it('raises one alert per document, tagged with the reminder step', async () => {
    const { service, db, alerts } = setup();
    db.vehicle!.findMany!.mockResolvedValue([
      {
        id: 'v1',
        plateNumber: '01 A 123 AA',
        insuranceExpiry: new Date('2026-08-22T00:00:00Z'), // 7 days left
        techInspectionExpiry: new Date('2026-08-10T00:00:00Z'), // expired
      },
    ]);

    await service.checkExpiries('company-a', NOW);

    const raised = alerts.raiseMany.mock.calls[0][1];
    expect(raised).toHaveLength(2);
    expect(raised[0]).toMatchObject({
      type: AlertType.DOCUMENT_EXPIRING,
      titleKey: 'alerts.documentExpired.title',
      dedupeParam: 'daysLeft',
    });
    expect(raised[0].params).toMatchObject({
      daysLeft: 0,
      owner: '01 A 123 AA',
      docType: 'TECH_INSPECTION',
    });
    expect(raised[1]).toMatchObject({ titleKey: 'alerts.documentExpiring.title' });
    expect(raised[1].params.daysLeft).toBe(7);
  });

  it('ignores documents that expire beyond the first reminder step', async () => {
    const { service, db, alerts } = setup();
    db.document!.findMany!.mockResolvedValue([
      {
        id: 'doc1',
        ownerType: 'COMPANY',
        ownerId: 'company-a',
        docType: 'LICENSE',
        docNumber: null,
        expiryDate: new Date('2026-12-31T00:00:00Z'),
      },
    ]);

    await service.checkExpiries('company-a', NOW);
    expect(alerts.raiseMany.mock.calls[0][1]).toEqual([]);
  });
});
