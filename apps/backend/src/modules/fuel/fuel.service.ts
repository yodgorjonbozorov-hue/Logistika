import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { FuelLog, Prisma } from '@prisma/client';
import { AlertType, type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { divRound, fromScaledInt, toScaledInt } from '../../common/money';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { SettingsService } from '../companies/settings.service';
import { periodOf, PeriodDto } from '../finance/dto/finance.dto';
import { calcFuelDeviation, LITRE_SCALE, tripDistanceKmTenths } from '../finance/finance.calc';
import { CreateFuelLogDto, ListFuelLogsDto, UpdateFuelLogDto } from './dto/fuel.dto';

/** Window the nightly threshold check looks back over. */
const FUEL_CHECK_DAYS = 30;

export interface FuelControlRow {
  vehicleId: string;
  plateNumber: string;
  /** Norm from the vehicle card, l/100 km. */
  normPer100km: string | null;
  distanceKm: string | null;
  normLitres: string;
  actualLitres: string;
  deviationLitres: string;
  /** Deviation as a share of the norm, in basis points. */
  deviationBp: number | null;
  avgPricePerLitre: bigint | null;
  lossTiyin: bigint | null;
  refuelCount: number;
  exceedsThreshold: boolean;
}

export interface FuelStationRow {
  stationName: string;
  refuelCount: number;
  litres: string;
  totalAmount: bigint;
  avgPricePerLitre: bigint | null;
  /**
   * Litres of the fleet overrun attributed to this station, split across stations
   * in proportion to the litres each sold to that vehicle (TZ W-8 «AZS tahlili»).
   */
  attributedOverrunLitres: string;
}

function toFuelData(dto: CreateFuelLogDto | UpdateFuelLogDto) {
  const { pricePerLiter, totalAmount, refuelTime, ...rest } = dto;
  return {
    ...rest,
    pricePerLiter: pricePerLiter === undefined ? undefined : BigInt(pricePerLiter),
    totalAmount: totalAmount === undefined ? undefined : BigInt(totalAmount),
    refuelTime: refuelTime === undefined ? undefined : new Date(refuelTime),
  };
}

/**
 * Fills in whichever of litres × price = amount is missing, so the journal always
 * has a comparable total. All three given → they are kept as entered (the receipt
 * is the source of truth; AI-2 will flag mismatches in stage 8).
 */
export function completeFuelAmounts(data: {
  liters?: number;
  pricePerLiter?: bigint;
  totalAmount?: bigint;
}): { pricePerLiter?: bigint; totalAmount?: bigint } {
  const litresCl = data.liters === undefined ? null : toScaledInt(data.liters, LITRE_SCALE);
  if (!litresCl || litresCl === 0n) return {};
  if (data.totalAmount === undefined && data.pricePerLiter !== undefined) {
    return { totalAmount: divRound(data.pricePerLiter * litresCl, 100n) };
  }
  if (data.pricePerLiter === undefined && data.totalAmount !== undefined) {
    return { pricePerLiter: divRound(data.totalAmount * 100n, litresCl) };
  }
  return {};
}

@Injectable()
export class FuelService {
  private readonly logger = new Logger(FuelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly alerts: AlertsService,
  ) {}

  // ---------- Journal ----------

  async list(
    actor: CurrentUserPayload,
    filter: ListFuelLogsDto,
  ): Promise<{ data: FuelLog[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.FuelLogWhereInput = {
      vehicleId: filter.vehicleId,
      tripId: filter.tripId,
      refuelTime: { gte: filter.fromDate, lte: filter.toDate },
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
    // Cross-tenant ids look missing through the tenant client.
    const vehicle = await db.vehicle.findUnique({ where: { id: dto.vehicleId } });
    if (!vehicle) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    const data = toFuelData(dto);
    try {
      return await db.fuelLog.create({
        data: {
          ...data,
          ...completeFuelAmounts({ ...data, liters: dto.liters }),
        } as Prisma.FuelLogUncheckedCreateInput,
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateFuelLogDto): Promise<FuelLog> {
    const db = this.prisma.forCompany(actor.companyId);
    const existing = await db.fuelLog.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    try {
      return await db.fuelLog.update({ where: { id }, data: toFuelData(dto) });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async remove(actor: CurrentUserPayload, id: string): Promise<{ deleted: boolean }> {
    const { count } = await this.prisma
      .forCompany(actor.companyId)
      .fuelLog.deleteMany({ where: { id } });
    if (count === 0) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return { deleted: true };
  }

  // ---------- W-8 control table ----------

  /**
   * Norm vs actual per vehicle for a period (TZ §6 / W-8).
   * Mileage comes from the trips of the period — the same distance the P&L uses.
   */
  async control(actor: CurrentUserPayload, period: PeriodDto): Promise<FuelControlRow[]> {
    const companyId = actor.companyId as string;
    const db = this.prisma.forCompany(companyId);
    const [vehicles, trips, logs, thresholds] = await Promise.all([
      db.vehicle.findMany({
        where: { isActive: true, type: { not: 'TRAILER' } },
        select: { id: true, plateNumber: true, fuelNormPer100km: true },
        orderBy: { plateNumber: 'asc' },
      }),
      db.trip.findMany({
        where: { status: 'COMPLETED', finishedAt: { gte: period.fromDate, lte: period.toDate } },
        select: {
          vehicleId: true,
          actualDistanceKm: true,
          plannedDistanceKm: true,
          startOdometer: true,
          endOdometer: true,
        },
      }),
      db.fuelLog.findMany({
        where: { refuelTime: { gte: period.fromDate, lte: period.toDate } },
        select: { vehicleId: true, liters: true, totalAmount: true },
      }),
      this.settings.thresholds(companyId),
    ]);

    const distanceByVehicle = new Map<string, bigint>();
    for (const trip of trips) {
      if (!trip.vehicleId) continue;
      const distance = tripDistanceKmTenths(trip);
      if (!distance) continue;
      distanceByVehicle.set(
        trip.vehicleId,
        (distanceByVehicle.get(trip.vehicleId) ?? 0n) + distance,
      );
    }

    const fuelByVehicle = new Map<string, { litresCl: bigint; amount: bigint; count: number }>();
    for (const log of logs) {
      const row = fuelByVehicle.get(log.vehicleId) ?? { litresCl: 0n, amount: 0n, count: 0 };
      row.litresCl += toScaledInt(log.liters, LITRE_SCALE) ?? 0n;
      row.amount += log.totalAmount ?? 0n;
      row.count += 1;
      fuelByVehicle.set(log.vehicleId, row);
    }

    return vehicles.map((vehicle) => {
      const distance = distanceByVehicle.get(vehicle.id) ?? null;
      const fuel = fuelByVehicle.get(vehicle.id) ?? { litresCl: 0n, amount: 0n, count: 0 };
      const avgPricePerLitre =
        fuel.litresCl > 0n && fuel.amount > 0n ? divRound(fuel.amount * 100n, fuel.litresCl) : null;
      const deviation = calcFuelDeviation(
        distance,
        toScaledInt(vehicle.fuelNormPer100km, LITRE_SCALE),
        fuel.litresCl,
        avgPricePerLitre,
      );

      return {
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        normPer100km: vehicle.fuelNormPer100km?.toString() ?? null,
        distanceKm: distance === null ? null : fromScaledInt(distance, 1),
        normLitres: fromScaledInt(deviation.normCl, LITRE_SCALE),
        actualLitres: fromScaledInt(deviation.actualCl, LITRE_SCALE),
        deviationLitres: fromScaledInt(deviation.deviationCl, LITRE_SCALE),
        deviationBp: deviation.deviationBp,
        avgPricePerLitre,
        lossTiyin: deviation.lossTiyin,
        refuelCount: fuel.count,
        exceedsThreshold:
          deviation.deviationBp !== null &&
          deviation.deviationBp > thresholds.fuelDeviationThresholdBp,
      };
    });
  }

  /** TZ W-8: which filling station the overrun clusters around. */
  async stations(actor: CurrentUserPayload, period: PeriodDto): Promise<FuelStationRow[]> {
    const db = this.prisma.forCompany(actor.companyId);
    const [logs, control] = await Promise.all([
      db.fuelLog.findMany({
        where: { refuelTime: { gte: period.fromDate, lte: period.toDate } },
        select: { vehicleId: true, stationName: true, liters: true, totalAmount: true },
      }),
      this.control(actor, period),
    ]);

    const overrunByVehicle = new Map<string, bigint>();
    const litresByVehicle = new Map<string, bigint>();
    for (const row of control) {
      const deviation = toScaledInt(row.deviationLitres, LITRE_SCALE) ?? 0n;
      if (deviation > 0n) overrunByVehicle.set(row.vehicleId, deviation);
      litresByVehicle.set(row.vehicleId, toScaledInt(row.actualLitres, LITRE_SCALE) ?? 0n);
    }

    const byStation = new Map<
      string,
      { refuelCount: number; litresCl: bigint; amount: bigint; overrunCl: bigint }
    >();
    for (const log of logs) {
      const name = log.stationName?.trim() || '—';
      const row = byStation.get(name) ?? {
        refuelCount: 0,
        litresCl: 0n,
        amount: 0n,
        overrunCl: 0n,
      };
      const litresCl = toScaledInt(log.liters, LITRE_SCALE) ?? 0n;
      row.refuelCount += 1;
      row.litresCl += litresCl;
      row.amount += log.totalAmount ?? 0n;

      const vehicleOverrun = overrunByVehicle.get(log.vehicleId);
      const vehicleLitres = litresByVehicle.get(log.vehicleId);
      if (vehicleOverrun && vehicleLitres && vehicleLitres > 0n) {
        row.overrunCl += divRound(vehicleOverrun * litresCl, vehicleLitres);
      }
      byStation.set(name, row);
    }

    return [...byStation.entries()]
      .map(([stationName, row]) => ({
        stationName,
        refuelCount: row.refuelCount,
        litres: fromScaledInt(row.litresCl, LITRE_SCALE),
        totalAmount: row.amount,
        avgPricePerLitre:
          row.litresCl > 0n && row.amount > 0n ? divRound(row.amount * 100n, row.litresCl) : null,
        attributedOverrunLitres: fromScaledInt(row.overrunCl, LITRE_SCALE),
      }))
      .sort((a, b) => Number(b.totalAmount - a.totalAmount));
  }

  // ---------- Threshold alerts ----------

  /**
   * Raises a FUEL_OVERRUN alert for every vehicle over the company threshold in
   * the last 30 days. Returns how many alerts were new (duplicates are dropped
   * by AlertsService while the previous one is still unread).
   */
  async checkThresholds(companyId: string): Promise<number> {
    const to = new Date();
    const from = new Date(to.getTime() - FUEL_CHECK_DAYS * 24 * 60 * 60 * 1000);
    const actor = {
      userId: null as unknown as string,
      companyId,
      role: 'OWNER',
    } as CurrentUserPayload;
    const rows = await this.control(actor, periodOf(from, to));

    const alerts = rows
      .filter((row) => row.exceedsThreshold)
      .map((row) => ({
        type: AlertType.FUEL_OVERRUN,
        titleKey: 'alerts.fuelOverrun.title',
        messageKey: 'alerts.fuelOverrun.message',
        params: {
          plate: row.plateNumber,
          litres: row.deviationLitres,
          percent: ((row.deviationBp ?? 0) / 100).toFixed(1),
          days: FUEL_CHECK_DAYS,
        },
        relatedType: 'Vehicle',
        relatedId: row.vehicleId,
      }));
    return this.alerts.raiseMany(companyId, alerts);
  }

  /** Nightly fleet-wide fuel check (TZ W-8: «chegaradan oshsa avtomatik signal»). */
  @Cron('0 4 * * *')
  async checkAllCompanies(): Promise<void> {
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const company of companies) {
      try {
        const raised = await this.checkThresholds(company.id);
        if (raised > 0) this.logger.log(`Fuel overrun alerts raised: ${raised} (${company.id})`);
      } catch (error) {
        // One company must never break the loop for the others.
        this.logger.error(
          `Fuel check failed for ${company.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
