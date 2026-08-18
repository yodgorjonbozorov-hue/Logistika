import { HttpStatus, Injectable } from '@nestjs/common';
import type { Driver } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { CatalogueListDto } from '../../common/dto/catalogue.dto';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, toAuditJson } from '../audit/audit.service';
import { CreateDriverDto, UpdateDriverDto } from './dto/driver.dto';
import { ACTIVE_TRIP_STATUSES } from '../../common/trip-transitions';

function toData<T extends UpdateDriverDto>(dto: T) {
  const { salaryValue, birthDate, licenseExpiry, hireDate, ...rest } = dto;
  return {
    ...rest,
    salaryValue: salaryValue === undefined ? undefined : BigInt(salaryValue),
    birthDate: birthDate === undefined ? undefined : new Date(birthDate),
    licenseExpiry: licenseExpiry === undefined ? undefined : new Date(licenseExpiry),
    hireDate: hireDate === undefined ? undefined : new Date(hireDate),
  };
}

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: CurrentUserPayload,
    pagination: CatalogueListDto,
  ): Promise<{ data: Driver[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    // Retired records leave the working list but stay reachable with
    // ?includeInactive=true — the history is the reason they were kept.
    const where = { isActive: pagination.activeFilter };
    const [data, total] = await Promise.all([
      db.driver.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      db.driver.count({ where }),
    ]);
    return { data, total };
  }

  async create(actor: CurrentUserPayload, dto: CreateDriverDto): Promise<Driver> {
    try {
      // The row and its audit entry are written together: an unrecorded change
      // to a salary is exactly the case this log exists for.
      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        // companyId satisfies the type; the tenant extension enforces the same value.
        const driver = await tx.driver.create({
          data: { ...toData(dto), companyId: actor.companyId as string },
        });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'CREATE',
          entityType: 'Driver',
          entityId: driver.id,
          after: toAuditJson(driver),
        });
        return driver;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async getById(actor: CurrentUserPayload, id: string): Promise<Driver> {
    const driver = await this.prisma
      .forCompany(actor.companyId)
      .driver.findUnique({ where: { id } });
    if (!driver) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return driver;
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateDriverDto): Promise<Driver> {
    // salaryValue lives on this row: "who changed 5,000,000 to 500,000?" needs
    // the before-state, which only exists if it is read first.
    const before = await this.getById(actor, id);
    try {
      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        const driver = await tx.driver.update({ where: { id }, data: toData(dto) });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'UPDATE',
          entityType: 'Driver',
          entityId: id,
          before: toAuditJson(before),
          after: toAuditJson(driver),
        });
        return driver;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /** Soft delete — drivers keep their trip history. */
  async deactivate(actor: CurrentUserPayload, id: string): Promise<Driver> {
    const before = await this.getById(actor, id);
    await this.assertNotOnDuty(actor, id);
    try {
      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        const driver = await tx.driver.update({ where: { id }, data: { isActive: false } });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'DEACTIVATE',
          entityType: 'Driver',
          entityId: id,
          before: toAuditJson(before),
          after: toAuditJson(driver),
        });
        return driver;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /**
   * Refuses to retire something that is still out on a trip (TASK-3.10).
   *
   * A driver halfway to Bukhara stops being able to send anything at all:
   * `listMine` and `requireDriverProfile` both filter on `isActive`, so the
   * phone shows no trip and every event is refused. The receipts and the
   * delivery proof for the rest of that run are simply never recorded.
   *
   * Planned trips count too: an ASSIGNED trip whose driver has been
   * deactivated is a trip that can never start, and nothing would have said so
   * until the morning it was due.
   */
  private async assertNotOnDuty(actor: CurrentUserPayload, id: string): Promise<void> {
    const active = await this.prisma.forCompany(actor.companyId).trip.findFirst({
      where: { driverId: id, status: { in: ACTIVE_TRIP_STATUSES } },
      select: { id: true, tripNumber: true, status: true },
    });
    if (!active) return;
    throw new AppException('RESOURCE_IN_USE', HttpStatus.CONFLICT, undefined, {
      tripId: active.id,
      tripNumber: active.tripNumber,
      status: active.status,
    });
  }
}
