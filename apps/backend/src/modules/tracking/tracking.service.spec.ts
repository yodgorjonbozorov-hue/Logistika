import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import type { EventsService } from '../events/events.service';
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
    const service = new TrackingService(prisma, eventsService);
    return { service, db };
  }

  const point = (tripId: string) => ({
    tripId,
    lat: 40.1,
    lng: 67.8,
    speed: 72,
    recordedAt: '2026-08-06T10:00:00Z',
  });

  it('resolves vehicleId from the trip and stores accepted points', async () => {
    const { service, db } = setup();
    db.trip!.findMany!.mockResolvedValue([{ id: 'trip-1', vehicleId: 'v1' }]);

    const result = await service.ingestPositions(DRIVER_ACTOR, {
      positions: [point('trip-1'), point('trip-1')],
    });

    expect(result).toEqual({ accepted: 2, dropped: 0 });
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

    expect(result).toEqual({ accepted: 0, dropped: 1 });
    expect(db.gpsTrack!.createMany).not.toHaveBeenCalled();
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
    return { service: new TrackingService(prisma, eventsService), db };
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
    return { service: new TrackingService(prisma, eventsService), db };
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
    return { service: new TrackingService(prisma, {} as unknown as EventsService), db };
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
