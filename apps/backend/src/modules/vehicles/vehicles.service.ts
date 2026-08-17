import { HttpStatus, Injectable } from '@nestjs/common';
import type { Vehicle } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, toAuditJson } from '../audit/audit.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        // companyId satisfies the type; the tenant extension enforces the same value.
        const vehicle = await tx.vehicle.create({
          data: { ...toData(dto), companyId: actor.companyId as string },
        });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'CREATE',
          entityType: 'Vehicle',
          entityId: vehicle.id,
          after: toAuditJson(vehicle),
        });
        return vehicle;
      });
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
    const before = await this.getById(actor, id);
    try {
      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        const vehicle = await tx.vehicle.update({ where: { id }, data: toData(dto) });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'UPDATE',
          entityType: 'Vehicle',
          entityId: id,
          before: toAuditJson(before),
          after: toAuditJson(vehicle),
        });
        return vehicle;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /** Soft delete — vehicles keep their trip/fuel history. */
  async deactivate(actor: CurrentUserPayload, id: string): Promise<Vehicle> {
    const before = await this.getById(actor, id);
    try {
      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        const vehicle = await tx.vehicle.update({ where: { id }, data: { isActive: false } });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'DEACTIVATE',
          entityType: 'Vehicle',
          entityId: id,
          before: toAuditJson(before),
          after: toAuditJson(vehicle),
        });
        return vehicle;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }
}
