import { HttpStatus, Injectable } from '@nestjs/common';
import type { Driver, Prisma, TripEvent } from '@prisma/client';
import { UserRole, type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DriversService } from '../drivers/drivers.service';
import { DriverEventDto, EventBatchDto } from './dto/event.dto';

export interface BatchResult {
  accepted: string[];
  duplicates: string[];
  rejected: Array<{ clientEventId: string; code: string }>;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly drivers: DriversService,
  ) {}

  /** The driver profile linked to the logged-in user (DRIVER role). */
  requireDriverProfile(actor: CurrentUserPayload): Promise<Driver> {
    return this.drivers.requireProfile(actor);
  }

  /**
   * Idempotent offline sync (TZ §3.1): every event carries a client UUID.
   * Re-sending an already stored event reports it as a duplicate, never a
   * second row; one bad event never fails the whole batch.
   *
   * All lookups are batched: a 100-event sync used to run 200+ round trips
   * (one findUnique + one create each), which is a real problem over a truck's
   * 2G link (M-11).
   */
  async ingestBatch(actor: CurrentUserPayload, dto: EventBatchDto): Promise<BatchResult> {
    const driver = await this.requireDriverProfile(actor);
    const db = this.prisma.forCompany(actor.companyId);

    const result: BatchResult = { accepted: [], duplicates: [], rejected: [] };

    const [existing, ownTrips, photoIds] = await Promise.all([
      db.tripEvent.findMany({
        where: { clientEventId: { in: dto.events.map((e) => e.clientEventId) } },
        select: { clientEventId: true },
      }),
      // One query for every referenced trip, filtered to this driver's own
      // trips inside this tenant — anything missing is simply not theirs.
      db.trip.findMany({
        where: { id: { in: [...new Set(dto.events.map((e) => e.tripId))] }, driverId: driver.id },
        select: { id: true },
      }),
      this.resolvePhotoFileIds(actor, dto.events),
    ]);

    const seen = new Set(existing.map((e) => e.clientEventId));
    const ownTripIds = new Set(ownTrips.map((t) => t.id));
    const rows: Prisma.TripEventCreateManyInput[] = [];

    for (const event of dto.events) {
      if (seen.has(event.clientEventId)) {
        result.duplicates.push(event.clientEventId);
        continue;
      }
      if (!ownTripIds.has(event.tripId)) {
        result.rejected.push({ clientEventId: event.clientEventId, code: 'NOT_FOUND' });
        continue;
      }
      const photos = event.photoFileIds?.filter((id) => photoIds.has(id)) ?? [];
      rows.push({
        companyId: actor.companyId as string,
        tripId: event.tripId,
        driverId: driver.id,
        eventType: event.eventType,
        eventTime: new Date(event.eventTime),
        lat: event.lat,
        lng: event.lng,
        address: event.address,
        odometer: event.odometer,
        comment: event.comment,
        photoUrls: photos.length > 0 ? photos : undefined,
        clientEventId: event.clientEventId,
      });
      seen.add(event.clientEventId);
      result.accepted.push(event.clientEventId);
    }

    if (rows.length > 0) {
      // skipDuplicates keeps a concurrent second sync of the same batch
      // idempotent instead of exploding on the unique index.
      await db.tripEvent.createMany({ data: rows, skipDuplicates: true });
    }

    this.audit.log({
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'EVENT_BATCH',
      entityType: 'TripEvent',
      after: {
        accepted: result.accepted.length,
        duplicates: result.duplicates.length,
        rejected: result.rejected.length,
      },
    });
    return result;
  }

  /**
   * Events of ONE trip.
   *
   * `tripId` is mandatory (H-1): without it the query returned every event in
   * the company. A DRIVER additionally only ever sees their own trips —
   * another driver's trip is indistinguishable from a missing one.
   */
  async listByTrip(actor: CurrentUserPayload, tripId: string): Promise<TripEvent[]> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.TripWhereInput = { id: tripId };
    if (actor.role === UserRole.DRIVER) {
      where.driverId = (await this.requireDriverProfile(actor)).id;
    }
    const trip = await db.trip.findFirst({ where, select: { id: true } });
    if (!trip) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    return db.tripEvent.findMany({ where: { tripId }, orderBy: { eventTime: 'asc' } });
  }

  /**
   * Keeps only photo ids that really exist in THIS tenant, in one query for
   * the whole batch. Foreign or unknown ids are dropped rather than stored.
   */
  private async resolvePhotoFileIds(
    actor: CurrentUserPayload,
    events: DriverEventDto[],
  ): Promise<Set<string>> {
    const ids = [...new Set(events.flatMap((e) => e.photoFileIds ?? []))];
    if (ids.length === 0) return new Set();
    const files = await this.prisma
      .forCompany(actor.companyId)
      .storedFile.findMany({ where: { id: { in: ids } }, select: { id: true } });
    return new Set(files.map((f) => f.id));
  }
}
