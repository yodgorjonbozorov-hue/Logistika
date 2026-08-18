import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Driver, type Trip, type TripEvent, type TripStatus } from '@prisma/client';
import { UserRole, type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { isOdometerOrderValid, odometerDistanceKm } from '../../common/odometer';
import { requireTenantActor } from '../../common/tenant-actor';
import { busyIndexError, inProgressElsewhere } from '../../common/trip-availability';
import { canTransition } from '../../common/trip-transitions';
import { PrismaService, type TenantScopedClient } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrencyService } from '../currency/currency.service';
import { LedgerService } from '../ledger/ledger.service';
import { invoiceCompletedTrip } from '../ledger/trip-invoicing';
import { DriverEventDto, EventBatchDto, ListEventsDto } from './dto/event.dto';
import { readPage, type Page } from '../../common/dto/pagination.dto';

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

/**
 * True when the insert lost the race for a client event id.
 *
 * Narrow on purpose: any other unique violation is a real bug and must keep
 * surfacing rather than being quietly reported to the driver as "already sent".
 */
function isDuplicateEventId(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = (error.meta as { target?: string[] | string } | undefined)?.target;
  const fields = Array.isArray(target) ? target : [target ?? ''];
  return fields.some((field) => field.includes('client_event_id'));
}

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

    // A cheap first pass, not the guarantee. It skips the work for ids already
    // stored by an earlier batch; the unique index below is what actually
    // decides, because two batches arriving together both read "not seen".
    const ids = dto.events.map((e) => e.clientEventId);
    const existing = await db.tripEvent.findMany({
      where: { clientEventId: { in: ids } },
      select: { clientEventId: true },
    });
    const seen = new Set(existing.map((e) => e.clientEventId));

    // The trips and the receipt files this batch refers to, read once each
    // (TASK-4.2). Both used to be looked up inside the loop, so a hundred
    // events was a hundred round trips before any of them was stored.
    const trips = await this.loadTrips(db, dto);
    const knownFiles = await this.loadPhotoFileIds(db, dto);

    for (const event of dto.events) {
      if (seen.has(event.clientEventId)) {
        result.duplicates.push(event.clientEventId);
        continue;
      }
      // Trip must exist in this tenant and belong to this driver. The map is
      // kept up to date as transitions land, so a LOADED following a START in
      // the same batch sees the status that START just wrote.
      const trip = trips.get(event.tripId);
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
      // A finish whose reading is below the start one is a mistyped digit. It
      // used to be stored with the distance quietly left unset, so the trip
      // looked complete and dropped out of every per-km report. Rejecting it
      // puts the event in the driver's "needs attention" list instead.
      if (
        target === 'COMPLETED' &&
        !isOdometerOrderValid(trip.startOdometer, event.odometer ?? trip.endOdometer)
      ) {
        result.rejected.push({
          clientEventId: event.clientEventId,
          code: 'ODOMETER_INVALID',
        });
        continue;
      }

      // The truck cannot be on two trips at once. Named here so the driver is
      // told which trip is in the way instead of getting a failed batch.
      if (movesTrip && target === 'IN_PROGRESS') {
        const busy = await inProgressElsewhere(db, trip);
        if (busy) {
          result.rejected.push({ clientEventId: event.clientEventId, code: busy.code });
          continue;
        }
      }

      // A receipt id that is not this tenant's is a rejected event, not an
      // event stored without its receipt: the photo is the proof.
      const photoFileIds = event.photoFileIds?.length ? event.photoFileIds : undefined;
      if (photoFileIds?.some((id) => !knownFiles.has(id))) {
        result.rejected.push({ clientEventId: event.clientEventId, code: 'NOT_FOUND' });
        continue;
      }
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
              photoFileIds,
              clientEventId: event.clientEventId,
            },
          });

          if (!movesTrip) return;

          // The expected status is part of the WHERE clause, so two devices
          // syncing the same trip cannot both apply the transition.
          const { count } = await tx.trip.updateMany({
            where: { id: trip.id, status: trip.status },
            data: {
              status: target,
              ...this.transitionData(target!, trip, event),
              // Same lock the logist path bumps: a page holding this trip has
              // to find out the driver moved it (TASK-3.5).
              version: { increment: 1 },
            },
          });
          if (count === 0) throw new TransitionConflict();

          if (target === 'COMPLETED') {
            // Same receivable the logist path creates; whichever gets there
            // first wins and the other finds the entry already present.
            // The invoice is the agreed price, which the transition never
            // touches — the pre-update row is the right source for it.
            await invoiceCompletedTrip(
              this.ledger,
              this.currency,
              tx,
              requireTenantActor(actor),
              trip,
            );
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
        // The other batch won the race and stored this id first. That is what
        // a duplicate *is* — reporting it as one lets the phone mark the event
        // sent, where the unhandled error used to fail the whole batch and
        // send the app around the same retry forever.
        if (isDuplicateEventId(error)) {
          result.duplicates.push(event.clientEventId);
          continue;
        }
        // Two devices starting the same driver's trips together: the partial
        // unique index decides, and the loser is a rejection, not a 500.
        const busy = busyIndexError(error);
        if (busy) {
          result.rejected.push({ clientEventId: event.clientEventId, code: busy.code });
          continue;
        }
        throw error;
      }

      seen.add(event.clientEventId);
      result.accepted.push(event.clientEventId);
      if (movesTrip) {
        // The row moved; the next event for this trip must see the new status
        // rather than the one this batch started with.
        trips.set(trip.id, {
          ...trip,
          status: target!,
          ...this.transitionData(target!, trip, event),
        } as Trip);
      }
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
    return {
      finishedAt: eventTime,
      endOdometer,
      actualDistanceKm: odometerDistanceKm(trip.startOdometer, endOdometer),
    };
  }

  /**
   * Events of ONE trip, paginated. A driver may only read their own trip:
   * event rows carry positions, comments and receipt photos, so an unrestricted
   * list would hand every driver their colleagues' whole day.
   */
  async listByTrip(actor: CurrentUserPayload, filter: ListEventsDto): Promise<Page<TripEvent>> {
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
      eventTime: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
    };
    return readPage(
      filter,
      (page) =>
        db.tripEvent.findMany({
          where,
          orderBy: { eventTime: 'asc' },
          ...page,
        }),
      () => db.tripEvent.count({ where }),
    );
  }

  /** Photo file ids → stored keys; foreign/unknown ids are dropped silently-safe (tenant scope). */
  /**
   * Every trip this batch refers to, in one query (TASK-4.2).
   *
   * Read through the tenant-scoped client, so a trip id from another company
   * is simply absent — indistinguishable from one that does not exist.
   */
  private async loadTrips(db: TenantScopedClient, dto: EventBatchDto): Promise<Map<string, Trip>> {
    const ids = [...new Set(dto.events.map((e) => e.tripId))];
    const trips = await db.trip.findMany({ where: { id: { in: ids } } });
    return new Map(trips.map((trip) => [trip.id, trip]));
  }

  /**
   * The StoredFile ids in this batch that really belong to this tenant.
   *
   * The column this feeds was called `photo_urls` and has only ever held ids
   * (M-4). An id that is not in this set means the event refers to a file from
   * somewhere else, and storing the event without its receipt loses the proof.
   */
  private async loadPhotoFileIds(db: TenantScopedClient, dto: EventBatchDto): Promise<Set<string>> {
    const ids = [...new Set(dto.events.flatMap((e) => e.photoFileIds ?? []))];
    if (ids.length === 0) return new Set();
    const files = await db.storedFile.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return new Set(files.map((f) => f.id));
  }
}
