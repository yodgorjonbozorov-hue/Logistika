import { TripEventType } from 'shared';
import type { AuditService } from '../audit/audit.service';
import { ACTOR, createDriversStub, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { AppException } from '../../common/exceptions/app.exception';
import { HttpStatus } from '@nestjs/common';
import { EventsService } from './events.service';

const DRIVER_ACTOR = { ...ACTOR, role: 'DRIVER' } as typeof ACTOR;

describe('EventsService.ingestBatch (offline idempotent sync)', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  function setup() {
    const { prisma, db } = createTenantDbMock(['driver', 'trip', 'tripEvent', 'storedFile']);
    const drivers = createDriversStub({ id: 'd1' });
    // One batched lookup returns every trip that belongs to this driver (M-11).
    db.trip!.findMany!.mockResolvedValue([{ id: 'trip-1' }]);
    db.tripEvent!.findMany!.mockResolvedValue([]);
    db.storedFile!.findMany!.mockResolvedValue([]);
    const service = new EventsService(prisma, audit, drivers);
    return { service, db, drivers };
  }

  /** Rows handed to createMany, flattened across calls. */
  const written = (db: ReturnType<typeof setup>['db']): Array<Record<string, unknown>> =>
    db.tripEvent!.createMany!.mock.calls.flatMap(
      (call: [{ data: Array<Record<string, unknown>> }]) => call[0].data,
    );

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
    const rows = written(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.driverId).toBe('d1');
    expect(rows[0]!.companyId).toBe('company-a');
    expect(rows[0]!.clientEventId).toBe('c-1');
  });

  it('re-sent events are reported as duplicates, not stored twice', async () => {
    const { service, db } = setup();
    db.tripEvent!.findMany!.mockResolvedValue([{ clientEventId: 'c-1' }]);

    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [event('c-1'), event('c-2')],
    });

    expect(result.duplicates).toEqual(['c-1']);
    expect(result.accepted).toEqual(['c-2']);
    expect(written(db)).toHaveLength(1);
  });

  it('duplicates inside one batch are stored once', async () => {
    const { service, db } = setup();
    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [event('c-9'), event('c-9')],
    });
    expect(result.accepted).toEqual(['c-9']);
    expect(result.duplicates).toEqual(['c-9']);
    expect(written(db)).toHaveLength(1);
  });

  it("rejects events for another driver's trip without failing the batch", async () => {
    const { service, db } = setup();
    db.trip!.findMany!.mockResolvedValue([]); // not this driver's trip → invisible

    const result = await service.ingestBatch(DRIVER_ACTOR, { events: [event('c-1')] });

    expect(result.rejected).toEqual([{ clientEventId: 'c-1', code: 'NOT_FOUND' }]);
    expect(db.tripEvent!.createMany).not.toHaveBeenCalled();
  });

  it('requires an active driver profile', async () => {
    const { prisma, db } = createTenantDbMock(['driver', 'trip', 'tripEvent', 'storedFile']);
    const drivers = {
      requireProfile: jest
        .fn()
        .mockRejectedValue(new AppException('DRIVER_PROFILE_MISSING', HttpStatus.FORBIDDEN)),
    } as unknown as import('../drivers/drivers.service').DriversService;
    const service = new EventsService(prisma, audit, drivers);

    await expect(
      service.ingestBatch(DRIVER_ACTOR, { events: [event('c-1')] }),
    ).rejects.toMatchObject({ code: 'DRIVER_PROFILE_MISSING' });
    expect(db.tripEvent!.createMany).not.toHaveBeenCalled();
  });

  it('writes the whole batch in one round trip instead of one query per event (M-11)', async () => {
    const { service, db } = setup();
    const events = Array.from({ length: 50 }, (_unused, i) => event(`c-${i}`));

    await service.ingestBatch(DRIVER_ACTOR, { events });

    expect(db.tripEvent!.createMany).toHaveBeenCalledTimes(1);
    expect(db.trip!.findMany).toHaveBeenCalledTimes(1);
    expect(written(db)).toHaveLength(50);
  });
});

describe('EventsService.listByTrip (H-1 IDOR)', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  it("scopes a DRIVER to their own trip and 404s on somebody else's", async () => {
    const { prisma, db } = createTenantDbMock(['trip', 'tripEvent']);
    db.trip!.findFirst!.mockResolvedValue(null); // another driver's trip
    const service = new EventsService(prisma, audit, createDriversStub({ id: 'd1' }));

    await expect(service.listByTrip(DRIVER_ACTOR, 'trip-of-other-driver')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(db.trip!.findFirst!.mock.calls[0][0].where).toMatchObject({ driverId: 'd1' });
    expect(db.tripEvent!.findMany).not.toHaveBeenCalled();
  });

  it('does not narrow by driver for office roles', async () => {
    const { prisma, db } = createTenantDbMock(['trip', 'tripEvent']);
    db.trip!.findFirst!.mockResolvedValue({ id: 'trip-1' });
    const service = new EventsService(prisma, audit, createDriversStub({ id: 'd1' }));

    await service.listByTrip(ACTOR, 'trip-1');

    expect(db.trip!.findFirst!.mock.calls[0][0].where.driverId).toBeUndefined();
    expect(db.tripEvent!.findMany!.mock.calls[0][0].where).toEqual({ tripId: 'trip-1' });
  });
});
