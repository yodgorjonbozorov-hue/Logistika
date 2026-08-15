import { AlertType } from 'shared';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { AlertsService } from './alerts.service';
import { ListAlertsDto } from './dto/alert.dto';

function setup() {
  const { prisma, db, forCompany } = createTenantDbMock(['notification']);
  return { service: new AlertsService(prisma), db, forCompany };
}

const FUEL_ALERT = {
  type: AlertType.FUEL_OVERRUN,
  titleKey: 'alerts.fuelOverrun.title',
  messageKey: 'alerts.fuelOverrun.message',
  params: { plate: '01 A 123 AA', deviation: '55.2' },
  relatedType: 'Vehicle',
  relatedId: 'v1',
};

describe('AlertsService.raise', () => {
  it('stores i18n keys and params, never rendered text', async () => {
    const { service, db, forCompany } = setup();
    db.notification!.findFirst!.mockResolvedValue(null);
    db.notification!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'n1', ...data }),
    );

    await service.raise('company-a', FUEL_ALERT);

    expect(forCompany).toHaveBeenCalledWith('company-a');
    const data = db.notification!.create!.mock.calls[0][0].data;
    expect(data.title).toBe('alerts.fuelOverrun.title');
    expect(JSON.parse(data.message as string)).toEqual({
      key: 'alerts.fuelOverrun.message',
      params: { plate: '01 A 123 AA', deviation: '55.2' },
    });
    expect(data.relatedId).toBe('v1');
  });

  it('does not raise a second copy while the first is unread', async () => {
    const { service, db } = setup();
    db.notification!.findFirst!.mockResolvedValue({ id: 'n1', message: '{}' });

    expect(await service.raise('company-a', FUEL_ALERT)).toBeNull();
    expect(db.notification!.create).not.toHaveBeenCalled();
    expect(db.notification!.findFirst!.mock.calls[0][0].where).toMatchObject({
      type: AlertType.FUEL_OVERRUN,
      relatedId: 'v1',
      isRead: false,
    });
  });

  it('replaces a stale reminder when the dedupe param moved on', async () => {
    const { service, db } = setup();
    db.notification!.findFirst!.mockResolvedValue({
      id: 'n-old',
      message: JSON.stringify({ key: 'k', params: { daysLeft: 15 } }),
    });
    db.notification!.create!.mockResolvedValue({ id: 'n-new' });

    const created = await service.raise('company-a', {
      ...FUEL_ALERT,
      params: { daysLeft: 7 },
      dedupeParam: 'daysLeft',
    });

    expect(created).toEqual({ id: 'n-new' });
    expect(db.notification!.update!.mock.calls[0][0]).toEqual({
      where: { id: 'n-old' },
      data: { isRead: true },
    });
  });

  it('still deduplicates when the dedupe param has not changed', async () => {
    const { service, db } = setup();
    db.notification!.findFirst!.mockResolvedValue({
      id: 'n-old',
      message: JSON.stringify({ key: 'k', params: { daysLeft: 7 } }),
    });

    const created = await service.raise('company-a', {
      ...FUEL_ALERT,
      params: { daysLeft: 7 },
      dedupeParam: 'daysLeft',
    });

    expect(created).toBeNull();
    expect(db.notification!.update).not.toHaveBeenCalled();
  });

  it('counts only the alerts it actually created', async () => {
    const { service, db } = setup();
    db.notification!.findFirst!.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'dup',
      message: '{}',
    });
    db.notification!.create!.mockResolvedValue({ id: 'n1' });

    expect(await service.raiseMany('company-a', [FUEL_ALERT, FUEL_ALERT])).toBe(1);
  });
});

describe('AlertsService.list', () => {
  function filter(over: Partial<ListAlertsDto> = {}): ListAlertsDto {
    return Object.assign(new ListAlertsDto(), over);
  }

  it('shows company-wide alerts plus the caller own ones, newest first', async () => {
    const { service, db } = setup();
    db.notification!.count!.mockResolvedValueOnce(3).mockResolvedValueOnce(2);

    const result = await service.list(ACTOR, filter());

    const args = db.notification!.findMany!.mock.calls[0][0];
    expect(args.where.OR).toEqual([{ userId: null }, { userId: 'user-1' }]);
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(result.total).toBe(3);
    expect(result.unread).toBe(2);
  });

  it('filters to unread when asked', async () => {
    const { service, db } = setup();
    await service.list(ACTOR, filter({ unreadOnly: true, type: AlertType.MAINTENANCE_DUE }));

    expect(db.notification!.findMany!.mock.calls[0][0].where).toMatchObject({
      isRead: false,
      type: AlertType.MAINTENANCE_DUE,
    });
  });

  it('reads through the tenant client, so company B alerts stay invisible', async () => {
    const { service, forCompany } = setup();
    await service.list(ACTOR, filter());
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });
});

describe('AlertsService.markRead', () => {
  it('marks one alert read via a scoped updateMany (cross-tenant id updates nothing)', async () => {
    const { service, db } = setup();
    db.notification!.updateMany!.mockResolvedValue({ count: 0 });

    const result = await service.markRead(ACTOR, 'alert-of-company-b');

    expect(result.updated).toBe(0);
    expect(db.notification!.updateMany!.mock.calls[0][0].where).toEqual({
      id: 'alert-of-company-b',
      isRead: false,
    });
  });

  it('marks every unread alert of the caller read', async () => {
    const { service, db } = setup();
    db.notification!.updateMany!.mockResolvedValue({ count: 4 });

    expect(await service.markAllRead(ACTOR)).toEqual({ updated: 4 });
    expect(db.notification!.updateMany!.mock.calls[0][0].data).toEqual({ isRead: true });
  });
});
