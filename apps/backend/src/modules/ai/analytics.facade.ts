/**
 * The safe AI data layer.
 *
 * This is the ONLY way the assistant reaches data, and it is a thin facade over
 * services the rest of the application already uses:
 *
 *   finance.summary / monthly / byTrip / byRoute / byVehicle / fuel
 *   trips, vehicles, drivers, routes and the GPS live view
 *
 * Three properties matter here, and none of them depend on the model behaving:
 *
 *  1. **Tenant scope is structural.** Every call takes the `CurrentUserPayload`
 *     the JWT guard produced. `FinanceService` binds `company_id` into each raw
 *     query as a parameter and the Prisma reads go through the tenant
 *     extension. There is no argument on this facade that could point at
 *     another company, so no prompt can ask for one.
 *  2. **No SQL comes from here.** The assistant cannot express a query; it can
 *     only pick from the fixed set of sources below, and which ones it gets is
 *     decided by `detectIntent`, not by the model.
 *  3. **Each source is fetched at most once per question.** A question about
 *     fuel on the most profitable route needs three rollups, and several of
 *     them share the same period — memoising by source keeps that to one round
 *     trip each instead of one per mention.
 */
import { Injectable } from '@nestjs/common';
import type { CurrentUserPayload } from 'shared';
import { FinancePeriodDto, MonthlyDto } from '../finance/dto/finance-query.dto';
import {
  FinanceService,
  type FinanceSummary,
  type FuelRow,
  type MonthlyRow,
  type RouteFinanceRow,
  type TripFinanceRow,
  type VehicleFinanceRow,
} from '../finance/finance.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface AiPeriod {
  from: Date;
  to: Date;
  label: string;
}

/** Counts that are cheap and useful context for almost any question. */
export interface FleetCounts {
  vehicles: number;
  drivers: number;
  routes: number;
}

/**
 * One question's worth of data access. Constructed per request so the memo
 * cache cannot leak between users — a cache keyed only by source would
 * otherwise be a cross-tenant hole of exactly the kind this layer exists to
 * prevent.
 */
export class AnalyticsScope {
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(
    private readonly finance: FinanceService,
    private readonly prisma: PrismaService,
    private readonly actor: CurrentUserPayload,
    private readonly period: AiPeriod,
  ) {}

  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.cache.get(key);
    if (existing) return existing as Promise<T>;
    const promise = load();
    this.cache.set(key, promise);
    return promise;
  }

  private periodDto(): FinancePeriodDto {
    const dto = new FinancePeriodDto();
    dto.from = this.period.from;
    dto.to = this.period.to;
    return dto;
  }

  summary(): Promise<FinanceSummary> {
    return this.once('summary', () => this.finance.summary(this.actor, this.periodDto()));
  }

  routes(): Promise<RouteFinanceRow[]> {
    return this.once('routes', () => this.finance.byRoute(this.actor, this.periodDto()));
  }

  vehicles(): Promise<VehicleFinanceRow[]> {
    return this.once('vehicles', () => this.finance.byVehicle(this.actor, this.periodDto()));
  }

  fuel(): Promise<FuelRow[]> {
    return this.once('fuel', () => this.finance.fuel(this.actor, this.periodDto()));
  }

  monthly(months = 6): Promise<MonthlyRow[]> {
    return this.once(`monthly:${months}`, () => {
      const dto = new MonthlyDto();
      dto.months = months;
      return this.finance.monthly(this.actor, dto);
    });
  }

  trips(limit = 5): Promise<TripFinanceRow[]> {
    return this.once(`trips:${limit}`, async () => {
      const dto = Object.assign(this.periodDto(), { page: 1, limit }) as never;
      const { data } = await this.finance.byTrip(this.actor, dto);
      return data;
    });
  }

  /**
   * Fleet size. Read through the tenant extension, which adds `company_id` to
   * the WHERE clause of every one of these counts.
   */
  counts(): Promise<FleetCounts> {
    return this.once('counts', async () => {
      const db = this.prisma.forCompany(this.actor.companyId);
      const [vehicles, drivers, routes] = await Promise.all([
        db.vehicle.count({ where: { isActive: true } }),
        db.driver.count({ where: { isActive: true } }),
        db.route.count({ where: { isActive: true } }),
      ]);
      return { vehicles, drivers, routes };
    });
  }

  /** Vehicles currently on the road, from the same rows the live map reads. */
  onTheRoad(): Promise<number> {
    return this.once('onTheRoad', () =>
      this.prisma.forCompany(this.actor.companyId).trip.count({ where: { status: 'IN_PROGRESS' } }),
    );
  }
}

@Injectable()
export class AnalyticsFacade {
  constructor(
    private readonly finance: FinanceService,
    private readonly prisma: PrismaService,
  ) {}

  /** Opens a per-request, tenant-bound view of the analytics. */
  scopeFor(actor: CurrentUserPayload, period: AiPeriod): AnalyticsScope {
    return new AnalyticsScope(this.finance, this.prisma, actor, period);
  }
}
