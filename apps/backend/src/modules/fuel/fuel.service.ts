import { HttpStatus, Injectable } from '@nestjs/common';
import type { FuelLog, Prisma } from '@prisma/client';
import type { CurrentUserPayload, FuelControlRow, FuelControlView } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { divideRounded, fuelDeviation, toKm10 } from '../finance/finance.calculator';
import { resolveRange } from '../finance/finance.service';
import {
  CreateFuelLogDto,
  FuelControlDto,
  ListFuelLogsDto,
  UpdateFuelLogDto,
} from './dto/fuel.dto';

/** Litres carried as hundredths, so a 320.45 l fill never becomes a float. */
const toCenti = (value: unknown): number => {
  const liters = Number(value ?? 0);
  return Number.isFinite(liters) ? Math.round(liters * 100) : 0;
};

const money = (value: bigint): string => value.toString();

function toFuelLogData(dto: CreateFuelLogDto | UpdateFuelLogDto) {
  const { pricePerLiter, totalAmount, refuelTime, ...rest } = dto;
  return {
    ...rest,
    pricePerLiter: pricePerLiter === undefined ? undefined : BigInt(pricePerLiter),
    totalAmount: totalAmount === undefined ? undefined : BigInt(totalAmount),
    refuelTime: refuelTime === undefined ? undefined : new Date(refuelTime),
  };
}

/**
 * W-8 «Yoqilg'i nazorati» — the feature TZ calls the killer one. The journal
 * is plain CRUD; the control table compares what each vehicle burned against
 * its norm and prices the difference (TZ §6).
 */
@Injectable()
export class FuelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: CurrentUserPayload,
    filter: ListFuelLogsDto,
  ): Promise<{ data: FuelLog[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.FuelLogWhereInput = {
      vehicleId: filter.vehicleId,
      tripId: filter.tripId,
      refuelTime: {
        gte: filter.from ? new Date(filter.from) : undefined,
        lt: filter.to ? new Date(filter.to) : undefined,
      },
    };
    const [data, total] = await Promise.all([
      db.fuelLog.findMany({
        where,
        orderBy: { refuelTime: 'desc' },
        skip: filter.skip,
        take: filter.limit,
        include: { vehicle: { select: { plateNumber: true } } },
      }),
      db.fuelLog.count({ where }),
    ]);
    return { data, total };
  }

  async create(actor: CurrentUserPayload, dto: CreateFuelLogDto): Promise<FuelLog> {
    try {
      return await this.prisma.forCompany(actor.companyId).fuelLog.create({
        data: toFuelLogData(dto) as Prisma.FuelLogUncheckedCreateInput,
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateFuelLogDto): Promise<FuelLog> {
    const db = this.prisma.forCompany(actor.companyId);
    const before = await db.fuelLog.findUnique({ where: { id } });
    if (!before) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    try {
      const updated = await db.fuelLog.update({
        where: { id },
        data: toFuelLogData(dto) as Prisma.FuelLogUncheckedUpdateInput,
      });
      this.audit.log({
        companyId: actor.companyId!,
        userId: actor.userId,
        action: 'UPDATE',
        entityType: 'FuelLog',
        entityId: id,
        before: { liters: String(before.liters), totalAmount: before.totalAmount?.toString() },
        after: { liters: String(updated.liters), totalAmount: updated.totalAmount?.toString() },
      });
      return updated;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async remove(actor: CurrentUserPayload, id: string): Promise<{ id: string }> {
    const db = this.prisma.forCompany(actor.companyId);
    const existing = await db.fuelLog.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    await db.fuelLog.delete({ where: { id } });
    this.audit.log({
      companyId: actor.companyId!,
      userId: actor.userId,
      action: 'DELETE',
      entityType: 'FuelLog',
      entityId: id,
    });
    return { id };
  }

  /**
   * Norma = (Probeg ÷ 100) × Norma_l_100km;  Farq = Real − Norma;
   * Zarar = Farq × narx. Distance comes from the period's trips, litres from
   * the journal; a vehicle without a declared norm is reported with no signal
   * rather than silently accused.
   */
  async control(actor: CurrentUserPayload, range: FuelControlDto): Promise<FuelControlView> {
    const db = this.prisma.forCompany(actor.companyId);
    const { from, to } = resolveRange(range);

    const [company, vehicles, logs, trips] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: actor.companyId! },
        select: { fuelDeviationPercent: true },
      }),
      db.vehicle.findMany({
        where: { isActive: true, type: { not: 'TRAILER' } },
        select: { id: true, plateNumber: true, fuelNormPer100km: true },
        orderBy: { plateNumber: 'asc' },
      }),
      db.fuelLog.findMany({
        where: { refuelTime: { gte: from, lt: to } },
        select: { vehicleId: true, liters: true, pricePerLiter: true, totalAmount: true },
      }),
      db.trip.findMany({
        where: { vehicleId: { not: null }, createdAt: { gte: from, lt: to } },
        select: { vehicleId: true, actualDistanceKm: true, plannedDistanceKm: true },
      }),
    ]);

    const thresholdBp = (company?.fuelDeviationPercent ?? 7) * 100;

    const distanceByVehicle = new Map<string, number>();
    for (const trip of trips) {
      if (!trip.vehicleId) continue;
      const actual = toKm10(trip.actualDistanceKm as unknown as string | null);
      const km10 = actual > 0 ? actual : toKm10(trip.plannedDistanceKm as unknown as string | null);
      distanceByVehicle.set(trip.vehicleId, (distanceByVehicle.get(trip.vehicleId) ?? 0) + km10);
    }

    const fuelByVehicle = new Map<string, { centi: number; spent: bigint; count: number }>();
    for (const log of logs) {
      const bucket = fuelByVehicle.get(log.vehicleId) ?? { centi: 0, spent: 0n, count: 0 };
      const centi = toCenti(log.liters);
      bucket.centi += centi;
      bucket.count += 1;
      bucket.spent +=
        log.totalAmount ??
        (log.pricePerLiter ? divideRounded(BigInt(centi) * log.pricePerLiter, 100n) : 0n);
      fuelByVehicle.set(log.vehicleId, bucket);
    }

    const rows: FuelControlRow[] = [];
    let totalLoss = 0n;

    for (const vehicle of vehicles) {
      const fuel = fuelByVehicle.get(vehicle.id);
      const km10 = distanceByVehicle.get(vehicle.id) ?? 0;
      if (!fuel && km10 === 0) continue; // The vehicle simply did not work.

      const actualLitersCenti = fuel?.centi ?? 0;
      // The period's own average price — fuel prices move week to week.
      const avgPricePerLiter =
        fuel && fuel.centi > 0 ? divideRounded(fuel.spent * 100n, BigInt(fuel.centi)) : 0n;

      const deviation = fuelDeviation({
        km10,
        normPer100kmCenti: toCenti(vehicle.fuelNormPer100km),
        actualLitersCenti,
        pricePerLiter: avgPricePerLiter,
      });
      totalLoss += deviation.lossTiyin;

      rows.push({
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        distanceKm10: km10,
        normLitersCenti: deviation.normLitersCenti,
        actualLitersCenti,
        diffLitersCenti: deviation.diffLitersCenti,
        diffBp: deviation.diffBp,
        lossTiyin: money(deviation.lossTiyin),
        overThreshold: deviation.normLitersCenti > 0 && deviation.diffBp > thresholdBp,
        refuelCount: fuel?.count ?? 0,
        avgPricePerLiter: money(avgPricePerLiter),
      });
    }

    rows.sort((a, b) => b.diffBp - a.diffBp);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      thresholdBp,
      rows,
      totalLossTiyin: money(totalLoss),
    };
  }
}
