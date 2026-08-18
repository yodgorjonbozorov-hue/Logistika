import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/exceptions/app.exception';
import { Cron } from '@nestjs/schedule';
import { CronLockService } from '../../common/jobs/cron-lock.service';
import type { TripEventType } from '@prisma/client';
import { LiveStatus, type CurrentUserPayload } from 'shared';
import { distanceToSegmentKm } from '../../common/geo';
import { PrismaService, type TenantScopedClient } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { PositionBatchDto } from './dto/position.dto';

const GPS_RETENTION_DAYS = 90;
/**
 * How long cold storage keeps a point before it is dropped for good (M-9).
 *
 * `gps_tracks_archive` was written to nightly and never read from or cleaned:
 * the table only ever grew. Two years is the default because that is roughly
 * how far back a tax or insurance dispute reaches; a company that needs longer
 * raises GPS_ARCHIVE_RETENTION_DAYS, and one that needs a permanent record
 * exports to cold files rather than paying for hot disk for ever.
 */
const DEFAULT_ARCHIVE_RETENTION_DAYS = 730;

/**
 * The widest history window a single request may ask for.
 *
 * A month of one truck is already ~86 000 points. Anything wider is a report,
 * not a map, and belongs to an export that can be built in the background.
 */
export const MAX_HISTORY_DAYS = 31;

/** Rows read before thinning — the ceiling on what one request can cost. */
export const MAX_HISTORY_ROWS = 100_000;

/** Points actually returned. More than this cannot be seen on a polyline. */
export const MAX_HISTORY_POINTS = 2_000;

export interface HistoryPoint {
  lat: number;
  lng: number;
  speed: number | null;
  recordedAt: Date;
}

export interface HistoryResult {
  points: HistoryPoint[];
  /** How many stored points the returned line was drawn from. */
  totalPoints: number;
  /** True when the range held more than MAX_HISTORY_ROWS and was cut short. */
  truncated: boolean;
}

function assertHistoryWindow(from: Date, to: Date): void {
  if (to < from) {
    throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
      'to must not be earlier than from',
    ]);
  }
  const days = (to.getTime() - from.getTime()) / (24 * 3600 * 1000);
  if (days > MAX_HISTORY_DAYS) {
    throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
      `the history window must not exceed ${MAX_HISTORY_DAYS} days`,
    ]);
  }
}

/**
 * Keeps at most `limit` points, evenly spaced, with both ends intact.
 *
 * Evenly spaced rather than "every Nth until the budget runs out": the first
 * and last point are where the journey began and ended, and a route that loses
 * its end looks like a truck that never arrived.
 */
export function downsample(points: HistoryPoint[], limit: number): HistoryPoint[] {
  if (points.length <= limit) return points;

  const step = (points.length - 1) / (limit - 1);
  const kept: HistoryPoint[] = [];
  for (let i = 0; i < limit; i++) kept.push(points[Math.round(i * step)]!);
  return kept;
}

/** Vehicle status derives from the latest driver event (TZ §4.1 W-2). */
export function statusFromEvent(
  eventType: TripEventType | null,
  hasActiveTrip: boolean,
): LiveStatus {
  if (!hasActiveTrip) return LiveStatus.IDLE;
  switch (eventType) {
    case 'BREAKDOWN':
      return LiveStatus.BREAKDOWN;
    case 'REST':
      return LiveStatus.RESTING;
    case 'DELIVERED':
    case 'FINISH':
      return LiveStatus.IDLE;
    case null:
      return LiveStatus.IDLE; // assigned but not started yet
    default:
      return LiveStatus.MOVING;
  }
}

export interface LiveVehicle {
  vehicleId: string;
  plateNumber: string;
  status: LiveStatus;
  trip: { id: string; tripNumber: string; cargoName: string | null } | null;
  driverName: string | null;
  lastPosition: { lat: number; lng: number; speed: number | null; recordedAt: Date } | null;
  /** Km off the straight loading→unloading corridor (heuristic; null when unknown). */
  deviationKm: number | null;
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    private readonly cronLock: CronLockService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Takes a batch of positions from a phone.
   *
   * Re-sending is normal, not exceptional (M-7, TASK-4.5): the phone marks a
   * batch sent only after the server acknowledges it, so a phone that dies in
   * between sends it again. Duplicates are skipped in the database rather than
   * checked for beforehand — a read-then-write would still race two flushes
   * from the same phone against each other.
   */
  async ingestPositions(
    actor: CurrentUserPayload,
    dto: PositionBatchDto,
  ): Promise<{ accepted: number; duplicates: number; dropped: number }> {
    const driver = await this.eventsService.requireDriverProfile(actor);
    const db = this.prisma.forCompany(actor.companyId);

    const tripIds = [...new Set(dto.positions.map((p) => p.tripId))];
    const trips = await db.trip.findMany({
      where: { id: { in: tripIds }, driverId: driver.id },
      select: { id: true, vehicleId: true },
    });
    const vehicleByTrip = new Map(trips.map((t) => [t.id, t.vehicleId]));

    const rows = dto.positions.flatMap((p) => {
      const vehicleId = vehicleByTrip.get(p.tripId);
      if (!vehicleId) return [];
      return [
        {
          companyId: actor.companyId as string,
          vehicleId,
          tripId: p.tripId,
          lat: p.lat,
          lng: p.lng,
          speed: p.speed,
          heading: p.heading,
          recordedAt: new Date(p.recordedAt),
        },
      ];
    });

    let accepted = 0;
    if (rows.length > 0) {
      // A batch can also contain the same instant twice within itself, so the
      // rows are deduplicated here before the database has to.
      const unique = this.dedupe(rows);
      ({ count: accepted } = await db.gpsTrack.createMany({
        data: unique,
        skipDuplicates: true,
      }));
      // The last-known position is still refreshed from the whole batch: a
      // duplicate carries the same coordinates, and the guard on `lastSeenAt`
      // already refuses anything older than what the map shows.
      await this.rememberLastPositions(db, unique);
    }
    return {
      accepted,
      duplicates: rows.length - accepted,
      dropped: dto.positions.length - rows.length,
    };
  }

  /** Keeps one row per vehicle and instant, matching the database's own key. */
  private dedupe<T extends { vehicleId: string; recordedAt: Date }>(rows: T[]): T[] {
    const seen = new Map<string, T>();
    for (const row of rows) {
      seen.set(`${row.vehicleId}|${row.recordedAt.getTime()}`, row);
    }
    return [...seen.values()];
  }

  /**
   * Copies the newest point of this batch onto each vehicle (TASK-4.1).
   *
   * One update per vehicle, not per point — a batch of 500 points from four
   * trucks is four writes. This is what lets the live map read `vehicles` alone
   * instead of searching ten million tracks for the newest row per vehicle.
   *
   * The guard on `lastSeenAt` matters because a phone that was offline flushes
   * its queue late: those points are older than what the map already shows, and
   * writing them would drag the marker backwards in time.
   */
  private async rememberLastPositions(
    db: TenantScopedClient,
    rows: Array<{
      vehicleId: string;
      tripId: string;
      lat: number;
      lng: number;
      speed?: number | null;
      recordedAt: Date;
    }>,
  ): Promise<void> {
    const newest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const current = newest.get(row.vehicleId);
      if (!current || row.recordedAt > current.recordedAt) newest.set(row.vehicleId, row);
    }

    await Promise.all(
      [...newest.values()].map((row) =>
        db.vehicle.updateMany({
          where: {
            id: row.vehicleId,
            OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: row.recordedAt } }],
          },
          data: {
            lastLat: row.lat,
            lastLng: row.lng,
            lastSpeed: row.speed ?? null,
            lastSeenAt: row.recordedAt,
            lastTripId: row.tripId,
          },
        }),
      ),
    );
  }

  /** W-2 live map: every active vehicle with derived status and last point. */
  async live(actor: CurrentUserPayload): Promise<LiveVehicle[]> {
    const db = this.prisma.forCompany(actor.companyId);
    const [vehicles, activeTrips] = await Promise.all([
      db.vehicle.findMany({ where: { isActive: true, type: { not: 'TRAILER' } } }),
      db.trip.findMany({
        where: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
        include: { driver: true },
      }),
    ]);
    const tripByVehicle = new Map(activeTrips.map((t) => [t.vehicleId, t]));

    // gps_tracks is deliberately not read here (TASK-4.1). Asking it for the
    // newest row per vehicle meant a sequential scan and a sort of the whole
    // table — ten million rows to display forty — every thirty seconds.
    const lastEvents = await db.tripEvent.findMany({
      where: { tripId: { in: activeTrips.map((t) => t.id) } },
      orderBy: { eventTime: 'desc' },
      distinct: ['tripId'],
    });
    const eventByTrip = new Map(lastEvents.map((e) => [e.tripId, e]));

    return vehicles.map((vehicle) => {
      const trip = tripByVehicle.get(vehicle.id) ?? null;
      const lastEvent = trip ? (eventByTrip.get(trip.id) ?? null) : null;
      const position =
        vehicle.lastSeenAt != null && vehicle.lastLat != null && vehicle.lastLng != null
          ? {
              lat: vehicle.lastLat,
              lng: vehicle.lastLng,
              speed: vehicle.lastSpeed,
              recordedAt: vehicle.lastSeenAt,
            }
          : null;

      let deviationKm: number | null = null;
      if (
        trip?.loadingLat != null &&
        trip.loadingLng != null &&
        trip.unloadingLat != null &&
        trip.unloadingLng != null &&
        position
      ) {
        deviationKm =
          Math.round(
            distanceToSegmentKm(
              { lat: position.lat, lng: position.lng },
              { lat: trip.loadingLat, lng: trip.loadingLng },
              { lat: trip.unloadingLat, lng: trip.unloadingLng },
            ) * 10,
          ) / 10;
      }

      return {
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        status: statusFromEvent(lastEvent?.eventType ?? null, trip?.status === 'IN_PROGRESS'),
        trip: trip ? { id: trip.id, tripNumber: trip.tripNumber, cargoName: trip.cargoName } : null,
        driverName: trip?.driver?.fullName ?? null,
        lastPosition: position
          ? {
              lat: position.lat,
              lng: position.lng,
              speed: position.speed,
              recordedAt: position.recordedAt,
            }
          : null,
        deviationKm,
      };
    });
  }

  /**
   * Route history for one vehicle (map polyline, TZ W-2 «marshrut tarixi»).
   *
   * Bounded twice over (TASK-4.1). The window is capped at 31 days because the
   * query was unbounded: 90 days of one truck is 259 000 points, sent as one
   * JSON array, to draw a line on a screen a thousand pixels wide.
   *
   * Beyond MAX_HISTORY_POINTS the result is thinned rather than truncated. A
   * truncated route is a lie — it shows the truck stopping where the limit fell
   * — while an evenly thinned one is the same journey at lower resolution,
   * which is all a polyline can show anyway.
   */
  async history(
    actor: CurrentUserPayload,
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<HistoryResult> {
    assertHistoryWindow(from, to);

    const points = await this.prisma.forCompany(actor.companyId).gpsTrack.findMany({
      where: { vehicleId, recordedAt: { gte: from, lte: to } },
      orderBy: { recordedAt: 'asc' },
      select: { lat: true, lng: true, speed: true, recordedAt: true },
      // One more than the cap, so the caller learns the route was thinned
      // without a second counting query over the same range.
      take: MAX_HISTORY_ROWS + 1,
    });

    const truncated = points.length > MAX_HISTORY_ROWS;
    const kept = truncated ? points.slice(0, MAX_HISTORY_ROWS) : points;
    return {
      points: downsample(kept, MAX_HISTORY_POINTS),
      totalPoints: kept.length,
      truncated,
    };
  }

  /**
   * TZ §5 note: gps_tracks grows fast — nightly move of >90-day rows to cold
   * storage, then a sweep of cold rows past the retention horizon (M-9).
   *
   * Guarded by a distributed lock (TASK-4.4): `@Cron` fires in every process,
   * so on two API instances this moved the same rows twice a night.
   */
  @Cron('0 3 * * *')
  async archiveOldTracks(): Promise<void> {
    await this.cronLock.runExclusive('gps-archive', () => this.runArchive());
  }

  private async runArchive(): Promise<void> {
    try {
      const moved = await this.prisma.$executeRaw`
        WITH moved AS (
          DELETE FROM gps_tracks
          WHERE recorded_at < now() - make_interval(days => ${GPS_RETENTION_DAYS})
          RETURNING *
        )
        INSERT INTO gps_tracks_archive
          (id, company_id, vehicle_id, trip_id, lat, lng, speed, heading, recorded_at)
        SELECT id, company_id, vehicle_id, trip_id, lat, lng, speed, heading, recorded_at
        FROM moved
      `;
      if (moved > 0)
        this.logger.log(`Archived ${moved} GPS points older than ${GPS_RETENTION_DAYS}d`);

      const purged = await this.purgeArchive();
      if (purged > 0) this.logger.log(`Purged ${purged} archived GPS points past retention`);
    } catch (error) {
      this.logger.error(
        `GPS archive job failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Drops cold rows older than the retention horizon (M-9). */
  private async purgeArchive(): Promise<number> {
    const days = this.archiveRetentionDays();
    if (days <= 0) return 0;
    return this.prisma.$executeRaw`
      DELETE FROM gps_tracks_archive
      WHERE recorded_at < now() - make_interval(days => ${days})
    `;
  }

  /** `0` switches the sweep off, for a deployment that keeps everything. */
  private archiveRetentionDays(): number {
    const configured = Number(this.config.get<string>('GPS_ARCHIVE_RETENTION_DAYS'));
    return Number.isFinite(configured) && configured >= 0
      ? configured
      : DEFAULT_ARCHIVE_RETENTION_DAYS;
  }
}
