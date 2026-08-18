import {
  ACTOR,
  createConfigMock,
  createCronLockMock,
  createTenantDbMock,
} from '../../test-utils/tenant-db.mock';
import type { EventsService } from '../events/events.service';

// Crons run behind a distributed lock (TASK-4.4); these tests are about what
// the jobs do, so the lock always lets them through.
const { cronLock } = createCronLockMock();
const config = createConfigMock();
import {
  MAX_HISTORY_DAYS,
  MAX_HISTORY_POINTS,
  MAX_HISTORY_ROWS,
  TrackingService,
  downsample,
  type HistoryPoint,
} from './tracking.service';

const DRIVER_ACTOR = { ...ACTOR, role: 'DRIVER' } as typeof ACTOR;

describe('TrackingService.ingestPositions', () => {
  function setup() {
    const { prisma, db } = createTenantDbMock(['trip', 'gpsTrack', 'vehicle', 'tripEvent']);
    db.gpsTrack!.createMany = jest.fn().mockResolvedValue({ count: 0 });
    const eventsService = {
      requireDriverProfile: jest.fn().mockResolvedValue({ id: 'd1' }),
    } as unknown as EventsService;
    const service = new TrackingService(prisma, eventsService, cronLock, config);
    return { service, db };
  }

  const point = (tripId: string, minute = 0) => ({
    tripId,
    lat: 40.1,
    lng: 67.8,
    speed: 72,
    recordedAt: `2026-08-06T10:0${minute}:00Z`,
  });

  it('resolves vehicleId from the trip and stores accepted points', async () => {
    const { service, db } = setup();
    db.trip!.findMany!.mockResolvedValue([{ id: 'trip-1', vehicleId: 'v1' }]);
    (db.gpsTrack!.createMany as jest.Mock).mockResolvedValue({ count: 2 });

    const result = await service.ingestPositions(DRIVER_ACTOR, {
      positions: [point('trip-1', 0), point('trip-1', 1)],
    });

    expect(result).toEqual({ accepted: 2, duplicates: 0, dropped: 0 });
    const rows = (db.gpsTrack!.createMany as jest.Mock).mock.calls[0][0].data;
    expect(rows[0].vehicleId).toBe('v1');
    expect(rows[0].companyId).toBe('company-a');
    expect(rows[0].recordedAt).toBeInstanceOf(Date);
  });

  it("drops points for trips that are not this driver's", async () => {
    const { service, db } = setup();
    db.trip!.findMany!.mockResolvedValue([]); // tenant/driver scope filters it out

    const result = await service.ingestPositions(DRIVER_ACTOR, {
      positions: [point('foreign-trip')],
    });

    expect(result).toEqual({ accepted: 0, duplicates: 0, dropped: 1 });
    expect(db.gpsTrack!.createMany).not.toHaveBeenCalled();
  });
});

describe('TrackingService.ingestPositions — idempotency (TASK-4.5, M-7)', () => {
  function setup() {
    const { prisma, db } = createTenantDbMock(['trip', 'gpsTrack', 'vehicle', 'tripEvent']);
    db.trip!.findMany!.mockResolvedValue([{ id: 'trip-1', vehicleId: 'v1' }]);
    db.gpsTrack!.createMany = jest.fn().mockResolvedValue({ count: 0 });
    const eventsService = {
      requireDriverProfile: jest.fn().mockResolvedValue({ id: 'd1' }),
    } as unknown as EventsService;
    return { service: new TrackingService(prisma, eventsService, cronLock, config), db };
  }

  const at = (iso: string) => ({ tripId: 'trip-1', lat: 40.1, lng: 67.8, recordedAt: iso });

  it('asks the database to skip what it already has', async () => {
    const { service, db } = setup();

    await service.ingestPositions(DRIVER_ACTOR, { positions: [at('2026-08-06T10:00:00Z')] });

    // Not a read-then-write: two flushes from the same phone would race each
    // other through the gap between the check and the insert.
    expect((db.gpsTrack!.createMany as jest.Mock).mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it('collapses a batch that repeats an instant within itself', async () => {
    const { service, db } = setup();

    await service.ingestPositions(DRIVER_ACTOR, {
      positions: [at('2026-08-06T10:00:00Z'), at('2026-08-06T10:00:00Z')],
    });

    const rows = (db.gpsTrack!.createMany as jest.Mock).mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
  });

  it('reports a fully re-sent batch as duplicates, not as accepted', async () => {
    const { service, db } = setup();
    (db.gpsTrack!.createMany as jest.Mock).mockResolvedValue({ count: 0 });

    const result = await service.ingestPositions(DRIVER_ACTOR, {
      positions: [at('2026-08-06T10:00:00Z'), at('2026-08-06T10:01:00Z')],
    });

    // The phone marks a batch sent only after the server answers, so a phone
    // that dies in between re-sends it. That is normal, and the honest answer
    // is "nothing new", not "two more points".
    expect(result).toEqual({ accepted: 0, duplicates: 2, dropped: 0 });
  });

  it('counts a partly-new batch correctly', async () => {
    const { service, db } = setup();
    (db.gpsTrack!.createMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await service.ingestPositions(DRIVER_ACTOR, {
      positions: [at('2026-08-06T10:00:00Z'), at('2026-08-06T10:01:00Z')],
    });

    expect(result).toEqual({ accepted: 1, duplicates: 1, dropped: 0 });
  });

  it('keeps the last-known position fresh even when every point was a duplicate', async () => {
    const { service, db } = setup();
    (db.gpsTrack!.createMany as jest.Mock).mockResolvedValue({ count: 0 });

    await service.ingestPositions(DRIVER_ACTOR, { positions: [at('2026-08-06T10:00:00Z')] });

    // A duplicate carries the same coordinates, and the guard on lastSeenAt
    // already refuses anything older than what the map shows.
    expect(db.vehicle!.updateMany).toHaveBeenCalled();
  });
});

describe('TrackingService.ingestPositions — last known position (TASK-4.1)', () => {
  function setup() {
    const { prisma, db } = createTenantDbMock(['trip', 'gpsTrack', 'vehicle']);
    db.gpsTrack!.createMany = jest.fn().mockResolvedValue({ count: 0 });
    db.trip!.findMany!.mockResolvedValue([
      { id: 'trip-1', vehicleId: 'v1' },
      { id: 'trip-2', vehicleId: 'v2' },
    ]);
    const eventsService = {
      requireDriverProfile: jest.fn().mockResolvedValue({ id: 'd1' }),
    } as unknown as EventsService;
    return { service: new TrackingService(prisma, eventsService, cronLock, config), db };
  }

  const at = (tripId: string, recordedAt: string, lat = 40.1) => ({
    tripId,
    lat,
    lng: 67.8,
    speed: 72,
    recordedAt,
  });

  it('writes one update per vehicle, not one per point', async () => {
    const { service, db } = setup();

    await service.ingestPositions(DRIVER_ACTOR, {
      positions: [
        at('trip-1', '2026-08-06T10:00:00Z'),
        at('trip-1', '2026-08-06T10:00:30Z'),
        at('trip-1', '2026-08-06T10:01:00Z'),
        at('trip-2', '2026-08-06T10:01:00Z'),
      ],
    });

    // Four points from two trucks is two writes; a batch of 500 would still be
    // two. This is what makes the denormalisation affordable.
    expect(db.vehicle!.updateMany).toHaveBeenCalledTimes(2);
  });

  it('keeps the newest point of the batch, whatever order it arrived in', async () => {
    const { service, db } = setup();

    await service.ingestPositions(DRIVER_ACTOR, {
      positions: [
        at('trip-1', '2026-08-06T10:01:00Z', 41.9),
        at('trip-1', '2026-08-06T10:00:00Z', 40.1),
      ],
    });

    const { data } = db.vehicle!.updateMany!.mock.calls[0][0];
    expect(data.lastLat).toBe(41.9);
    expect(data.lastSeenAt).toEqual(new Date('2026-08-06T10:01:00Z'));
    expect(data.lastTripId).toBe('trip-1');
  });

  it('refuses to drag the marker backwards with a late flush', async () => {
    const { service, db } = setup();

    await service.ingestPositions(DRIVER_ACTOR, {
      positions: [at('trip-1', '2026-08-06T10:00:00Z')],
    });

    // A phone that was offline flushes points older than what the map shows.
    const { where } = db.vehicle!.updateMany!.mock.calls[0][0];
    expect(where).toEqual({
      id: 'v1',
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date('2026-08-06T10:00:00Z') } }],
    });
  });

  it('writes nothing when every point was dropped', async () => {
    const { service, db } = setup();
    db.trip!.findMany!.mockResolvedValue([]);

    await service.ingestPositions(DRIVER_ACTOR, {
      positions: [at('foreign', '2026-08-06T10:00:00Z')],
    });

    expect(db.vehicle!.updateMany).not.toHaveBeenCalled();
  });
});

describe('TrackingService.live (TASK-4.1)', () => {
  function setup() {
    const { prisma, db } = createTenantDbMock(['vehicle', 'trip', 'tripEvent', 'gpsTrack']);
    db.vehicle!.findMany!.mockResolvedValue([
      {
        id: 'v1',
        plateNumber: '01A123BC',
        lastLat: 41.3,
        lastLng: 69.2,
        lastSpeed: 64,
        lastSeenAt: new Date('2026-08-06T10:00:00Z'),
      },
    ]);
    db.trip!.findMany!.mockResolvedValue([]);
    db.tripEvent!.findMany!.mockResolvedValue([]);
    const eventsService = {} as unknown as EventsService;
    return { service: new TrackingService(prisma, eventsService, cronLock, config), db };
  }

  it('never touches the GPS table', async () => {
    const { service, db } = setup();

    await service.live(ACTOR);

    // Asking gps_tracks for the newest row per vehicle meant a sequential scan
    // and a sort of ten million rows, every thirty seconds, to show forty.
    expect(db.gpsTrack!.findMany).not.toHaveBeenCalled();
  });

  it('reads the last position off the vehicle row', async () => {
    const { service } = setup();

    const [vehicle] = await service.live(ACTOR);

    expect(vehicle!.lastPosition).toEqual({
      lat: 41.3,
      lng: 69.2,
      speed: 64,
      recordedAt: new Date('2026-08-06T10:00:00Z'),
    });
  });

  it('reports no position for a truck that has never reported one', async () => {
    const { service, db } = setup();
    db.vehicle!.findMany!.mockResolvedValue([
      { id: 'v2', plateNumber: '01B999XX', lastLat: null, lastLng: null, lastSeenAt: null },
    ]);

    const [vehicle] = await service.live(ACTOR);
    expect(vehicle!.lastPosition).toBeNull();
  });
});

describe('TrackingService.history (TASK-4.1)', () => {
  function setup(rows: HistoryPoint[]) {
    const { prisma, db } = createTenantDbMock(['gpsTrack']);
    db.gpsTrack!.findMany!.mockResolvedValue(rows);
    return {
      service: new TrackingService(prisma, {} as unknown as EventsService, cronLock, config),
      db,
    };
  }

  const day = (n: number) => new Date(2026, 0, 1 + n);
  const point = (i: number): HistoryPoint => ({
    lat: 41 + i / 1000,
    lng: 69,
    speed: null,
    recordedAt: new Date(2026, 0, 1, 0, 0, i),
  });

  it('refuses a window wider than a month', async () => {
    const { service } = setup([]);

    // 90 days of one truck is 259 000 points in one JSON response.
    await expect(
      service.history(ACTOR, 'v1', day(0), day(MAX_HISTORY_DAYS + 1)),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 400 });
  });

  it('accepts exactly a month', async () => {
    const { service } = setup([]);
    await expect(
      service.history(ACTOR, 'v1', day(0), day(MAX_HISTORY_DAYS)),
    ).resolves.toBeDefined();
  });

  it('refuses a range that runs backwards', async () => {
    const { service } = setup([]);
    await expect(service.history(ACTOR, 'v1', day(5), day(1))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('caps what it reads, whatever the range holds', async () => {
    const { service, db } = setup([]);

    await service.history(ACTOR, 'v1', day(0), day(30));

    expect(db.gpsTrack!.findMany!.mock.calls[0][0].take).toBe(MAX_HISTORY_ROWS + 1);
  });

  it('thins a long route instead of cutting it short', async () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => point(i));
    const { service } = setup(rows);

    const result = await service.history(ACTOR, 'v1', day(0), day(30));

    expect(result.points).toHaveLength(MAX_HISTORY_POINTS);
    expect(result.totalPoints).toBe(50_000);
    expect(result.truncated).toBe(false);
    // A truncated route shows the truck stopping where the limit fell.
    expect(result.points.at(-1)).toEqual(rows.at(-1));
  });

  it('says so when the range held more than it would read', async () => {
    const rows = Array.from({ length: MAX_HISTORY_ROWS + 1 }, (_, i) => point(i));
    const { service } = setup(rows);

    const result = await service.history(ACTOR, 'v1', day(0), day(30));

    expect(result.truncated).toBe(true);
    expect(result.totalPoints).toBe(MAX_HISTORY_ROWS);
  });

  it('returns a short route untouched', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => point(i));
    const { service } = setup(rows);

    const result = await service.history(ACTOR, 'v1', day(0), day(1));
    expect(result.points).toEqual(rows);
  });
});

describe('downsample', () => {
  const point = (i: number): HistoryPoint => ({
    lat: i,
    lng: 0,
    speed: null,
    recordedAt: new Date(2026, 0, 1, 0, 0, i),
  });

  it('keeps both ends', () => {
    const points = Array.from({ length: 1000 }, (_, i) => point(i));
    const kept = downsample(points, 10);

    // A route that loses its end looks like a truck that never arrived.
    expect(kept).toHaveLength(10);
    expect(kept[0]).toEqual(points[0]);
    expect(kept.at(-1)).toEqual(points.at(-1));
  });

  it('spaces the points evenly', () => {
    const points = Array.from({ length: 101 }, (_, i) => point(i));
    expect(downsample(points, 11).map((p) => p.lat)).toEqual([
      0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
    ]);
  });

  it('leaves a route already under the limit alone', () => {
    const points = Array.from({ length: 5 }, (_, i) => point(i));
    expect(downsample(points, 10)).toBe(points);
  });

  it('keeps the order it was given', () => {
    const points = Array.from({ length: 500 }, (_, i) => point(i));
    const kept = downsample(points, 50);
    expect(kept.map((p) => p.lat)).toEqual([...kept.map((p) => p.lat)].sort((a, b) => a - b));
  });
});

describe('TrackingService.archiveOldTracks (TASK-4.4)', () => {
  function setup(options: { acquired?: boolean; retentionDays?: string } = {}) {
    const { prisma } = createTenantDbMock([]);
    const executeRaw = jest.fn().mockResolvedValue(0);
    (prisma as unknown as { $executeRaw: jest.Mock }).$executeRaw = executeRaw;
    const lock = createCronLockMock({ acquired: options.acquired });
    const service = new TrackingService(
      prisma,
      {} as unknown as EventsService,
      lock.cronLock,
      createConfigMock(
        options.retentionDays === undefined
          ? {}
          : { GPS_ARCHIVE_RETENTION_DAYS: options.retentionDays },
      ),
    );
    return { service, executeRaw, lock };
  }

  it('runs behind the distributed lock', async () => {
    const { service, lock } = setup();

    await service.archiveOldTracks();

    // @Cron fires in every process; on two API boxes this used to move the
    // same rows twice a night.
    expect(lock.runExclusive).toHaveBeenCalledWith('gps-archive', expect.any(Function));
  });

  it('does nothing on an instance that lost the claim', async () => {
    const { service, executeRaw } = setup({ acquired: false });

    await service.archiveOldTracks();

    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('archives, then sweeps cold storage past the retention horizon (M-9)', async () => {
    const { service, executeRaw } = setup();

    await service.archiveOldTracks();

    // gps_tracks_archive was written to nightly and never cleaned: the table
    // only ever grew.
    expect(executeRaw).toHaveBeenCalledTimes(2);
    const sweep = executeRaw.mock.calls[1]![0] as string[];
    expect(sweep.join('?')).toContain('DELETE FROM gps_tracks_archive');
  });

  it('keeps everything when retention is switched off', async () => {
    const { service, executeRaw } = setup({ retentionDays: '0' });

    await service.archiveOldTracks();

    // A deployment that keeps a permanent record sets 0 and does its own
    // exports; the archival half still runs.
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('uses the configured horizon', async () => {
    const { service, executeRaw } = setup({ retentionDays: '365' });

    await service.archiveOldTracks();

    expect(executeRaw.mock.calls[1]![1]).toBe(365);
  });

  it('does not let a failing archive take the process down', async () => {
    const { service, executeRaw } = setup();
    executeRaw.mockRejectedValueOnce(new Error('deadlock detected'));

    // Housekeeping that crashes the API at 3am is worse than housekeeping that
    // is skipped and logged.
    await expect(service.archiveOldTracks()).resolves.toBeUndefined();
  });
});
