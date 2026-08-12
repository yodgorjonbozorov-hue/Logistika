import { HttpStatus, Injectable } from '@nestjs/common';
import type { Maintenance, Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateMaintenanceDto,
  ListMaintenanceDto,
  UpdateMaintenanceDto,
} from './dto/maintenance.dto';

/** A vehicle is "due" when within this many km of its next service point. */
export const SERVICE_DUE_WITHIN_KM = 1000;

export interface UpcomingService {
  vehicleId: string;
  plateNumber: string;
  currentOdometer: number | null;
  nextServiceOdometer: number | null;
  /** Km left to the service point; negative = overdue. */
  kmRemaining: number | null;
}

function toData(dto: CreateMaintenanceDto | UpdateMaintenanceDto) {
  const { cost, serviceDate, partsList, ...rest } = dto;
  return {
    ...rest,
    cost: cost === undefined ? undefined : BigInt(cost),
    serviceDate: serviceDate === undefined ? undefined : new Date(serviceDate),
    partsList: partsList === undefined ? undefined : partsList,
  };
}

@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: CurrentUserPayload,
    filter: ListMaintenanceDto,
  ): Promise<{ data: Maintenance[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.MaintenanceWhereInput = { vehicleId: filter.vehicleId };
    const [data, total] = await Promise.all([
      db.maintenance.findMany({
        where,
        orderBy: { serviceDate: 'desc' },
        skip: filter.skip,
        take: filter.limit,
      }),
      db.maintenance.count({ where }),
    ]);
    return { data, total };
  }

  async create(actor: CurrentUserPayload, dto: CreateMaintenanceDto): Promise<Maintenance> {
    const db = this.prisma.forCompany(actor.companyId);
    const vehicle = await db.vehicle.findUnique({ where: { id: dto.vehicleId } });
    if (!vehicle) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    try {
      const record = await db.maintenance.create({
        data: toData(dto) as Prisma.MaintenanceUncheckedCreateInput,
      });
      // The service visit updates the vehicle card: fresh odometer + next TO plan.
      const vehiclePatch: Prisma.VehicleUpdateInput = {};
      if (dto.nextServiceOdometer != null) {
        vehiclePatch.nextServiceOdometer = dto.nextServiceOdometer;
      }
      if (dto.odometer != null && (vehicle.currentOdometer ?? 0) < dto.odometer) {
        vehiclePatch.currentOdometer = dto.odometer;
      }
      if (Object.keys(vehiclePatch).length > 0) {
        await db.vehicle.update({ where: { id: vehicle.id }, data: vehiclePatch });
      }
      return record;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async update(
    actor: CurrentUserPayload,
    id: string,
    dto: UpdateMaintenanceDto,
  ): Promise<Maintenance> {
    try {
      return await this.prisma
        .forCompany(actor.companyId)
        .maintenance.update({ where: { id }, data: toData(dto) });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /** W-5/W-10: vehicles at or near their next service point. */
  async upcoming(actor: CurrentUserPayload): Promise<UpcomingService[]> {
    const vehicles = await this.prisma.forCompany(actor.companyId).vehicle.findMany({
      where: { isActive: true, nextServiceOdometer: { not: null } },
    });
    return vehicles
      .map((vehicle) => ({
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        currentOdometer: vehicle.currentOdometer,
        nextServiceOdometer: vehicle.nextServiceOdometer,
        kmRemaining:
          vehicle.currentOdometer == null || vehicle.nextServiceOdometer == null
            ? null
            : vehicle.nextServiceOdometer - vehicle.currentOdometer,
      }))
      .filter((row) => row.kmRemaining != null && row.kmRemaining <= SERVICE_DUE_WITHIN_KM)
      .sort((a, b) => (a.kmRemaining ?? 0) - (b.kmRemaining ?? 0));
  }
}
