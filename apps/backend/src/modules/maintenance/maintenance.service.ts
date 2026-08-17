import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Maintenance, Prisma } from '@prisma/client';
import { AlertType, type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService, type AlertInput } from '../alerts/alerts.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateMaintenanceDto,
  ListMaintenanceDto,
  UpdateMaintenanceDto,
} from './dto/maintenance.dto';

/** How early a service becomes «due» (TZ W-5: «keyingi TO qachonligi»). */
export const SERVICE_WARNING_KM = 1000;

export interface ServiceDue {
  vehicleId: string;
  plateNumber: string;
  currentOdometer: number;
  nextServiceOdometer: number;
  /** Negative once the service is overdue. */
  kmLeft: number;
  isOverdue: boolean;
  lastServiceDate: Date | null;
}

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: CurrentUserPayload,
    filter: ListMaintenanceDto,
  ): Promise<{ data: Maintenance[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.MaintenanceWhereInput = {
      vehicleId: filter.vehicleId,
      type: filter.type,
    };
    const [data, total] = await Promise.all([
      db.maintenance.findMany({
        where,
        orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }],
        skip: filter.skip,
        take: filter.limit,
      }),
      db.maintenance.count({ where }),
    ]);
    return { data, total };
  }

  /**
   * Records a service. When it carries the next-service odometer, the vehicle
   * card is moved along with it — the W-5 «next TO» field has one source.
   */
  async create(actor: CurrentUserPayload, dto: CreateMaintenanceDto): Promise<Maintenance> {
    const db = this.prisma.forCompany(actor.companyId);
    const vehicle = await db.vehicle.findUnique({ where: { id: dto.vehicleId } });
    if (!vehicle) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    try {
      const created = await db.maintenance.create({
        data: toMaintenanceData(dto) as Prisma.MaintenanceUncheckedCreateInput,
      });
      const odometerUpdate: Prisma.VehicleUpdateInput = {};
      if (dto.nextServiceOdometer !== undefined) {
        odometerUpdate.nextServiceOdometer = dto.nextServiceOdometer;
      }
      if (dto.odometer !== undefined && dto.odometer > (vehicle.currentOdometer ?? 0)) {
        odometerUpdate.currentOdometer = dto.odometer;
      }
      if (Object.keys(odometerUpdate).length > 0) {
        await db.vehicle.update({ where: { id: dto.vehicleId }, data: odometerUpdate });
      }
      this.audit.record(actor, 'CREATE', 'Maintenance', created);
      return created;
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
    const existing = await db.maintenance.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    try {
      const updated = await db.maintenance.update({ where: { id }, data: toMaintenanceData(dto) });
      this.audit.record(actor, 'UPDATE', 'Maintenance', updated, existing);
      return updated;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async remove(actor: CurrentUserPayload, id: string): Promise<{ deleted: boolean }> {
    const db = this.prisma.forCompany(actor.companyId);
    const existing = await db.maintenance.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    await db.maintenance.delete({ where: { id } });
    this.audit.record(actor, 'DELETE', 'Maintenance', existing);
    return { deleted: true };
  }

  /** Vehicles within 1 000 km of their next service, overdue ones first. */
  async due(actor: CurrentUserPayload): Promise<ServiceDue[]> {
    const db = this.prisma.forCompany(actor.companyId);
    const vehicles = await db.vehicle.findMany({
      where: {
        isActive: true,
        nextServiceOdometer: { not: null },
        currentOdometer: { not: null },
      },
      select: {
        id: true,
        plateNumber: true,
        currentOdometer: true,
        nextServiceOdometer: true,
        maintenances: {
          where: { serviceDate: { not: null } },
          orderBy: { serviceDate: 'desc' },
          take: 1,
          select: { serviceDate: true },
        },
      },
    });

    return vehicles
      .map((vehicle) => {
        const currentOdometer = vehicle.currentOdometer as number;
        const nextServiceOdometer = vehicle.nextServiceOdometer as number;
        const kmLeft = nextServiceOdometer - currentOdometer;
        return {
          vehicleId: vehicle.id,
          plateNumber: vehicle.plateNumber,
          currentOdometer,
          nextServiceOdometer,
          kmLeft,
          isOverdue: kmLeft < 0,
          lastServiceDate: vehicle.maintenances[0]?.serviceDate ?? null,
        };
      })
      .filter((row) => row.kmLeft <= SERVICE_WARNING_KM)
      .sort((a, b) => a.kmLeft - b.kmLeft);
  }

  /** Raises MAINTENANCE_DUE alerts for vehicles at or past their service point. */
  async checkDue(companyId: string): Promise<number> {
    const actor = { userId: null, companyId, role: 'OWNER' } as unknown as CurrentUserPayload;
    const rows = await this.due(actor);
    const alerts: AlertInput[] = rows.map((row) => ({
      type: AlertType.MAINTENANCE_DUE,
      titleKey: row.isOverdue ? 'alerts.serviceOverdue.title' : 'alerts.serviceDue.title',
      messageKey: row.isOverdue ? 'alerts.serviceOverdue.message' : 'alerts.serviceDue.message',
      params: {
        plate: row.plateNumber,
        km: Math.abs(row.kmLeft),
        odometer: row.nextServiceOdometer,
      },
      relatedType: 'Vehicle',
      relatedId: row.vehicleId,
      // «500 km left» and «overdue» are different news about the same vehicle.
      dedupeParam: 'km',
    }));
    return this.alerts.raiseMany(companyId, alerts);
  }

  /** Daily service watch (TZ W-10 «TO vaqti keldi»). */
  @Cron('0 5 * * *')
  async checkAllCompanies(): Promise<void> {
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const company of companies) {
      try {
        const raised = await this.checkDue(company.id);
        if (raised > 0) this.logger.log(`Service alerts raised: ${raised} (${company.id})`);
      } catch (error) {
        this.logger.error(
          `Service check failed for ${company.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

function toMaintenanceData(dto: CreateMaintenanceDto | UpdateMaintenanceDto) {
  const { cost, serviceDate, ...rest } = dto;
  return {
    ...rest,
    cost: cost === undefined ? undefined : BigInt(cost),
    serviceDate: serviceDate === undefined ? undefined : new Date(serviceDate),
  };
}
