import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Route } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { orderBy } from '../../common/dto/list-query.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRouteDto, ListRoutesDto, UpdateRouteDto } from './dto/route.dto';

/** Distance is DECIMAL(9,1); Prisma.Decimal keeps it exact where a float would not. */
function toData(dto: UpdateRouteDto) {
  const { plannedDistanceKm, ...rest } = dto;
  return {
    ...rest,
    plannedDistanceKm:
      plannedDistanceKm === undefined ? undefined : new Prisma.Decimal(plannedDistanceKm),
  };
}

@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: CurrentUserPayload,
    query: ListRoutesDto,
  ): Promise<{ data: Route[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.RouteWhereInput = {
      ...(query.onlyActive ? { isActive: true } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { originName: { contains: query.search, mode: 'insensitive' } },
              { destinationName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      db.route.findMany({
        where,
        orderBy: orderBy(query, ['name', 'createdAt'], 'name'),
        skip: query.skip,
        take: query.limit,
      }),
      db.route.count({ where }),
    ]);
    return { data, total };
  }

  async create(actor: CurrentUserPayload, dto: CreateRouteDto): Promise<Route> {
    try {
      const route = await this.prisma
        .forCompany(actor.companyId)
        .route.create({ data: { ...toData(dto), companyId: actor.companyId as string } as never });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'Route',
        entityId: route.id,
        after: { name: route.name, origin: route.originName, destination: route.destinationName },
      });
      return route;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async getById(actor: CurrentUserPayload, id: string): Promise<Route> {
    const route = await this.prisma.forCompany(actor.companyId).route.findUnique({ where: { id } });
    if (!route) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return route;
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateRouteDto): Promise<Route> {
    const before = await this.getById(actor, id);
    try {
      const route = await this.prisma
        .forCompany(actor.companyId)
        .route.update({ where: { id }, data: toData(dto) });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'UPDATE',
        entityType: 'Route',
        entityId: id,
        before: { name: before.name, isActive: before.isActive },
        after: { name: route.name, isActive: route.isActive },
      });
      return route;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /**
   * Soft delete. A hard delete would detach the route from historical trips and
   * silently rewrite every past report that grouped by it.
   */
  async deactivate(actor: CurrentUserPayload, id: string): Promise<Route> {
    try {
      const route = await this.prisma
        .forCompany(actor.companyId)
        .route.update({ where: { id }, data: { isActive: false } });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'DEACTIVATE',
        entityType: 'Route',
        entityId: id,
      });
      return route;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }
}
