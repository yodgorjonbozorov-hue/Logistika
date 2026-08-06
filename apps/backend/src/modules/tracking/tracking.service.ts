import { Injectable } from '@nestjs/common';
import type { CurrentUserPayload } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { PositionBatchDto } from './dto/position.dto';

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * GPS batch from the driver app (2–5 min interval, offline-buffered).
   * vehicleId is resolved server-side from the trip; points for trips that
   * are not this driver's are dropped, and the accepted count is reported.
   */
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
}
