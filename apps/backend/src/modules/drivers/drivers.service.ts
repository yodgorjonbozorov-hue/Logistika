import { HttpStatus, Injectable } from '@nestjs/common';
import type { Driver } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateDriverDto, UpdateDriverDto } from './dto/driver.dto';

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
    pagination: PaginationDto,
  ): Promise<{ data: Driver[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const [data, total] = await Promise.all([
      db.driver.findMany({
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      db.driver.count(),
    ]);
    return { data, total };
  }

  async create(actor: CurrentUserPayload, dto: CreateDriverDto): Promise<Driver> {
    try {
      // companyId satisfies the type; the tenant extension enforces the same value.
      const created = await this.prisma
        .forCompany(actor.companyId)
        .driver.create({ data: { ...toData(dto), companyId: actor.companyId as string } });
      this.audit.record(actor, 'CREATE', 'Driver', created);
      return created;
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
    try {
      const before = await this.getById(actor, id);
      const updated = await this.prisma
        .forCompany(actor.companyId)
        .driver.update({ where: { id }, data: toData(dto) });
      this.audit.record(actor, 'UPDATE', 'Driver', updated, before);
      return updated;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /** Soft delete — drivers keep their trip history. */
  async deactivate(actor: CurrentUserPayload, id: string): Promise<Driver> {
    try {
      const deactivated = await this.prisma
        .forCompany(actor.companyId)
        .driver.update({ where: { id }, data: { isActive: false } });
      this.audit.record(actor, 'DELETE', 'Driver', deactivated);
      return deactivated;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }
}
