import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Trip, type TripStatus } from '@prisma/client';
import { UserRole, type CurrentUserPayload, type TenantActor } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { assertOdometerOrder, odometerDistanceKm } from '../../common/odometer';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { assertNothingElseInProgress, busyIndexError } from '../../common/trip-availability';
import { requireTenantActor } from '../../common/tenant-actor';
import { assertTenantRefs } from '../../common/tenant-refs';
import { assertTripTransition, REASON_REQUIRED_STATUSES } from '../../common/trip-transitions';
import { PrismaService, type TenantScopedClient } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrencyService } from '../currency/currency.service';
import { LedgerService } from '../ledger/ledger.service';
import { invoiceCompletedTrip } from '../ledger/trip-invoicing';
import { nextTripNumber } from './trip-numbering';
import {
  AssignTripDto,
  CompleteTripDto,
  CreateTripDto,
  FinishTripDto,
  ListTripsDto,
  StartTripDto,
  UpdateTripDto,
} from './dto/trip.dto';

const EDITABLE_STATUSES: TripStatus[] = ['DRAFT', 'ASSIGNED'];

function toData(dto: CreateTripDto | UpdateTripDto) {
  const { agreedPrice, driverAdvance, loadingDate, unloadingDate, ...rest } = dto;
  return {
    ...rest,
    agreedPrice: agreedPrice === undefined ? undefined : BigInt(agreedPrice),
    driverAdvance: driverAdvance === undefined ? undefined : BigInt(driverAdvance),
    loadingDate: loadingDate === undefined ? undefined : new Date(loadingDate),
    unloadingDate: unloadingDate === undefined ? undefined : new Date(unloadingDate),
  };
}

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly currency: CurrencyService,
  ) {}

  async list(
    actor: CurrentUserPayload,
    filter: ListTripsDto,
  ): Promise<{ data: Trip[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.TripWhereInput = {
      status: filter.status,
      vehicleId: filter.vehicleId,
      driverId: filter.driverId,
      clientId: filter.clientId,
      createdAt: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
    };
    const [data, total] = await Promise.all([
      db.trip.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.limit,
        include: { client: true, vehicle: true, driver: true },
      }),
      db.trip.count({ where }),
    ]);
    return { data, total };
  }

  /** Driver app: the logged-in driver's active trips (resolved via their profile). */
  async listMine(actor: CurrentUserPayload): Promise<Trip[]> {
    const db = this.prisma.forCompany(actor.companyId);
    const driver = await db.driver.findFirst({
      where: { userId: actor.userId, isActive: true },
    });
    if (!driver) return [];
    return db.trip.findMany({
      where: { driverId: driver.id, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'desc' },
      include: { client: true, vehicle: true, trailer: true },
    });
  }

  async create(actor: CurrentUserPayload, dto: CreateTripDto): Promise<Trip> {
    await this.assertRefsExist(actor, dto);
    const status: TripStatus = dto.vehicleId && dto.driverId ? 'ASSIGNED' : 'DRAFT';

    try {
      // The number and the trip are taken in one transaction: the counter row
      // stays locked until the trip is written, so a second creator waits and
      // gets the next number rather than reading the same one.
      const trip = await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        const tripNumber = await nextTripNumber(tx, actor.companyId as string);
        return tx.trip.create({
          data: {
            ...toData(dto),
            companyId: actor.companyId as string,
            tripNumber,
            status,
            createdById: actor.userId,
          },
        });
      });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'Trip',
        entityId: trip.id,
        after: { tripNumber: trip.tripNumber, status: trip.status },
      });
      return trip;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async getById(actor: CurrentUserPayload, id: string): Promise<Trip> {
    const db = this.prisma.forCompany(actor.companyId);
    const trip = await db.trip.findUnique({
      where: { id },
      include: { client: true, vehicle: true, trailer: true, driver: true },
    });
    if (!trip) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    // A driver may open their own trip (the mobile app needs it), never anyone
    // else's — an unrelated trip is indistinguishable from a missing one.
    if (actor.role === UserRole.DRIVER) {
      const driver = await db.driver.findFirst({ where: { userId: actor.userId } });
      if (!driver || trip.driverId !== driver.id) {
        throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
      }
    }
    return trip;
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateTripDto): Promise<Trip> {
    const trip = await this.getById(actor, id);
    if (!EDITABLE_STATUSES.includes(trip.status)) {
      throw new AppException('TRIP_INVALID_STATUS', HttpStatus.CONFLICT);
    }
    await this.assertRefsExist(actor, dto);

    const { version, ...changes } = dto;
    try {
      // When the client tells us which version it was looking at, the write
      // only lands on that version — otherwise two people editing the same
      // trip silently overwrite each other, last-save-wins.
      const { count } = await this.prisma.forCompany(actor.companyId).trip.updateMany({
        where: { id, ...(version === undefined ? {} : { version }) },
        data: { ...toData(changes), version: { increment: 1 } },
      });
      if (count === 0) {
        throw new AppException('RESOURCE_CONFLICT', HttpStatus.CONFLICT, undefined, {
          expectedVersion: version,
          currentVersion: trip.version,
        });
      }
      return await this.getById(actor, id);
    } catch (error) {
      if (error instanceof AppException) throw error;
      rethrowPrismaError(error);
    }
  }

  async assign(actor: CurrentUserPayload, id: string, dto: AssignTripDto): Promise<Trip> {
    const trip = await this.getById(actor, id);
    assertTripTransition(trip.status, 'ASSIGNED', trip.status === 'ASSIGNED');
    await this.assertRefsExist(actor, dto);
    return this.transition(actor, trip, 'ASSIGNED', {
      vehicleId: dto.vehicleId,
      trailerId: dto.trailerId,
      driverId: dto.driverId,
    });
  }

  async start(actor: CurrentUserPayload, id: string, dto: StartTripDto): Promise<Trip> {
    const trip = await this.getById(actor, id);
    assertTripTransition(trip.status, 'IN_PROGRESS');
    return this.transition(actor, trip, 'IN_PROGRESS', {
      startedAt: new Date(),
      startOdometer: dto.startOdometer,
    });
  }

  async complete(actor: CurrentUserPayload, id: string, dto: CompleteTripDto): Promise<Trip> {
    const trip = await this.getById(actor, id);
    assertTripTransition(trip.status, 'COMPLETED');
    // A reading below the start one is a typo, and the subtraction it used to
    // produce made the fuel norm and the cost per km wrong without saying so.
    assertOdometerOrder(trip.startOdometer, dto.endOdometer);
    return this.transition(actor, trip, 'COMPLETED', {
      finishedAt: new Date(),
      endOdometer: dto.endOdometer,
      actualDistanceKm: odometerDistanceKm(trip.startOdometer, dto.endOdometer),
    });
  }

  async cancel(actor: CurrentUserPayload, id: string): Promise<Trip> {
    const trip = await this.getById(actor, id);
    assertTripTransition(trip.status, 'CANCELLED');
    return this.transition(actor, trip, 'CANCELLED', {});
  }

  /**
   * Ends a trip in an outcome other than plain success.
   *
   * Before this the only exit from IN_PROGRESS was COMPLETED, so a trip that
   * broke down or was refused had to be recorded as delivered — which invoiced
   * the client for work that never happened.
   */
  async finish(actor: CurrentUserPayload, id: string, dto: FinishTripDto): Promise<Trip> {
    const trip = await this.getById(actor, id);
    assertTripTransition(trip.status, dto.status);
    const endOdometer = dto.endOdometer ?? trip.endOdometer;
    assertOdometerOrder(trip.startOdometer, endOdometer);

    const data: Prisma.TripUncheckedUpdateInput = {
      finishedAt: new Date(),
      endOdometer,
      // A trip that ended badly still covered kilometres, and those are what
      // the fuel it burned has to be measured against.
      actualDistanceKm: odometerDistanceKm(trip.startOdometer, endOdometer),
    };
    if (dto.status === 'PARTIALLY_DELIVERED') {
      const delivered = BigInt(dto.deliveredAmount!);
      if (delivered <= 0n || delivered > trip.agreedPrice) {
        throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
          'deliveredAmount must be greater than zero and no more than the agreed price',
        ]);
      }
      data.deliveredAmount = delivered;
    }

    return this.transition(actor, trip, dto.status, data, dto.reason);
  }

  private async transition(
    actor: CurrentUserPayload,
    trip: Trip,
    status: TripStatus,
    data: Prisma.TripUncheckedUpdateInput,
    reason?: string,
  ): Promise<Trip> {
    const tenant = requireTenantActor(actor);
    if (REASON_REQUIRED_STATUSES.includes(status) && !reason && status !== 'CANCELLED') {
      throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
        `a reason is required when a trip ends as ${status}`,
      ]);
    }

    if (status === 'IN_PROGRESS') {
      // Named here so the logist reads "truck is on trip TR-2026-0041" rather
      // than the unique-index error that would otherwise reach them.
      await assertNothingElseInProgress(this.prisma.forCompany(tenant.companyId), trip);
    }

    const updated = await this.runTransition(tenant, trip, status, data, reason);
    this.audit.log({
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'STATUS_CHANGE',
      entityType: 'Trip',
      entityId: trip.id,
      before: { status: trip.status },
      after: { status },
    });
    return updated;
  }

  /**
   * What each outcome means for the money (docs/BUSINESS-RULES.md §4).
   *
   * COMPLETED            → the whole agreed price is invoiced
   * PARTIALLY_DELIVERED  → only the delivered part is invoiced
   * RETURNED / FAILED    → nothing is invoiced; the costs already recorded stay
   *                        as a loss, which is the honest picture
   * CANCELLED            → nothing is invoiced, and any advance paid to the
   *                        driver is written back so it is not silently lost
   */
  private async applyFinancialOutcome(
    tx: TenantScopedClient,
    tenant: TenantActor,
    trip: Trip,
    status: TripStatus,
  ): Promise<void> {
    if (status === 'COMPLETED') {
      await invoiceCompletedTrip(this.ledger, this.currency, tx, tenant, trip);
      return;
    }

    if (status === 'PARTIALLY_DELIVERED' && trip.deliveredAmount && trip.clientId) {
      await invoiceCompletedTrip(this.ledger, this.currency, tx, tenant, {
        ...trip,
        // Only what arrived is owed.
        agreedPrice: trip.deliveredAmount,
      });
      return;
    }

    if (status === 'CANCELLED' && trip.driverAdvance > 0n) {
      const converted = await this.currency.toBase(trip.driverAdvance, trip.currency);
      await this.ledger.record(tx, tenant, {
        driverId: trip.driverId,
        tripId: trip.id,
        direction: 'DEBIT',
        reason: 'DRIVER_ADVANCE',
        amount: trip.driverAdvance,
        currency: trip.currency,
        amountBase: converted.amountBase,
        reference: `advance to recover, trip ${trip.tripNumber}`,
      });
    }
  }

  /** Referenced vehicle/trailer/driver/client must exist within this tenant. */
  /**
   * The guarded write itself, separated so the availability check above reads
   * as a precondition rather than as part of the transaction.
   */
  private async runTransition(
    tenant: TenantActor,
    trip: Trip,
    status: TripStatus,
    data: Prisma.TripUncheckedUpdateInput,
    reason?: string,
  ): Promise<Trip> {
    try {
      // `await` inside the try on purpose: without it the rejection escapes the
      // catch below and the index error reaches the logist as a 500.
      return await this.prisma.forCompanyTx(tenant.companyId, async (tx) => {
        // The expected status is part of the WHERE clause, so of two parallel
        // completes exactly one matches a row. Checking first and updating after
        // let both through: finishedAt was overwritten, the distance
        // recalculated, and the client invoiced twice.
        const { count } = await tx.trip.updateMany({
          where: { id: trip.id, status: trip.status },
          data: {
            ...data,
            status,
            statusReason: reason ?? trip.statusReason,
            statusChangedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (count === 0) {
          throw new AppException('TRIP_INVALID_STATUS', HttpStatus.CONFLICT, undefined, {
            from: trip.status,
            to: status,
          });
        }

        const result = await tx.trip.findUniqueOrThrow({ where: { id: trip.id } });
        await this.applyFinancialOutcome(tx, tenant, result, status);
        return result;
      });
    } catch (error) {
      // Two starts arriving together both passed the check above; the partial
      // unique index is what actually decides, and its error has to arrive as
      // a sentence rather than as a 500.
      const busy = busyIndexError(error);
      if (busy) throw busy;
      throw error;
    }
  }

  private async assertRefsExist(
    actor: CurrentUserPayload,
    refs: { vehicleId?: string; trailerId?: string; driverId?: string; clientId?: string },
  ): Promise<void> {
    await assertTenantRefs(this.prisma.forCompany(actor.companyId), refs);
  }
}
