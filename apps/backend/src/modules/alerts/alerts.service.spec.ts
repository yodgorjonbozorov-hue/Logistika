import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { AlertsService } from './alerts.service';

describe('AlertsService', () => {
  function setup() {
    const mock = createTenantDbMock(['notification']);
    const service = new AlertsService(mock.prisma);
    return { service, db: mock.db, forCompany: mock.forCompany };
  }

  describe('raise', () => {
    it('stores the i18n type and JSON params, never hardcoded text', async () => {
      const { service, db } = setup();
      db.notification!.findFirst!.mockResolvedValue(null);
      db.notification!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'n1', ...data }),
      );

      await service.raise('company-a', {
        type: 'FUEL_DEVIATION',
        params: { plateNumber: '01 A 123 AA', diffLiters: 55.2 },
        relatedType: 'Vehicle',
        relatedId: 'v-1',
      });

      const data = db.notification!.create!.mock.calls[0][0].data;
      expect(data.type).toBe('FUEL_DEVIATION');
      expect(data.title).toBe('FUEL_DEVIATION');
      expect(JSON.parse(data.message)).toEqual({ plateNumber: '01 A 123 AA', diffLiters: 55.2 });
    });

    it('is scoped to the given company (cron path)', async () => {
      const { service, db, forCompany } = setup();
      db.notification!.findFirst!.mockResolvedValue(null);
      db.notification!.create!.mockResolvedValue({ id: 'n1' });
      await service.raise('company-b', { type: 'DOC_EXPIRY', params: {} });
      expect(forCompany).toHaveBeenCalledWith('company-b');
    });

    it('swallows a duplicate while an unread alert for the same entity exists', async () => {
      const { service, db } = setup();
      db.notification!.findFirst!.mockResolvedValue({ id: 'existing', isRead: false });
      const result = await service.raise('company-a', {
        type: 'FUEL_DEVIATION',
        params: {},
        relatedType: 'Vehicle',
        relatedId: 'v-1',
      });
      expect(result).toBeNull();
      expect(db.notification!.create).not.toHaveBeenCalled();
    });
  });

  it('list filters unread only when asked', async () => {
    const { service, db } = setup();
    db.notification!.findMany!.mockResolvedValue([]);
    db.notification!.count!.mockResolvedValue(0);
    const pagination = { page: 1, limit: 20, skip: 0 };
    await service.list(ACTOR, pagination as never, true);
    expect(db.notification!.findMany!.mock.calls[0][0].where).toEqual({ isRead: false });
    await service.list(ACTOR, pagination as never, false);
    expect(db.notification!.findMany!.mock.calls[1][0].where).toEqual({});
  });

  it('ack 404s for a foreign notification (tenant isolation)', async () => {
    const { service, db } = setup();
    db.notification!.findUnique!.mockResolvedValue(null);
    await expect(service.ack(ACTOR, 'foreign')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('ackAll marks everything unread as read and reports the count', async () => {
    const { service, db } = setup();
    db.notification!.updateMany!.mockResolvedValue({ count: 3 });
    await expect(service.ackAll(ACTOR)).resolves.toEqual({ acknowledged: 3 });
    expect(db.notification!.updateMany).toHaveBeenCalledWith({
      where: { isRead: false },
      data: { isRead: true },
    });
  });
});
