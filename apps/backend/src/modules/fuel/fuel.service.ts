import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { FuelLog, Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import {
  divRound,
  fuelDeviationPercent,
  fuelLossTiyin,
  fuelNormCl,
  toCentiliters,
} from '../finance/finance.calc';
import { tripDistanceKm } from '../finance/finance.service';
import { CreateFuelLogDto, ListFuelDto, UpdateFuelLogDto } from './dto/fuel.dto';

export const DEFAULT_FUEL_DEVIATION_THRESHOLD = 7;

/** One W-8 control table row (TZ §4.1: probeg, norma, real, farq, zarar). */
export interface FuelControlRow {
  vehicleId: string;
  plateNumber: string;
  fuelNormPer100km: number | null;
  distanceKm: number;
  normLiters: number;
  actualLiters: number;
  diffLiters: number;
  /** Weighted average price per liter over the period (tiyin); null if unknown. */
  avgPricePerLiter: bigint | null;
  lossAmount: bigint | null;
  deviationPercent: number | null;
  overThreshold: boolean;
}

export interface StationRow {
  stationName: string;
  refuelCount: number;
  liters: number;
  totalAmount: bigint;
  avgPricePerLiter: bigint | null;
}

function toData(dto: CreateFuelLogDto | UpdateFuelLogDto) {
  const { pricePerLiter, totalAmount, refuelTime, ...rest } = dto;
  return {
    ...rest,
    pricePerLiter: pricePerLiter === undefined ? undefined : BigInt(pricePerLiter),
    totalAmount: totalAmount === undefined ? undefined : BigInt(totalAmount),
    refuelTime: refuelTime === undefined ? undefined : new Date(refuelTime),
  };
}

@Injectable()
export class FuelService {
  private readonly logger = new Logger(FuelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  async list(
    actor: CurrentUserPayload,
    filter: ListFuelDto,
  ): Promise<{ data: FuelLog[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.FuelLogWhereInput = {
      vehicleId: filter.vehicleId,
      tripId: filter.tripId,
      refuelTime: {
        gte: filter.from ? new Date(filter.from) : undefined,
        lte: filter.to ? new Date(filter.to) : undefined,
      },
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
    const db = this.prisma.forCompany(actor.companyId);
    // Tenant-scoped reference check: the vehicle must belong to this company.
    const vehicle = await db.vehicle.findUnique({ where: { id: dto.vehicleId } });
    if (!vehicle) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    try {
      return await db.fuelLog.create({
        data: toData(dto) as Prisma.FuelLogUncheckedCreateInput,
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateFuelLogDto): Promise<FuelLog> {
    try {
      return await this.prisma
        .forCompany(actor.companyId)
        .fuelLog.update({ where: { id }, data: toData(dto) });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /** W-8 control table over a period, one row per active truck. */
  async control(actor: CurrentUserPayload, from: Date, to: Date): Promise<FuelControlRow[]> {
    if (!actor.companyId) throw new AppException('TENANT_MISSING', HttpStatus.FORBIDDEN);
    return this.controlForCompany(actor.companyId, from, to);
  }

  /** AZS analysis (W-8): where the money goes and at what price per liter. */
  async byStation(actor: CurrentUserPayload, from: Date, to: Date): Promise<StationRow[]> {
    const logs = await this.prisma.forCompany(actor.companyId).fuelLog.findMany({
      where: { refuelTime: { gte: from, lte: to } },
    });

    const stations = new Map<string, { count: number; liters: bigint; amount: bigint }>();
    for (const log of logs) {
      const key = log.stationName?.trim() || '—';
      const entry = stations.get(key) ?? { count: 0, liters: 0n, amount: 0n };
      entry.count += 1;
      entry.liters += toCentiliters(Number(log.liters));
      entry.amount += this.logAmount(log) ?? 0n;
      stations.set(key, entry);
    }

    return [...stations.entries()]
      .map(([stationName, s]) => ({
        stationName,
        refuelCount: s.count,
        liters: Number(s.liters) / 100,
        totalAmount: s.amount,
        avgPricePerLiter:
          s.liters > 0n && s.amount > 0n ? divRound(s.amount * 100n, s.liters) : null,
      }))
      .sort((a, b) => (a.totalAmount > b.totalAmount ? -1 : 1));
  }

  private async controlForCompany(
    companyId: string,
    from: Date,
    to: Date,
  ): Promise<FuelControlRow[]> {
    const db = this.prisma.forCompany(companyId);
    const [vehicles, trips, logs, settings] = await Promise.all([
      db.vehicle.findMany({ where: { isActive: true, type: { not: 'TRAILER' } } }),
      db.trip.findMany({
        where: { status: 'COMPLETED', finishedAt: { gte: from, lte: to } },
      }),
      db.fuelLog.findMany({ where: { refuelTime: { gte: from, lte: to } } }),
      db.aiSettings.findFirst(),
    ]);
    const threshold = settings
      ? Number(settings.fuelDeviationThreshold)
      : DEFAULT_FUEL_DEVIATION_THRESHOLD;

    const kmByVehicle = new Map<string, number>();
    for (const trip of trips) {
      if (!trip.vehicleId) continue;
      kmByVehicle.set(
        trip.vehicleId,
        (kmByVehicle.get(trip.vehicleId) ?? 0) + tripDistanceKm(trip),
      );
    }
    const logsByVehicle = new Map<string, FuelLog[]>();
    for (const log of logs) {
      const list = logsByVehicle.get(log.vehicleId) ?? [];
      list.push(log);
      logsByVehicle.set(log.vehicleId, list);
    }

    return vehicles.map((vehicle) => {
      const distanceKm = kmByVehicle.get(vehicle.id) ?? 0;
      const norm = vehicle.fuelNormPer100km == null ? null : Number(vehicle.fuelNormPer100km);
      const vehicleLogs = logsByVehicle.get(vehicle.id) ?? [];

      const actualCl = vehicleLogs.reduce((acc, l) => acc + toCentiliters(Number(l.liters)), 0n);
      const normCl = norm == null ? 0n : fuelNormCl(norm, distanceKm);
      const diffCl = actualCl - normCl;

      let litersWithPrice = 0n;
      let amountWithPrice = 0n;
      for (const log of vehicleLogs) {
        const amount = this.logAmount(log);
        if (amount != null) {
          litersWithPrice += toCentiliters(Number(log.liters));
          amountWithPrice += amount;
        }
      }
      const avgPricePerLiter =
        litersWithPrice > 0n ? divRound(amountWithPrice * 100n, litersWithPrice) : null;

      // Deviation is meaningful only when a norm and mileage exist.
      const deviationPercent =
        norm == null || normCl === 0n ? null : fuelDeviationPercent(actualCl, normCl);

      return {
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        fuelNormPer100km: norm,
        distanceKm,
        normLiters: Number(normCl) / 100,
        actualLiters: Number(actualCl) / 100,
        diffLiters: Number(diffCl) / 100,
        avgPricePerLiter,
        lossAmount:
          avgPricePerLiter == null || normCl === 0n
            ? null
            : fuelLossTiyin(diffCl, avgPricePerLiter),
        deviationPercent,
        overThreshold: deviationPercent != null && deviationPercent > threshold,
      };
    });
  }

  /** Money of one refuel: explicit total, or liters × price when only price given. */
  private logAmount(log: FuelLog): bigint | null {
    if (log.totalAmount != null) return log.totalAmount;
    if (log.pricePerLiter != null) {
      return fuelLossTiyin(toCentiliters(Number(log.liters)), log.pricePerLiter);
    }
    return null;
  }

  /**
   * Nightly control (TZ §4.1 W-8): fuel deviation over the threshold raises a
   * FUEL_DEVIATION alert. Looks at the last 30 days per company.
   */
  @Cron('0 4 * * *')
  async checkDeviations(): Promise<void> {
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      const companies = await this.prisma.company.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      for (const company of companies) {
        const rows = await this.controlForCompany(company.id, from, to);
        for (const row of rows) {
          if (!row.overThreshold) continue;
          await this.alerts.raise(company.id, {
            type: 'FUEL_DEVIATION',
            params: {
              plateNumber: row.plateNumber,
              diffLiters: row.diffLiters,
              deviationPercent: row.deviationPercent ?? 0,
            },
            relatedType: 'Vehicle',
            relatedId: row.vehicleId,
          });
        }
      }
    } catch (error) {
      this.logger.error(
        `Fuel deviation check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
