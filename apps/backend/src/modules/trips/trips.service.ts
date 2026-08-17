import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Trip, type TripStatus } from '@prisma/client';
import { UserRole, type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { assertTenantRefs } from '../../common/tenant-refs';
import { assertTripTransition } from '../../common/trip-transitions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  AssignTripDto,
  CompleteTripDto,
  CreateTripDto,
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

    // Per-company sequential number; retry on the (companyId, tripNumber)
    // unique constraint in case two trips are opened at the same moment.
    for (let attempt = 0; ; attempt++) {
      const tripNumber = String(
        (await this.prisma.forCompany(actor.companyId).trip.count()) + 1 + attempt,
      );
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
        const isUniqueClash =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!isUniqueClash || attempt >= 3) rethrowPrismaError(error);
      }
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
    const actualDistanceKm =
      dto.endOdometer != null && trip.startOdometer != null
        ? new Prisma.Decimal(dto.endOdometer - trip.startOdometer)
        : undefined;
    return this.transition(actor, trip, 'COMPLETED', {
      finishedAt: new Date(),
      endOdometer: dto.endOdometer,
      actualDistanceKm,
    });
  }

  async cancel(actor: CurrentUserPayload, id: string): Promise<Trip> {
    const trip = await this.getById(actor, id);
    assertTripTransition(trip.status, 'CANCELLED');
    return this.transition(actor, trip, 'CANCELLED', {});
  }

  private async transition(
    actor: CurrentUserPayload,
    trip: Trip,
    status: TripStatus,
    data: Prisma.TripUncheckedUpdateInput,
  ): Promise<Trip> {
    const updated = await this.prisma
      .forCompany(actor.companyId)
      .trip.update({ where: { id: trip.id }, data: { ...data, status } });
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

  /** Referenced vehicle/trailer/driver/client must exist within this tenant. */
  private async assertRefsExist(
    actor: CurrentUserPayload,
    refs: { vehicleId?: string; trailerId?: string; driverId?: string; clientId?: string },
  ): Promise<void> {
    await assertTenantRefs(this.prisma.forCompany(actor.companyId), refs);
  }
}
