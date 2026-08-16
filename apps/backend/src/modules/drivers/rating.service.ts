import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, TripEventType } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { divRound, ratioBp, toScaledInt } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../companies/settings.service';
import { rateDriver, ratingToDecimal, type DriverRating, type DriverStats } from './rating.calc';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rating window: long enough to be fair, short enough to still be current. */
export const RATING_WINDOW_DAYS = 180;
const LITRE_SCALE = 2;
const KM_SCALE = 1;

/**
 * Driver rating (TZ W-6 / E-7).
 *
 * Everything here is counted from the trips a driver actually ran; nothing is
 * an opinion and nothing comes from AI. The stored `drivers.rating` is a cache
 * of the same computation, refreshed nightly so a list can sort by it.
 */
@Injectable()
export class RatingService {
  private readonly logger = new Logger(RatingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Ratings of every active driver, newest computation, highest first. */
  async ratings(actor: CurrentUserPayload, now: Date = new Date()): Promise<DriverRating[]> {
    const companyId = actor.companyId as string;
    const stats = await this.collect(companyId, now);
    const thresholds = await this.settings.thresholds(companyId);

    return stats
      .map((driver) => rateDriver(driver, thresholds.fuelDeviationThresholdBp))
      .sort((a, b) => (b.ratingCentis ?? -1) - (a.ratingCentis ?? -1));
  }

  /** Nightly refresh of the cached rating, after the fuel check has run. */
  @Cron('30 4 * * *')
  async refreshAllCompanies(now: Date = new Date()): Promise<void> {
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const company of companies) {
      try {
        await this.refresh(company.id, now);
      } catch (error) {
        // One tenant's bad data must not stop the refresh for the others.
        this.logger.error(`Rating refresh failed for company ${company.id}`, error as Error);
      }
    }
  }

  async refresh(companyId: string, now: Date = new Date()): Promise<number> {
    const actor = {
      userId: null as unknown as string,
      companyId,
      role: 'OWNER',
    } as CurrentUserPayload;
    const db = this.prisma.forCompany(companyId);

    let written = 0;
    for (const rating of await this.ratings(actor, now)) {
      const value = ratingToDecimal(rating.ratingCentis);
      await db.driver.update({
        where: { id: rating.driverId },
        data: { rating: value === null ? null : new Prisma.Decimal(value) },
      });
      written += 1;
    }
    return written;
  }

  /**
   * The three inputs of TZ W-6, counted per driver: trips delivered late, fuel
   * burnt over the vehicle norm, and breakdowns reported.
   */
  private async collect(companyId: string, now: Date): Promise<DriverStats[]> {
    const db = this.prisma.forCompany(companyId);
    const from = new Date(now.getTime() - RATING_WINDOW_DAYS * DAY_MS);

    const [drivers, trips, breakdowns, fuelLogs] = await Promise.all([
      db.driver.findMany({ where: { isActive: true }, select: { id: true, fullName: true } }),
      db.trip.findMany({
        where: { status: 'COMPLETED', finishedAt: { gte: from, lte: now } },
        select: {
          id: true,
          driverId: true,
          vehicleId: true,
          finishedAt: true,
          unloadingDate: true,
          actualDistanceKm: true,
          plannedDistanceKm: true,
          vehicle: { select: { fuelNormPer100km: true } },
        },
      }),
      db.tripEvent.groupBy({
        by: ['driverId'],
        where: { eventType: TripEventType.BREAKDOWN, eventTime: { gte: from, lte: now } },
        _count: { _all: true },
      }),
      db.fuelLog.findMany({
        where: { refuelTime: { gte: from, lte: now } },
        select: { tripId: true, liters: true },
      }),
    ]);

    const breakdownsByDriver = new Map(breakdowns.map((row) => [row.driverId, row._count._all]));
    const litresByTrip = new Map<string, bigint>();
    for (const log of fuelLogs) {
      if (!log.tripId) continue;
      const litres = toScaledInt(log.liters, LITRE_SCALE) ?? 0n;
      litresByTrip.set(log.tripId, (litresByTrip.get(log.tripId) ?? 0n) + litres);
    }

    return drivers.map((driver) => {
      const own = trips.filter((trip) => trip.driverId === driver.id);
      let normLitres = 0n;
      let actualLitres = 0n;
      let lateTrips = 0;

      for (const trip of own) {
        if (trip.unloadingDate && trip.finishedAt && trip.finishedAt > trip.unloadingDate) {
          lateTrips += 1;
        }
        const km = toScaledInt(trip.actualDistanceKm ?? trip.plannedDistanceKm, KM_SCALE);
        const norm = toScaledInt(trip.vehicle?.fuelNormPer100km, LITRE_SCALE);
        const litres = litresByTrip.get(trip.id);
        // A trip counts towards fuel only when both its distance and its norm
        // are known — otherwise the driver would be judged on a missing field.
        if (km === null || norm === null || litres === undefined) continue;
        // km is tenths, norm is centilitres per 100 km → centilitres, rounded half-up.
        normLitres += divRound(km * norm, 1000n);
        actualLitres += litres;
      }

      return {
        driverId: driver.id,
        driverName: driver.fullName,
        trips: own.length,
        lateTrips,
        breakdowns: breakdownsByDriver.get(driver.id) ?? 0,
        fuelDeviationBp: normLitres === 0n ? null : ratioBp(actualLitres - normLitres, normLitres),
      };
    });
  }
}
