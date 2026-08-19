import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { TripEventType } from '@prisma/client';
import { LiveStatus, type CurrentUserPayload } from 'shared';
import { distanceToSegmentKm } from '../../common/geo';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { PositionBatchDto } from './dto/position.dto';

const GPS_RETENTION_DAYS = 90;

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
  ) {}

  async ingestPositions(
    actor: CurrentUserPayload,
    dto: PositionBatchDto,
  ): Promise<{ accepted: number; dropped: number }> {
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
      db.gpsTrack.findMany({
        where: { vehicleId: { in: vehicles.map((v) => v.id) } },
        orderBy: { recordedAt: 'desc' },
        distinct: ['vehicleId'],
      }),
    ]);
    const eventByTrip = new Map(lastEvents.map((e) => [e.tripId, e]));
    const positionByVehicle = new Map(lastPositions.map((p) => [p.vehicleId, p]));

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
              recordedAt: position.recordedAt,
            }
          : null,
        deviationKm,
      };
    });
  }

  /** Route history for one vehicle (map polyline, TZ W-2 «marshrut tarixi»). */
  async history(
    actor: CurrentUserPayload,
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ lat: number; lng: number; speed: number | null; recordedAt: Date }>> {
    const points = await this.prisma.forCompany(actor.companyId).gpsTrack.findMany({
      where: { vehicleId, recordedAt: { gte: from, lte: to } },
      orderBy: { recordedAt: 'asc' },
      select: { lat: true, lng: true, speed: true, recordedAt: true },
    });
    return points;
  }

  /**
   * TZ §5 note: gps_tracks grows fast — moves >90-day rows to cold storage.
   *
   * A single SQL statement, so it is idempotent: rows are deleted and inserted
   * in one transaction and a second run simply finds nothing left to move.
   * Failures are thrown, not swallowed, so the caller decides — the HTTP cron
   * endpoint reports them, the in-process timer below only logs.
   */
  async archiveOldTracks(): Promise<number> {
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
    if (moved > 0) {
      this.logger.log(`Archived ${moved} GPS points older than ${GPS_RETENTION_DAYS}d`);
    }
    return moved;
  }

  /**
   * The in-process schedule used by a self-hosted (Docker) deployment. It
   * swallows failures on purpose — a nightly maintenance job must never take
   * the running server down. Serverless deployments have no timer and call the
   * `/cron/archive-gps` endpoint instead, which does surface failures.
   */
  @Cron('0 3 * * *')
  async archiveOldTracksScheduled(): Promise<void> {
    try {
      await this.archiveOldTracks();
    } catch (error) {
      this.logger.error(
        `GPS archive job failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
