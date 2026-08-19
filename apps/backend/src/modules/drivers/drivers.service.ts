import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Driver } from '@prisma/client';
import { UserRole, type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { ListQueryDto, orderBy } from '../../common/dto/list-query.dto';
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
    query: ListQueryDto,
  ): Promise<{ data: Driver[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.DriverWhereInput = query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search } },
            { licenseNumber: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [data, total] = await Promise.all([
      db.driver.findMany({
        where,
        orderBy: orderBy(query, ['fullName', 'createdAt', 'licenseExpiry', 'hireDate'], 'createdAt'),
        skip: query.skip,
        take: query.limit,
      }),
      db.driver.count({ where }),
    ]);
    return { data, total };
  }

  async create(actor: CurrentUserPayload, dto: CreateDriverDto): Promise<Driver> {
    await this.assertLinkableUser(actor, dto.userId);
    try {
      // companyId satisfies the type; the tenant extension enforces the same value.
      const driver = await this.prisma
        .forCompany(actor.companyId)
        .driver.create({ data: { ...toData(dto), companyId: actor.companyId as string } });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'Driver',
        entityId: driver.id,
        after: { fullName: driver.fullName, userId: driver.userId },
      });
      return driver;
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
    const before = await this.getById(actor, id);
    if (dto.userId !== undefined && dto.userId !== null) {
      await this.assertLinkableUser(actor, dto.userId, id);
    }
    try {
      const driver = await this.prisma
        .forCompany(actor.companyId)
        .driver.update({ where: { id }, data: toData(dto) });
      if (dto.userId !== undefined && dto.userId !== before.userId) {
        this.audit.log({
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'LINK_USER',
          entityType: 'Driver',
          entityId: id,
          before: { userId: before.userId },
          after: { userId: driver.userId },
        });
      }
      return driver;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /** Soft delete — drivers keep their trip history. */
  async deactivate(actor: CurrentUserPayload, id: string): Promise<Driver> {
    try {
      return await this.prisma
        .forCompany(actor.companyId)
        .driver.update({ where: { id }, data: { isActive: false } });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /**
   * The driver profile behind the logged-in DRIVER account.
   *
   * `/trips/my`, `/events/batch` and `/tracking/positions` all hang off this
   * lookup, so it lives in one place and fails with a code the driver app can
   * actually explain to the user instead of a bare 404 (C-1).
   */
  async requireProfile(actor: CurrentUserPayload): Promise<Driver> {
    const driver = await this.prisma
      .forCompany(actor.companyId)
      .driver.findFirst({ where: { userId: actor.userId, isActive: true } });
    if (!driver) throw new AppException('DRIVER_PROFILE_MISSING', HttpStatus.FORBIDDEN);
    return driver;
  }

  /**
   * A driver profile may only point at a login account that
   *   1. exists inside THIS tenant (the scoped lookup makes a foreign id
   *      indistinguishable from a missing one),
   *   2. actually has the DRIVER role — otherwise linking an OWNER account
   *      would silently hand that account the driver-only endpoints, and
   *   3. is not already claimed by another driver profile (the DB unique index
   *      is the final guard; this check turns the race into a clean 409).
   */
  private async assertLinkableUser(
    actor: CurrentUserPayload,
    userId: string | null | undefined,
    selfDriverId?: string,
  ): Promise<void> {
    if (!userId) return;
    const db = this.prisma.forCompany(actor.companyId);

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, undefined, { userId });
    }
    if (user.role !== UserRole.DRIVER) {
      throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
        'userId must reference a user with role DRIVER',
      ]);
    }

    const claimed = await db.driver.findFirst({ where: { userId } });
    if (claimed && claimed.id !== selfDriverId) {
      throw new AppException('ALREADY_EXISTS', HttpStatus.CONFLICT, undefined, {
        fields: ['userId'],
      });
    }
  }
}
