import { DocumentOwnerType } from 'shared';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import type { AuditService } from '../audit/audit.service';
import { DocumentsService } from './documents.service';

const audit = { log: jest.fn() } as unknown as AuditService;

function setup() {
  const { prisma, db, forCompany } = createTenantDbMock([
    'document',
    'vehicle',
    'driver',
    'trip',
    'storedFile',
  ]);
  return { service: new DocumentsService(prisma, audit), db, forCompany };
}

const BASE = { docType: 'insurance', ownerType: DocumentOwnerType.VEHICLE, ownerId: 'v1' };

describe('DocumentsService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads and writes through the tenant client', async () => {
    const { service, db, forCompany } = setup();
    db.document!.findMany!.mockResolvedValue([]);
    await service.list(ACTOR, new PaginationDto(), {});
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });

  it('puts the nearest deadline first and undated papers last', async () => {
    const { service, db } = setup();
    db.document!.findMany!.mockResolvedValue([]);
    await service.list(ACTOR, new PaginationDto(), {});
    expect(db.document!.findMany!.mock.calls[0][0].orderBy).toEqual([
      { expiryDate: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'desc' },
    ]);
  });

  it('narrows to papers running out inside the asked-for window', async () => {
    const { service, db } = setup();
    db.document!.findMany!.mockResolvedValue([]);
    await service.list(ACTOR, new PaginationDto(), { expiringInDays: 30 });

    const where = db.document!.findMany!.mock.calls[0][0].where as {
      expiryDate: { lte: Date; not: null };
    };
    const days = (where.expiryDate.lte.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(where.expiryDate.not).toBeNull();
  });

  it('stores the upload id rather than a URL, so links stay short-lived', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue({ id: 'v1' });
    db.storedFile!.findUnique!.mockResolvedValue({ id: 'f1' });
    db.document!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'd1', ...data }),
    );

    await service.create(ACTOR, { ...BASE, fileId: 'f1' });

    expect(db.document!.create!.mock.calls[0][0].data).toMatchObject({
      companyId: 'company-a',
      ownerId: 'v1',
      fileUrl: 'f1',
    });
  });

  it('refuses a paper pointing at a record this tenant does not own', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue(null);
    await expect(service.create(ACTOR, BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.document!.create).not.toHaveBeenCalled();
  });

  it('refuses a file belonging to another tenant', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue({ id: 'v1' });
    db.storedFile!.findUnique!.mockResolvedValue(null);
    await expect(service.create(ACTOR, { ...BASE, fileId: 'someone-elses' })).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );
    expect(db.document!.create).not.toHaveBeenCalled();
  });

  it('takes the company id from the token for a company-level paper', async () => {
    const { service, db } = setup();
    db.document!.create!.mockResolvedValue({ id: 'd1' });

    await service.create(ACTOR, {
      ownerType: DocumentOwnerType.COMPANY,
      ownerId: 'company-b', // ignored: a company paper is always this company's
      docType: 'charter',
    });

    expect(db.document!.create!.mock.calls[0][0].data.ownerId).toBe('company-a');
  });

  it('requires an owner for anything that is not company-level', async () => {
    const { service } = setup();
    await expect(
      service.create(ACTOR, { ownerType: DocumentOwnerType.DRIVER, docType: 'licence' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('will not delete a paper it cannot first read as this tenant', async () => {
    const { service, db } = setup();
    db.document!.findUnique!.mockResolvedValue(null);
    await expect(service.remove(ACTOR, 'd-of-company-b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(db.document!.delete).not.toHaveBeenCalled();
  });

  it('deletes a paper this tenant owns, and says so in the audit log', async () => {
    const { service, db } = setup();
    db.document!.findUnique!.mockResolvedValue({ id: 'd1' });
    await expect(service.remove(ACTOR, 'd1')).resolves.toEqual({ deleted: true });
    expect(db.document!.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', entityType: 'Document' }),
    );
  });
});
