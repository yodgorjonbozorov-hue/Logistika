import { TripEventType } from 'shared';
import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { EventsService } from './events.service';

const DRIVER_ACTOR = { ...ACTOR, role: 'DRIVER' } as typeof ACTOR;

describe('EventsService.ingestBatch (offline idempotent sync)', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  function setup() {
    const { prisma, db } = createTenantDbMock([
      'driver',
      'trip',
      'tripEvent',
      'storedFile',
      'auditLog',
    ]);
    db.driver!.findFirst!.mockResolvedValue({ id: 'd1', userId: 'user-1' });
    db.trip!.findUnique!.mockResolvedValue({
      id: 'trip-1',
      driverId: 'd1',
      status: 'ASSIGNED',
      startOdometer: null,
      startedAt: null,
    });
    db.tripEvent!.findMany!.mockResolvedValue([]);
    db.tripEvent!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'e1', ...data }),
    );
    db.storedFile!.findMany!.mockResolvedValue([]);
    const service = new EventsService(prisma, audit);
    return { service, db };
  }

  const event = (clientEventId: string) => ({
    clientEventId,
    tripId: 'trip-1',
    eventType: TripEventType.REFUEL,
    eventTime: '2026-08-06T10:00:00Z',
    lat: 40.1,
    lng: 67.8,
  });

  it('accepts new events and stamps driver + tenant', async () => {
    const { service, db } = setup();
    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [event('c-1'), event('c-2')],
    });

    expect(result.accepted).toEqual(['c-1', 'c-2']);
    expect(result.duplicates).toEqual([]);
    const data = db.tripEvent!.create!.mock.calls[0][0].data;
    expect(data.driverId).toBe('d1');
    expect(data.companyId).toBe('company-a');
    expect(data.clientEventId).toBe('c-1');
  });

  it('re-sent events are reported as duplicates, not stored twice', async () => {
    const { service, db } = setup();
    db.tripEvent!.findMany!.mockResolvedValue([{ clientEventId: 'c-1' }]);

    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [event('c-1'), event('c-2')],
    });

    expect(result.duplicates).toEqual(['c-1']);
    expect(result.accepted).toEqual(['c-2']);
    expect(db.tripEvent!.create).toHaveBeenCalledTimes(1);
  });

  it('duplicates inside one batch are stored once', async () => {
    const { service, db } = setup();
    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [event('c-9'), event('c-9')],
    });
    expect(result.accepted).toEqual(['c-9']);
    expect(result.duplicates).toEqual(['c-9']);
    expect(db.tripEvent!.create).toHaveBeenCalledTimes(1);
  });

  it("rejects events for another driver's trip without failing the batch", async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue({ id: 'trip-1', driverId: 'other-driver' });

    const result = await service.ingestBatch(DRIVER_ACTOR, { events: [event('c-1')] });

    expect(result.rejected).toEqual([{ clientEventId: 'c-1', code: 'NOT_FOUND' }]);
    expect(db.tripEvent!.create).not.toHaveBeenCalled();
  });

  // --- TASK-1.4: driver buttons move the trip itself ---

  const tripEvent = (type: TripEventType, extra: Record<string, unknown> = {}) => ({
    clientEventId: 'c-1',
    tripId: 'trip-1',
    eventType: type,
    eventTime: '2026-08-06T10:00:00Z',
    ...extra,
  });

  it('START moves an assigned trip to IN_PROGRESS and stamps the driver times', async () => {
    const { service, db } = setup();

    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [tripEvent(TripEventType.START, { odometer: 411500 })],
    });

    expect(result.accepted).toEqual(['c-1']);
    const call = db.trip!.updateMany!.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'trip-1', status: 'ASSIGNED' });
    expect(call.data.status).toBe('IN_PROGRESS');
    expect(call.data.startedAt).toEqual(new Date('2026-08-06T10:00:00Z'));
    expect(call.data.startOdometer).toBe(411500);
  });

  it('LOADED also starts the trip, and a second one changes nothing', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue({
      id: 'trip-1',
      driverId: 'd1',
      status: 'IN_PROGRESS',
      startOdometer: 100,
      startedAt: new Date(),
    });

    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [tripEvent(TripEventType.LOADED)],
    });

    expect(result.accepted).toEqual(['c-1']);
    expect(db.trip!.updateMany).not.toHaveBeenCalled();
  });

  it('FINISH completes the trip with finishedAt, odometer and distance', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue({
      id: 'trip-1',
      driverId: 'd1',
      status: 'IN_PROGRESS',
      startOdometer: 411500,
      startedAt: new Date('2026-08-06T07:00:00Z'),
    });

    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [tripEvent(TripEventType.FINISH, { odometer: 411818 })],
    });

    expect(result.accepted).toEqual(['c-1']);
    const call = db.trip!.updateMany!.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'trip-1', status: 'IN_PROGRESS' });
    expect(call.data.status).toBe('COMPLETED');
    expect(call.data.finishedAt).toEqual(new Date('2026-08-06T10:00:00Z'));
    expect(call.data.endOdometer).toBe(411818);
    expect(String(call.data.actualDistanceKm)).toBe('318');
  });

  it('START on a DRAFT trip is rejected without touching the trip', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue({ id: 'trip-1', driverId: 'd1', status: 'DRAFT' });

    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [tripEvent(TripEventType.START)],
    });

    expect(result.rejected).toEqual([{ clientEventId: 'c-1', code: 'TRIP_INVALID_STATUS' }]);
    expect(db.trip!.updateMany).not.toHaveBeenCalled();
    expect(db.tripEvent!.create).not.toHaveBeenCalled();
  });

  it('a lost race on the status guard rejects the event instead of half-applying it', async () => {
    const { service, db } = setup();
    // Another device already moved the trip: the guarded update matches no row.
    db.trip!.updateMany!.mockResolvedValue({ count: 0 });

    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [tripEvent(TripEventType.START)],
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([{ clientEventId: 'c-1', code: 'TRIP_INVALID_STATUS' }]);
  });

  it('informational events never move the trip', async () => {
    const { service, db } = setup();
    await service.ingestBatch(DRIVER_ACTOR, {
      events: [tripEvent(TripEventType.REFUEL), tripEvent(TripEventType.REST)],
    });
    expect(db.trip!.updateMany).not.toHaveBeenCalled();
  });

  it('requires an active driver profile', async () => {
    const { service, db } = setup();
    db.driver!.findFirst!.mockResolvedValue(null);
    await expect(
      service.ingestBatch(DRIVER_ACTOR, { events: [event('c-1')] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
