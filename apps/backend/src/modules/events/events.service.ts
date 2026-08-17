import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Driver, type Trip, type TripEvent, type TripStatus } from '@prisma/client';
import { UserRole, type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { requireTenantActor } from '../../common/tenant-actor';
import { canTransition } from '../../common/trip-transitions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrencyService } from '../currency/currency.service';
import { LedgerService } from '../ledger/ledger.service';
import { invoiceCompletedTrip } from '../ledger/trip-invoicing';
import { DriverEventDto, EventBatchDto, ListEventsDto } from './dto/event.dto';

export interface BatchResult {
  accepted: string[];
  duplicates: string[];
  rejected: Array<{ clientEventId: string; code: string }>;
}

/**
 * Driver buttons that move the trip itself (TZ §3.2): pressing "I'm on my way"
 * has to start the trip, otherwise the live map stays grey and the trip never
 * records finishedAt/endOdometer. Every other event is informational.
 */
const STATUS_BY_EVENT: Partial<Record<DriverEventDto['eventType'], TripStatus>> = {
  START: 'IN_PROGRESS',
  LOADED: 'IN_PROGRESS',
  FINISH: 'COMPLETED',
};

/** Thrown inside the per-event transaction so the event and the status move together. */
class TransitionConflict extends Error {}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly currency: CurrencyService,
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
      const target = STATUS_BY_EVENT[event.eventType];
      // A repeated START on an already running trip is a no-op, not an error:
      // the driver may press it twice, or LOADED may follow START.
      const movesTrip = target !== undefined && target !== trip.status;
      if (target !== undefined && movesTrip && !canTransition(trip.status, target)) {
        result.rejected.push({
          clientEventId: event.clientEventId,
          code: 'TRIP_INVALID_STATUS',
        });
        continue;
      }

      const photoUrls = await this.resolvePhotoKeys(actor, event);
      try {
        // Event row and status change land together, or neither lands.
        await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
          await tx.tripEvent.create({
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

          if (!movesTrip) return;

          // The expected status is part of the WHERE clause, so two devices
          // syncing the same trip cannot both apply the transition.
          const { count } = await tx.trip.updateMany({
            where: { id: trip.id, status: trip.status },
            data: { status: target, ...this.transitionData(target!, trip, event) },
          });
          if (count === 0) throw new TransitionConflict();

          if (target === 'COMPLETED') {
            // Same receivable the logist path creates; whichever gets there
            // first wins and the other finds the entry already present.
            // The invoice is the agreed price, which the transition never
            // touches — the pre-update row is the right source for it.
            await invoiceCompletedTrip(this.ledger, this.currency, tx, requireTenantActor(actor), trip);
          }

          await tx.auditLog.create({
            data: {
              companyId: actor.companyId,
              userId: actor.userId,
              action: 'STATUS_CHANGE',
              entityType: 'Trip',
              entityId: trip.id,
              before: { status: trip.status },
              after: { status: target, via: event.eventType },
            },
          });
        });
      } catch (error) {
        if (error instanceof TransitionConflict) {
          result.rejected.push({
            clientEventId: event.clientEventId,
            code: 'TRIP_INVALID_STATUS',
          });
          continue;
        }
        throw error;
      }

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

  /**
   * Trip fields the transition fills in from the event itself, so the times and
   * odometer readings come from the driver's phone rather than from whenever
   * the batch happened to reach the server.
   */
  private transitionData(
    target: TripStatus,
    trip: Trip,
    event: DriverEventDto,
  ): Prisma.TripUncheckedUpdateInput {
    const eventTime = new Date(event.eventTime);
    if (target === 'IN_PROGRESS') {
      return {
        startedAt: trip.startedAt ?? eventTime,
        startOdometer: trip.startOdometer ?? event.odometer,
      };
    }

    const endOdometer = event.odometer ?? trip.endOdometer;
    // A negative distance would poison fuel norms and cost-per-km; it is left
    // unset here and rejected outright in TASK-3.6.
    const distanceIsSane =
      endOdometer != null && trip.startOdometer != null && endOdometer >= trip.startOdometer;
    return {
      finishedAt: eventTime,
      endOdometer,
      actualDistanceKm: distanceIsSane
        ? new Prisma.Decimal(endOdometer - trip.startOdometer!)
        : undefined,
    };
  }

  /**
   * Events of ONE trip, paginated. A driver may only read their own trip:
   * event rows carry positions, comments and receipt photos, so an unrestricted
   * list would hand every driver their colleagues' whole day.
   */
  async listByTrip(
    actor: CurrentUserPayload,
    filter: ListEventsDto,
  ): Promise<{ data: TripEvent[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);

    const trip = await db.trip.findUnique({ where: { id: filter.tripId } });
    if (!trip) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    if (actor.role === UserRole.DRIVER) {
      const driver = await db.driver.findFirst({ where: { userId: actor.userId } });
      // Someone else's trip is indistinguishable from a missing one.
      if (!driver || trip.driverId !== driver.id) {
        throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
      }
    }

    const where = {
      tripId: filter.tripId,
      eventTime:
        filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
    };
    const [data, total] = await Promise.all([
      db.tripEvent.findMany({
        where,
        orderBy: { eventTime: 'asc' },
        skip: filter.skip,
        take: filter.limit,
      }),
      db.tripEvent.count({ where }),
    ]);
    return { data, total };
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
