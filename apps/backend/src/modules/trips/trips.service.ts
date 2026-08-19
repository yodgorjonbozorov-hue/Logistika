import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Trip, type TripStatus } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DriversService } from '../drivers/drivers.service';
import {
  AssignTripDto,
  CompleteTripDto,
  CreateTripDto,
  ListTripsDto,
  StartTripDto,
  UpdateTripDto,
} from './dto/trip.dto';

/** Allowed lifecycle transitions (TZ §5 trips.status). */
const TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  DRAFT: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'DRAFT', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

const EDITABLE_STATUSES: TripStatus[] = ['DRAFT', 'ASSIGNED'];

/**
 * Column tuples of the partial unique indexes added by the hardening migration
 * (M-13). Prisma reports a P2002 by COLUMN LIST, not by index name, so this is
 * what has to be matched to tell "driver already busy" apart from a plain
 * duplicate trip number.
 */
const ACTIVE_TRIP_CONFLICT_COLUMNS = [
  ['company_id', 'driver_id'].join(),
  ['company_id', 'vehicle_id'].join(),
];

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
    private readonly drivers: DriversService,
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
    // Throws DRIVER_PROFILE_MISSING rather than returning [] — an unlinked
    // driver account is a provisioning bug, not "you have no trips" (C-1).
    const driver = await this.drivers.requireProfile(actor);
    return db.trip.findMany({
      where: { driverId: driver.id, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'desc' },
      include: { client: true, vehicle: true, trailer: true },
    });
  }

  /**
   * Per-trip P&L (M-9).
   *
   * The web used to fetch `/expenses?limit=100` and add the rows up in the
   * browser, so any trip with more than 100 transactions showed a WRONG
   * balance and nothing said so. The sum belongs in the database, where it is
   * exact and unbounded — and it stays in BigInt tiyin the whole way (CLAUDE.md:
   * never floats for money).
   */
  async finance(
    actor: CurrentUserPayload,
    tripId: string,
  ): Promise<{
    tripId: string;
    agreedPrice: string;
    expenseTotal: string;
    incomeTotal: string;
    balance: string;
    expenseCount: number;
    incomeCount: number;
  }> {
    const db = this.prisma.forCompany(actor.companyId);
    const trip = await db.trip.findUnique({
      where: { id: tripId },
      select: { id: true, agreedPrice: true },
    });
    if (!trip) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    const [expenses, incomes] = await Promise.all([
      db.expense.aggregate({ where: { tripId }, _sum: { amount: true }, _count: true }),
      db.income.aggregate({ where: { tripId }, _sum: { amount: true }, _count: true }),
    ]);

    const expenseTotal = expenses._sum.amount ?? 0n;
    const bookedIncome = incomes._sum.amount ?? 0n;
    // Nothing invoiced yet → fall back to the agreed price so the screen shows
    // the expected margin rather than a scary negative number.
    const incomeTotal = bookedIncome > 0n ? bookedIncome : trip.agreedPrice;

    return {
      tripId: trip.id,
      agreedPrice: trip.agreedPrice.toString(),
      expenseTotal: expenseTotal.toString(),
      incomeTotal: incomeTotal.toString(),
      balance: (incomeTotal - expenseTotal).toString(),
      expenseCount: expenses._count,
      incomeCount: incomes._count,
    };
  }

  async create(actor: CurrentUserPayload, dto: CreateTripDto): Promise<Trip> {
    await this.assertRefsExist(actor, dto);
    const status: TripStatus = dto.vehicleId && dto.driverId ? 'ASSIGNED' : 'DRAFT';
    const tripNumber = await this.nextTripNumber(actor.companyId as string);

    try {
      const trip = await this.prisma.forCompany(actor.companyId).trip.create({
        data: {
          ...toData(dto),
          companyId: actor.companyId as string,
          tripNumber,
          status,
          createdById: actor.userId,
        },
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
    const trip = await this.prisma.forCompany(actor.companyId).trip.findUnique({
      where: { id },
      include: { client: true, vehicle: true, trailer: true, driver: true },
    });
    if (!trip) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return trip;
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateTripDto): Promise<Trip> {
    const trip = await this.getById(actor, id);
    if (!EDITABLE_STATUSES.includes(trip.status)) {
      throw new AppException('TRIP_INVALID_STATUS', HttpStatus.CONFLICT);
    }
    await this.assertRefsExist(actor, dto);
    try {
      return await this.prisma
        .forCompany(actor.companyId)
        .trip.update({ where: { id }, data: toData(dto) });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async assign(actor: CurrentUserPayload, id: string, dto: AssignTripDto): Promise<Trip> {
    const trip = await this.getById(actor, id);
    this.assertTransition(trip.status, 'ASSIGNED', trip.status === 'ASSIGNED');
    await this.assertRefsExist(actor, dto);
    return this.transition(actor, trip, 'ASSIGNED', {
      vehicleId: dto.vehicleId,
      trailerId: dto.trailerId,
      driverId: dto.driverId,
    });
  }

  async start(actor: CurrentUserPayload, id: string, dto: StartTripDto): Promise<Trip> {
    const trip = await this.getById(actor, id);
    this.assertTransition(trip.status, 'IN_PROGRESS');
    return this.transition(actor, trip, 'IN_PROGRESS', {
      startedAt: new Date(),
      startOdometer: dto.startOdometer,
    });
  }

  async complete(actor: CurrentUserPayload, id: string, dto: CompleteTripDto): Promise<Trip> {
    const trip = await this.getById(actor, id);
    this.assertTransition(trip.status, 'COMPLETED');

    // H-4: a distance is only meaningful when the odometer moved forward.
    // Without this a typo produced a NEGATIVE actual_distance_km, which then
    // poisoned per-km salary, fuel-norm and profit calculations downstream.
    let actualDistanceKm: Prisma.Decimal | undefined;
    if (dto.endOdometer != null && trip.startOdometer != null) {
      if (dto.endOdometer < trip.startOdometer) {
        throw new AppException('ODOMETER_INVALID', HttpStatus.BAD_REQUEST, undefined, {
          startOdometer: trip.startOdometer,
          endOdometer: dto.endOdometer,
        });
      }
      actualDistanceKm = new Prisma.Decimal(dto.endOdometer - trip.startOdometer);
    }

    return this.transition(actor, trip, 'COMPLETED', {
      finishedAt: new Date(),
      endOdometer: dto.endOdometer,
      actualDistanceKm,
    });
  }

  async cancel(actor: CurrentUserPayload, id: string): Promise<Trip> {
    const trip = await this.getById(actor, id);
    this.assertTransition(trip.status, 'CANCELLED');
    return this.transition(actor, trip, 'CANCELLED', {});
  }

  private assertTransition(from: TripStatus, to: TripStatus, allowNoop = false): void {
    if (allowNoop && from === to) return;
    if (!TRANSITIONS[from].includes(to)) {
      throw new AppException('TRIP_INVALID_STATUS', HttpStatus.CONFLICT, undefined, {
        from,
        to,
      });
    }
  }

  /**
   * Applies a status change ATOMICALLY (H-5).
   *
   * The old read-then-write let two concurrent `complete` calls both observe
   * IN_PROGRESS and both write COMPLETED — duplicating finishedAt, the audit
   * entry and any downstream payroll effect. The status the caller observed is
   * now part of the WHERE clause, so exactly one writer can win and the loser
   * gets a 409 instead of a silent second completion.
   */
  private async transition(
    actor: CurrentUserPayload,
    trip: Trip,
    status: TripStatus,
    data: Prisma.TripUncheckedUpdateInput,
  ): Promise<Trip> {
    const updated = await this.prisma
      .forCompany(actor.companyId)
      .trip.updateManyAndReturn({
        where: { id: trip.id, status: trip.status },
        data: { ...data, status },
      })
      .catch((error: unknown) => this.rethrowActiveTripClash(error));

    if (updated.length === 0) {
      // Somebody else moved the trip between our read and our write.
      throw new AppException('CONFLICT', HttpStatus.CONFLICT, undefined, {
        expectedStatus: trip.status,
      });
    }

    this.audit.log({
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'STATUS_CHANGE',
      entityType: 'Trip',
      entityId: trip.id,
      before: { status: trip.status },
      after: { status },
    });
    return updated[0]!;
  }

  /**
   * Allocates the next per-company trip number (H-6).
   *
   * `count() + 1` was both a full-table scan and a race: two trips opened in
   * the same second got the same number, collided on the unique index and were
   * retried up to four times. A single atomic UPDATE ... RETURNING on the
   * tenant's counter row is O(1) and collision-free — PostgreSQL serialises
   * concurrent updates of the same row for us.
   */
  private async nextTripNumber(companyId: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ next_trip_number: number }>>`
      UPDATE companies
      SET next_trip_number = next_trip_number + 1
      WHERE id = ${companyId}
      RETURNING next_trip_number - 1 AS next_trip_number
    `;
    const allocated = rows[0]?.next_trip_number;
    if (allocated === undefined) {
      throw new AppException('TENANT_MISSING', HttpStatus.FORBIDDEN);
    }
    return String(allocated);
  }

  /**
   * M-13: the partial unique indexes let PostgreSQL — not a racy pre-check —
   * decide that a driver or vehicle is already on an in-progress trip.
   */
  private rethrowActiveTripClash(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target)
        ? (error.meta.target as string[]).join()
        : String(error.meta?.target ?? '');
      if (ACTIVE_TRIP_CONFLICT_COLUMNS.includes(target)) {
        throw new AppException('RESOURCE_BUSY', HttpStatus.CONFLICT, undefined, { target });
      }
    }
    rethrowPrismaError(error);
  }

  /**
   * Referenced vehicle/trailer/driver/client must exist WITHIN this tenant —
   * the tenant-scoped lookup makes cross-company ids indistinguishable from
   * missing ones (isolation requirement).
   */
  private async assertRefsExist(
    actor: CurrentUserPayload,
    refs: { vehicleId?: string; trailerId?: string; driverId?: string; clientId?: string },
  ): Promise<void> {
    const db = this.prisma.forCompany(actor.companyId);
    const checks: Array<[string | undefined, () => Promise<unknown | null>]> = [
      [refs.vehicleId, () => db.vehicle.findUnique({ where: { id: refs.vehicleId! } })],
      [refs.trailerId, () => db.vehicle.findUnique({ where: { id: refs.trailerId! } })],
      [refs.driverId, () => db.driver.findUnique({ where: { id: refs.driverId! } })],
      [refs.clientId, () => db.client.findUnique({ where: { id: refs.clientId! } })],
    ];
    for (const [id, lookup] of checks) {
      if (id && !(await lookup())) {
        throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, undefined, { id });
      }
    }
  }
}
