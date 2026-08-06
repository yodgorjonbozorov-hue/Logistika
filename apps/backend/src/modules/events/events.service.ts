import { HttpStatus, Injectable } from '@nestjs/common';
import type { Driver, TripEvent } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
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
  ) {}

  /** The driver profile linked to the logged-in user (DRIVER role). */
  async requireDriverProfile(actor: CurrentUserPayload): Promise<Driver> {
    const driver = await this.prisma
      .forCompany(actor.companyId)
      .driver.findFirst({ where: { userId: actor.userId, isActive: true } });
    if (!driver) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return driver;
  }

  /**
   * Idempotent offline sync (TZ §3.1): every event carries a client UUID.
   * Re-sending an already stored event reports it as a duplicate, never a
   * second row; one bad event never fails the whole batch.
   */
  async ingestBatch(actor: CurrentUserPayload, dto: EventBatchDto): Promise<BatchResult> {
    const driver = await this.requireDriverProfile(actor);
    const db = this.prisma.forCompany(actor.companyId);

    const result: BatchResult = { accepted: [], duplicates: [], rejected: [] };

    const ids = dto.events.map((e) => e.clientEventId);
    const existing = await db.tripEvent.findMany({
      where: { clientEventId: { in: ids } },
      select: { clientEventId: true },
    });
    const seen = new Set(existing.map((e) => e.clientEventId));

    for (const event of dto.events) {
      if (seen.has(event.clientEventId)) {
        result.duplicates.push(event.clientEventId);
        continue;
      }
      // Trip must exist in this tenant and belong to this driver.
      const trip = await db.trip.findUnique({ where: { id: event.tripId } });
      if (!trip || trip.driverId !== driver.id) {
        result.rejected.push({ clientEventId: event.clientEventId, code: 'NOT_FOUND' });
        continue;
      }
      const photoUrls = await this.resolvePhotoKeys(actor, event);
      await db.tripEvent.create({
        data: {
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
          photoUrls,
          clientEventId: event.clientEventId,
        },
      });
      seen.add(event.clientEventId);
      result.accepted.push(event.clientEventId);
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

  async listByTrip(actor: CurrentUserPayload, tripId: string): Promise<TripEvent[]> {
    return this.prisma.forCompany(actor.companyId).tripEvent.findMany({
      where: { tripId },
      orderBy: { eventTime: 'asc' },
    });
  }

  /** Photo file ids → stored keys; foreign/unknown ids are dropped silently-safe (tenant scope). */
  private async resolvePhotoKeys(
    actor: CurrentUserPayload,
    event: DriverEventDto,
  ): Promise<string[] | undefined> {
    if (!event.photoFileIds?.length) return undefined;
    const files = await this.prisma.forCompany(actor.companyId).storedFile.findMany({
      where: { id: { in: event.photoFileIds } },
      select: { id: true },
    });
    return files.map((f) => f.id);
  }
}
