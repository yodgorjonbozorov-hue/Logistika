import { HttpStatus, Injectable } from '@nestjs/common';
import type { Vehicle } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';

function toData<T extends UpdateVehicleDto>(dto: T) {
  const { insuranceExpiry, techInspectionExpiry, ...rest } = dto;
  return {
    ...rest,
    insuranceExpiry: insuranceExpiry === undefined ? undefined : new Date(insuranceExpiry),
    techInspectionExpiry:
      techInspectionExpiry === undefined ? undefined : new Date(techInspectionExpiry),
  };
}

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: CurrentUserPayload,
    pagination: PaginationDto,
  ): Promise<{ data: Vehicle[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const [data, total] = await Promise.all([
      db.vehicle.findMany({
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      db.vehicle.count(),
    ]);
    return { data, total };
  }

  async create(actor: CurrentUserPayload, dto: CreateVehicleDto): Promise<Vehicle> {
    try {
      // companyId satisfies the type; the tenant extension enforces the same value.
      return await this.prisma
        .forCompany(actor.companyId)
        .vehicle.create({ data: { ...toData(dto), companyId: actor.companyId as string } });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async getById(actor: CurrentUserPayload, id: string): Promise<Vehicle> {
    const vehicle = await this.prisma
      .forCompany(actor.companyId)
      .vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return vehicle;
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateVehicleDto): Promise<Vehicle> {
    try {
      return await this.prisma
        .forCompany(actor.companyId)
        .vehicle.update({ where: { id }, data: toData(dto) });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /** Soft delete — vehicles keep their trip/fuel history. */
  async deactivate(actor: CurrentUserPayload, id: string): Promise<Vehicle> {
    try {
      return await this.prisma
        .forCompany(actor.companyId)
        .vehicle.update({ where: { id }, data: { isActive: false } });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }
}
