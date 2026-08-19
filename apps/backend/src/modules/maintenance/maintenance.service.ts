import { HttpStatus, Injectable } from '@nestjs/common';
import type { Maintenance, Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateMaintenanceDto,
  ListMaintenanceDto,
  UpdateMaintenanceDto,
} from './dto/maintenance.dto';

function toMaintenanceData(dto: CreateMaintenanceDto | UpdateMaintenanceDto) {
  const { cost, serviceDate, ...rest } = dto;
  return {
    ...rest,
    cost: cost === undefined ? undefined : BigInt(cost),
    serviceDate: serviceDate === undefined ? undefined : new Date(serviceDate),
  };
}

/**
 * Service history and the next service plan (TZ §4.1 W-5). Recording a service
 * also moves the vehicle's own `nextServiceOdometer`, because that single field
 * is what the alert centre reads — two places holding the same plan would drift.
 */
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: CurrentUserPayload,
    filter: ListMaintenanceDto,
  ): Promise<{ data: Maintenance[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.MaintenanceWhereInput = { vehicleId: filter.vehicleId };
    const [data, total] = await Promise.all([
      db.maintenance.findMany({
        where,
        orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }],
        skip: filter.skip,
        take: filter.limit,
        include: { vehicle: { select: { plateNumber: true } } },
      }),
      db.maintenance.count({ where }),
    ]);
    return { data, total };
  }

  async create(actor: CurrentUserPayload, dto: CreateMaintenanceDto): Promise<Maintenance> {
    const db = this.prisma.forCompany(actor.companyId);
    try {
      const record = await db.maintenance.create({
        data: toMaintenanceData(dto) as Prisma.MaintenanceUncheckedCreateInput,
      });
      if (dto.nextServiceOdometer !== undefined) {
        await db.vehicle.update({
          where: { id: dto.vehicleId },
          data: { nextServiceOdometer: dto.nextServiceOdometer },
        });
      }
      this.audit.log({
        companyId: actor.companyId!,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'Maintenance',
        entityId: record.id,
        after: { type: record.type, odometer: record.odometer, cost: record.cost?.toString() },
      });
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
    const db = this.prisma.forCompany(actor.companyId);
    const before = await db.maintenance.findUnique({ where: { id } });
    if (!before) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    try {
      const updated = await db.maintenance.update({
        where: { id },
        data: toMaintenanceData(dto) as Prisma.MaintenanceUncheckedUpdateInput,
      });
      if (dto.nextServiceOdometer !== undefined) {
        await db.vehicle.update({
          where: { id: updated.vehicleId },
          data: { nextServiceOdometer: dto.nextServiceOdometer },
        });
      }
      return updated;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async remove(actor: CurrentUserPayload, id: string): Promise<{ id: string }> {
    const db = this.prisma.forCompany(actor.companyId);
    const existing = await db.maintenance.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    await db.maintenance.delete({ where: { id } });
    this.audit.log({
      companyId: actor.companyId!,
      userId: actor.userId,
      action: 'DELETE',
      entityType: 'Maintenance',
      entityId: id,
    });
    return { id };
  }
}
