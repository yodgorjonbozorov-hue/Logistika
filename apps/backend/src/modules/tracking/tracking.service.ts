import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, type TripEventType } from '@prisma/client';
import { LiveStatus, type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { distanceToSegmentKm } from '../../common/geo';
import { PrismaService } from '../../prisma/prisma.service';
import { DriversService } from '../drivers/drivers.service';
import { MAX_HISTORY_RANGE_DAYS, PositionBatchDto, TrackHistoryDto } from './dto/position.dto';

const GPS_RETENTION_DAYS = 90;

/**
 * PostgreSQL advisory lock id for the nightly archive job (M-12).
 * With more than one API replica the cron fires on every one of them; the lock
 * makes sure exactly one actually moves rows. Any stable arbitrary constant.
 */
const ARCHIVE_LOCK_ID = 815_041_101;

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

interface LastPositionRow {
  vehicle_id: string;
  lat: number;
  lng: number;
  speed: number | null;
  recorded_at: Date;
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly drivers: DriversService,
  ) {}

  async ingestPositions(
    actor: CurrentUserPayload,
    dto: PositionBatchDto,
  ): Promise<{ accepted: number; dropped: number }> {
    const driver = await this.drivers.requireProfile(actor);
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

    if (rows.length > 0) {
      await db.gpsTrack.createMany({ data: rows });
    }
    return { accepted: rows.length, dropped: dto.positions.length - rows.length };
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

    const [lastEvents, lastPositions] = await Promise.all([
      db.tripEvent.findMany({
        where: { tripId: { in: activeTrips.map((t) => t.id) } },
        orderBy: { eventTime: 'desc' },
        distinct: ['tripId'],
      }),
      this.lastPositions(
        actor.companyId as string,
        vehicles.map((v) => v.id),
      ),
    ]);
    const eventByTrip = new Map(lastEvents.map((e) => [e.tripId, e]));
    const positionByVehicle = new Map(lastPositions.map((p) => [p.vehicle_id, p]));

    return vehicles.map((vehicle) => {
      const trip = tripByVehicle.get(vehicle.id) ?? null;
      const lastEvent = trip ? (eventByTrip.get(trip.id) ?? null) : null;
      const position = positionByVehicle.get(vehicle.id) ?? null;

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
              recordedAt: position.recorded_at,
            }
          : null,
        deviationKm,
      };
    });
  }

  /**
   * Latest fix per vehicle (H-7).
   *
   * Three implementations, and only the third actually scales:
   *
   *  1. Prisma `distinct: ['vehicleId']` — applied IN THE CLIENT. Every
   *     matching gps_tracks row is downloaded and de-duplicated in Node, so a
   *     fleet with a few weeks of history moves millions of rows per map load.
   *  2. `SELECT DISTINCT ON (vehicle_id) … ORDER BY vehicle_id, recorded_at
   *     DESC` — keeps the data in PostgreSQL, but there is no index skip scan,
   *     so it still reads every row of the table (verified with EXPLAIN).
   *  3. This: one LATERAL probe per vehicle, each an index seek that stops at
   *     the first row. Cost scales with the number of VEHICLES (tens), not with
   *     the number of points (millions) — exactly what the
   *     (company_id, vehicle_id, recorded_at DESC) index is shaped for.
   *
   * The tenant scope is applied by hand because raw SQL bypasses the Prisma
   * extension; company_id is bound as a parameter, never interpolated.
   */
  private async lastPositions(companyId: string, vehicleIds: string[]): Promise<LastPositionRow[]> {
    if (vehicleIds.length === 0) return [];
    return this.prisma.$queryRaw<LastPositionRow[]>`
      SELECT v.id AS vehicle_id, g.lat, g.lng, g.speed, g.recorded_at
      FROM unnest(ARRAY[${Prisma.join(vehicleIds)}]::text[]) AS v(id)
      CROSS JOIN LATERAL (
        SELECT lat, lng, speed, recorded_at
        FROM gps_tracks
        WHERE company_id = ${companyId} AND vehicle_id = v.id
        ORDER BY recorded_at DESC
        LIMIT 1
      ) g
    `;
  }

  /**
   * Route history for one vehicle (map polyline, TZ W-2 «marshrut tarixi»).
   *
   * Bounded on every axis (H-8): the window may not exceed
   * {@link MAX_HISTORY_RANGE_DAYS}, the page size is capped by the DTO, and the
   * caller pages forward with the `recordedAt` cursor returned in `nextCursor`.
   */
  async history(
    actor: CurrentUserPayload,
    vehicleId: string,
    query: TrackHistoryDto,
  ): Promise<{
    points: Array<{ lat: number; lng: number; speed: number | null; recordedAt: Date }>;
    nextCursor: Date | null;
  }> {
    if (query.to < query.from) {
      throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
        'to must not be earlier than from',
      ]);
    }
    const rangeDays = (query.to.getTime() - query.from.getTime()) / 86_400_000;
    if (rangeDays > MAX_HISTORY_RANGE_DAYS) {
      throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
        `date range must not exceed ${MAX_HISTORY_RANGE_DAYS} days`,
      ]);
    }

    // The cursor is exclusive so a page boundary never repeats a point.
    const lowerBound = query.after ? { gt: query.after } : { gte: query.from };
    const points = await this.prisma.forCompany(actor.companyId).gpsTrack.findMany({
      where: { vehicleId, recordedAt: { ...lowerBound, lte: query.to } },
      orderBy: { recordedAt: 'asc' },
      take: query.limit,
      select: { lat: true, lng: true, speed: true, recordedAt: true },
    });

    // A full page means there may be more; hand back a cursor instead of
    // letting the caller widen the window until it hurts.
    const nextCursor =
      points.length === query.limit ? (points[points.length - 1]?.recordedAt ?? null) : null;
    return { points, nextCursor };
  }

  /** TZ §5 note: gps_tracks grows fast — nightly move of >90-day rows to cold storage. */
  @Cron('0 3 * * *')
  async archiveOldTracks(): Promise<void> {
    try {
      // M-12: every replica's scheduler fires this. `pg_try_advisory_xact_lock`
      // returns immediately — the replicas that lose simply skip this night.
      const moved = await this.prisma.$transaction(async (tx) => {
        const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(${ARCHIVE_LOCK_ID}) AS locked
        `;
        if (!lockRows[0]?.locked) return null;

        return tx.$executeRaw`
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
      });

      if (moved === null) {
        this.logger.debug('GPS archive job skipped — another replica holds the lock');
      } else if (moved > 0) {
        this.logger.log(`Archived ${moved} GPS points older than ${GPS_RETENTION_DAYS}d`);
      }
    } catch (error) {
      this.logger.error(
        `GPS archive job failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
