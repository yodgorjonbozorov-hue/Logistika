import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type FuelLog } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { decimalStringToInt, divRound } from '../finance/finance.math';
import { CreateFuelLogDto, ListFuelLogsDto, UpdateFuelLogDto } from './dto/fuel-log.dto';

/** Audit snapshot — BigInt and Decimal are not JSON-serialisable. */
function snapshot(log: FuelLog): Prisma.InputJsonValue {
  return {
    vehicleId: log.vehicleId,
    tripId: log.tripId,
    driverId: log.driverId,
    liters: log.liters.toFixed(2),
    pricePerLiter: log.pricePerLiter?.toString() ?? null,
    totalAmount: log.totalAmount?.toString() ?? null,
    stationName: log.stationName,
    odometer: log.odometer,
    refuelTime: log.refuelTime.toISOString(),
  };
}

@Injectable()
export class FuelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * `totalAmount = liters × pricePerLiter`, computed in integers.
   *
   * litres are held as centilitres, so the product is in tiyin-centilitres and
   * has to come back down by 100. Doing this in floating point is how a fuel
   * report ends up a few tiyin out on every row.
   */
  private derivedTotal(dto: CreateFuelLogDto | UpdateFuelLogDto): bigint | undefined {
    if (dto.totalAmount !== undefined) return BigInt(dto.totalAmount);
    if (dto.liters === undefined || dto.pricePerLiter === undefined) return undefined;
    const centilitres = decimalStringToInt(dto.liters, 2);
    return divRound(centilitres * BigInt(dto.pricePerLiter), 100n);
  }

  private toData(dto: CreateFuelLogDto | UpdateFuelLogDto) {
    const { liters, pricePerLiter, totalAmount: _ignored, refuelTime, ...rest } = dto;
    return {
      ...rest,
      liters: liters === undefined ? undefined : new Prisma.Decimal(liters),
      pricePerLiter: pricePerLiter === undefined ? undefined : BigInt(pricePerLiter),
      totalAmount: this.derivedTotal(dto),
      refuelTime: refuelTime === undefined ? undefined : new Date(refuelTime),
    };
  }

  async list(
    actor: CurrentUserPayload,
    filter: ListFuelLogsDto,
  ): Promise<{ data: FuelLog[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.FuelLogWhereInput = {
      vehicleId: filter.vehicleId,
      tripId: filter.tripId,
    };
    const [data, total] = await Promise.all([
      db.fuelLog.findMany({
        where,
        orderBy: { refuelTime: 'desc' },
        skip: filter.skip,
        take: filter.limit,
      }),
      db.fuelLog.count({ where }),
    ]);
    return { data, total };
  }

  async create(actor: CurrentUserPayload, dto: CreateFuelLogDto): Promise<FuelLog> {
    await this.assertRefsInTenant(actor, dto);

    if (dto.clientTxId) {
      const existing = await this.prisma
        .forCompany(actor.companyId)
        .fuelLog.findFirst({ where: { clientTxId: dto.clientTxId } });
      if (existing) return existing;
    }

    try {
      const log = await this.prisma.forCompany(actor.companyId).fuelLog.create({
        data: {
          ...this.toData(dto),
          createdById: actor.userId,
        } as Prisma.FuelLogUncheckedCreateInput,
      });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'FuelLog',
        entityId: log.id,
        after: snapshot(log),
      });
      return log;
    } catch (error) {
      // Lost the idempotency race: the winner's row is the correct answer.
      if (
        dto.clientTxId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma
          .forCompany(actor.companyId)
          .fuelLog.findFirst({ where: { clientTxId: dto.clientTxId } });
        if (winner) return winner;
      }
      rethrowPrismaError(error);
    }
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateFuelLogDto): Promise<FuelLog> {
    const existing = await this.prisma
      .forCompany(actor.companyId)
      .fuelLog.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.assertRefsInTenant(actor, dto);
    try {
      const log = await this.prisma
        .forCompany(actor.companyId)
        .fuelLog.update({ where: { id }, data: this.toData(dto) });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'UPDATE',
        entityType: 'FuelLog',
        entityId: id,
        before: snapshot(existing),
        after: snapshot(log),
      });
      return log;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async remove(actor: CurrentUserPayload, id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma
      .forCompany(actor.companyId)
      .fuelLog.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.prisma.forCompany(actor.companyId).fuelLog.delete({ where: { id } });
    // Fuel is money: a deletion has to leave the full row behind, or a litre
    // count can be edited away without a trace.
    this.audit.log({
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'DELETE',
      entityType: 'FuelLog',
      entityId: id,
      before: snapshot(existing),
    });
    return { deleted: true };
  }

  /**
   * Every foreign key must resolve inside the caller's own tenant. The scoped
   * lookups make a foreign id indistinguishable from a missing one, so this
   * neither accepts nor reveals another company's rows (H-2).
   */
  private async assertRefsInTenant(
    actor: CurrentUserPayload,
    refs: { vehicleId?: string; tripId?: string; driverId?: string },
  ): Promise<void> {
    const db = this.prisma.forCompany(actor.companyId);
    const checks: Array<[string | undefined, () => Promise<{ id: string } | null>]> = [
      [
        refs.vehicleId,
        () => db.vehicle.findUnique({ where: { id: refs.vehicleId! }, select: { id: true } }),
      ],
      [
        refs.tripId,
        () => db.trip.findUnique({ where: { id: refs.tripId! }, select: { id: true } }),
      ],
      [
        refs.driverId,
        () => db.driver.findUnique({ where: { id: refs.driverId! }, select: { id: true } }),
      ],
    ];
    for (const [id, lookup] of checks) {
      if (id && !(await lookup())) {
        throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, undefined, { id });
      }
    }
  }
}
