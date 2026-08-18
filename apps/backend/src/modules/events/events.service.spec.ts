import { Prisma } from '@prisma/client';
import { TripEventType } from 'shared';
import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { EventsService } from './events.service';

/** UZS passes through unchanged; conversion itself is tested in currency.service.spec.ts. */
const currencyStub = {
  toBase: jest.fn((amount: bigint) =>
    Promise.resolve({ amountBase: amount, rateUsed: null, rateDate: null }),
  ),
} as unknown as import('../currency/currency.service').CurrencyService;

/** The ledger is exercised for real in ledger.service.spec.ts and the e2e suite. */
const ledgerStub = {
  record: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
  reverse: jest.fn(),
} as unknown as import('../ledger/ledger.service').LedgerService;

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
    // The batch reads every trip it refers to in one query now (TASK-4.2), so
    // the tests keep configuring findUnique and this turns it into that list.
    db.trip!.findMany!.mockImplementation(async () => {
      const trip = await db.trip!.findUnique!({});
      return trip ? [trip] : [];
    });
    db.tripEvent!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'e1', ...data }),
    );
    db.storedFile!.findMany!.mockResolvedValue([]);
    const service = new EventsService(prisma, audit, ledgerStub, currencyStub);
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
    // The logist's page may be holding this trip; the driver moving it has to
    // invalidate their copy too (TASK-3.5).
    expect(call.data.version).toEqual({ increment: 1 });
  });

  it('rejects a FINISH whose odometer went backwards (TASK-3.6)', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue({
      id: 'trip-1',
      driverId: 'd1',
      status: 'IN_PROGRESS',
      startOdometer: 411500,
    });

    // It used to be accepted with the distance quietly left unset: the trip
    // looked complete and vanished from every per-km report.
    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [tripEvent(TripEventType.FINISH, { odometer: 411158 })],
    });

    expect(result.rejected).toEqual([{ clientEventId: 'c-1', code: 'ODOMETER_INVALID' }]);
    expect(result.accepted).toEqual([]);
    expect(db.trip!.updateMany).not.toHaveBeenCalled();
    // Nothing at all is stored: the driver's app puts it in "needs attention"
    // so the reading gets corrected rather than lost.
    expect(db.tripEvent!.create).not.toHaveBeenCalled();
  });

  it('accepts a FINISH with no odometer at all', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue({
      id: 'trip-1',
      driverId: 'd1',
      status: 'IN_PROGRESS',
      startOdometer: 411500,
    });

    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [tripEvent(TripEventType.FINISH)],
    });

    // Missing data must not block the finish — only wrong data does.
    expect(result.accepted).toEqual(['c-1']);
    expect(db.trip!.updateMany!.mock.calls[0][0].data.actualDistanceKm).toBeUndefined();
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

  it('reports a lost insert race as a duplicate, not as a failed batch (TASK-3.8)', async () => {
    const { service, db } = setup();
    // Another batch stored this id between the findMany above and this insert.
    db.tripEvent!.create!.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['company_id', 'client_event_id'] },
      }),
    );

    const result = await service.ingestBatch(DRIVER_ACTOR, { events: [event('c-1')] });

    // The unhandled error used to fail the whole batch, and the app — doing
    // exactly what it should — resent it forever.
    expect(result.duplicates).toEqual(['c-1']);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('still surfaces a unique violation that is not the event id', async () => {
    const { service, db } = setup();
    db.tripEvent!.create!.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['some_other_column'] },
      }),
    );

    // Swallowing this as "already sent" would hide a real bug behind a
    // reassuring word.
    await expect(
      service.ingestBatch(DRIVER_ACTOR, { events: [event('c-1')] }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('recognises the duplicate whether the driver names one column or several', async () => {
    // Prisma reports meta.target as a string on some engines and an array on
    // others; a batch must not fail because of which one it got.
    for (const target of ['trip_events_company_id_client_event_id_key', ['client_event_id']]) {
      const { service, db } = setup();
      db.tripEvent!.create!.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target },
        }),
      );

      const result = await service.ingestBatch(DRIVER_ACTOR, { events: [event('c-1')] });
      expect(result.duplicates).toEqual(['c-1']);
    }
  });

  it('never mistakes an ordinary failure for a duplicate', async () => {
    const { service, db } = setup();
    // A dropped connection is not "already sent"; reporting it as one would
    // make the phone delete an event the server never stored.
    db.tripEvent!.create!.mockRejectedValue(new Error('connection reset'));

    await expect(service.ingestBatch(DRIVER_ACTOR, { events: [event('c-1')] })).rejects.toThrow(
      'connection reset',
    );
  });

  it('rethrows a P2002 that carries no target at all', async () => {
    const { service, db } = setup();
    db.tripEvent!.create!.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.ingestBatch(DRIVER_ACTOR, { events: [event('c-1')] }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses to start a trip on a truck that is already out (TASK-3.10)', async () => {
    const { service, db } = setup();
    db.trip!.findFirst!.mockResolvedValue({ id: 't9', tripNumber: 'TR-2026-0041' });

    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [tripEvent(TripEventType.START)],
    });

    // Two trips on one truck collect the same fuel and the same kilometres,
    // and the profit of both comes out wrong.
    expect(result.rejected).toEqual([{ clientEventId: 'c-1', code: 'DRIVER_BUSY' }]);
    expect(db.tripEvent!.create).not.toHaveBeenCalled();
  });

  it('reports a lost start race as a rejection, not a failed batch', async () => {
    const { service, db } = setup();
    // Both devices passed the check above; the partial unique index decides.
    db.trip!.updateMany!.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['company_id', 'vehicle_id'] },
      }),
    );

    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [tripEvent(TripEventType.START)],
    });

    expect(result.rejected).toEqual([{ clientEventId: 'c-1', code: 'VEHICLE_BUSY' }]);
  });

  it('rejects an event whose receipt belongs to somewhere else (M-4)', async () => {
    const { service, db } = setup();
    // Two ids asked for, one found: the missing one is not this tenant's.
    db.storedFile!.findMany!.mockResolvedValue([{ id: 'f1' }]);

    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [{ ...event('c-1'), photoFileIds: ['f1', 'f2'] }],
    });

    // Storing the event without its receipt loses the proof the receipt is.
    expect(result.rejected).toEqual([{ clientEventId: 'c-1', code: 'NOT_FOUND' }]);
    expect(db.tripEvent!.create).not.toHaveBeenCalled();
  });

  it('stores the file ids under a column that says so', async () => {
    const { service, db } = setup();
    db.storedFile!.findMany!.mockResolvedValue([{ id: 'f1' }]);

    await service.ingestBatch(DRIVER_ACTOR, {
      events: [{ ...event('c-1'), photoFileIds: ['f1'] }],
    });

    // The column was called photo_urls and has only ever held ids (M-4).
    expect(db.tripEvent!.create!.mock.calls[0][0].data.photoFileIds).toEqual(['f1']);
  });

  it('reads the trips once, not once per event (TASK-4.2)', async () => {
    const { service, db } = setup();

    await service.ingestBatch(DRIVER_ACTOR, {
      events: Array.from({ length: 50 }, (_, i) => event(`c-${i}`)),
    });

    // Fifty events used to be fifty round trips before anything was stored.
    expect(db.trip!.findMany).toHaveBeenCalledTimes(1);
    expect(db.trip!.findMany!.mock.calls[0][0].where.id.in).toEqual(['trip-1']);
  });

  it('reads the receipt files once for the whole batch', async () => {
    const { service, db } = setup();
    db.storedFile!.findMany!.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]);

    await service.ingestBatch(DRIVER_ACTOR, {
      events: [
        { ...event('c-1'), photoFileIds: ['f1'] },
        { ...event('c-2'), photoFileIds: ['f2'] },
        { ...event('c-3'), photoFileIds: ['f1', 'f2'] },
      ],
    });

    expect(db.storedFile!.findMany).toHaveBeenCalledTimes(1);
    // Asked for each distinct id once, not once per mention.
    expect(db.storedFile!.findMany!.mock.calls[0][0].where.id.in.sort()).toEqual(['f1', 'f2']);
  });

  it('asks for no files at all when the batch carries no photos', async () => {
    const { service, db } = setup();
    await service.ingestBatch(DRIVER_ACTOR, { events: [event('c-1')] });
    expect(db.storedFile!.findMany).not.toHaveBeenCalled();
  });

  it('lets a later event in the batch see the status an earlier one wrote', async () => {
    const { service, db } = setup();

    const result = await service.ingestBatch(DRIVER_ACTOR, {
      events: [
        { ...tripEvent(TripEventType.START), clientEventId: 'c-1' },
        { ...tripEvent(TripEventType.LOADED), clientEventId: 'c-2' },
      ],
    });

    // Reading the trip once means the loop has to keep its own copy current:
    // LOADED after START is a no-op, not a second transition.
    expect(result.accepted).toEqual(['c-1', 'c-2']);
    expect(db.trip!.updateMany).toHaveBeenCalledTimes(1);
  });

  it('requires an active driver profile', async () => {
    const { service, db } = setup();
    db.driver!.findFirst!.mockResolvedValue(null);
    await expect(
      service.ingestBatch(DRIVER_ACTOR, { events: [event('c-1')] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('EventsService.listByTrip (TASK-2.3)', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  function setup() {
    const { prisma, db } = createTenantDbMock(['driver', 'trip', 'tripEvent']);
    db.trip!.findUnique!.mockResolvedValue({ id: 'trip-1', driverId: 'd1' });
    db.driver!.findFirst!.mockResolvedValue({ id: 'd1', userId: 'user-1' });
    db.tripEvent!.findMany!.mockResolvedValue([{ id: 'e1' }]);
    db.tripEvent!.count!.mockResolvedValue(1);
    return { service: new EventsService(prisma, audit, ledgerStub, currencyStub), db };
  }

  // No hand-fed `skip`: it is derived from page and limit, the way a real
  // request derives it. Supplying it here would have hidden the very bug
  // TASK-4.2 found — a lost accessor that made every page serve page 1.
  const filter = (overrides: Record<string, unknown> = {}) =>
    ({ tripId: 'trip-1', page: 1, limit: 20, withTotal: true, ...overrides }) as never;

  it('always scopes the query to one trip and paginates it', async () => {
    const { service, db } = setup();
    const result = await service.listByTrip(ACTOR, filter({ page: 3, limit: 50 }));

    const args = db.tripEvent!.findMany!.mock.calls[0][0];
    expect(args.where.tripId).toBe('trip-1');
    // One beyond the page: that extra row is what answers "is there more"
    // without a second count (TASK-4.2).
    expect(args.take).toBe(51);
    expect(args.skip).toBe(100);
    expect(result.total).toBe(1);
  });

  it('skips the count when the caller does not want a total (TASK-4.2)', async () => {
    const { service, db } = setup();

    const result = await service.listByTrip(ACTOR, filter({ withTotal: false }));

    // Counting a table that grows without bound is a scan, paid on every page.
    expect(db.tripEvent!.count).not.toHaveBeenCalled();
    expect(result.total).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  it('reports another page without counting anything', async () => {
    const { service, db } = setup();
    db.tripEvent!.findMany!.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({ id: `e${i}` })),
    );

    const result = await service.listByTrip(ACTOR, filter({ withTotal: false }));

    expect(result.hasMore).toBe(true);
    // The extra row answered the question; it is not handed to the caller.
    expect(result.data).toHaveLength(20);
  });

  it('narrows by the requested time window when one is given', async () => {
    const { service, db } = setup();
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-08-02T00:00:00Z');
    await service.listByTrip(ACTOR, filter({ from, to }));

    expect(db.tripEvent!.findMany!.mock.calls[0][0].where.eventTime).toEqual({
      gte: from,
      lte: to,
    });
  });

  it('lets a driver read their own trip', async () => {
    const { service } = setup();
    const driverActor = { ...ACTOR, role: 'DRIVER' } as typeof ACTOR;
    await expect(service.listByTrip(driverActor, filter())).resolves.toMatchObject({ total: 1 });
  });

  it("hides another driver's trip from a driver", async () => {
    const { service, db } = setup();
    db.driver!.findFirst!.mockResolvedValue({ id: 'other-driver', userId: 'user-1' });
    const driverActor = { ...ACTOR, role: 'DRIVER' } as typeof ACTOR;

    await expect(service.listByTrip(driverActor, filter())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(db.tripEvent!.findMany).not.toHaveBeenCalled();
  });

  it('lets office roles read any trip in their own company', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue({ id: 'trip-1', driverId: 'someone-else' });

    await expect(service.listByTrip(ACTOR, filter())).resolves.toMatchObject({ total: 1 });
    // Ownership is a driver-only restriction; the tenant scope still applies.
    expect(db.driver!.findFirst).not.toHaveBeenCalled();
  });

  it('reports a trip from another tenant as missing', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue(null);

    await expect(service.listByTrip(ACTOR, filter())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
