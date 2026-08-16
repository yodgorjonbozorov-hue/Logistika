import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AlertType, LiveStatus, type CurrentUserPayload } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { SettingsService } from '../companies/settings.service';
import { TrackingService } from './tracking.service';
import { IDLE_LOOKBACK_FACTOR, detectDeviation, detectIdle, type WatchPoint } from './watch.detect';

/** Often enough to be useful on a two-hour rule, rare enough to stay cheap. */
const WATCH_CRON = '*/15 * * * *';

/**
 * The two live alerts of TZ §4.1 W-2: a truck that stopped without saying so,
 * and a truck that left its route.
 *
 * Both run on the same figures the map shows, and both go through the alerts
 * centre, where an unread alert of the same kind on the same vehicle blocks a
 * repeat — a check every fifteen minutes must not turn one stop into a wall of
 * notifications.
 */
@Injectable()
export class WatchService {
  private readonly logger = new Logger(WatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: TrackingService,
    private readonly settings: SettingsService,
    private readonly alerts: AlertsService,
  ) {}

  @Cron(WATCH_CRON)
  async watchAllCompanies(now: Date = new Date()): Promise<void> {
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const company of companies) {
      try {
        await this.watch(company.id, now);
      } catch (error) {
        // One tenant's bad data must not stop the watch for the others.
        this.logger.error(`Live watch failed for company ${company.id}`, error as Error);
      }
    }
  }

  /** Checks one company and raises what is new. Returns the alerts raised. */
  async watch(companyId: string, now: Date = new Date()): Promise<number> {
    const actor = {
      userId: null as unknown as string,
      companyId,
      role: 'OWNER',
    } as CurrentUserPayload;

    const [thresholds, live] = await Promise.all([
      this.settings.thresholds(companyId),
      this.tracking.live(actor),
    ]);

    // A driver who pressed «rest» has already explained the stop (TZ §8.5).
    const watched = live.filter((row) => row.trip !== null && row.status !== LiveStatus.RESTING);
    if (watched.length === 0) return 0;

    const trails = await this.trails(
      companyId,
      watched.map((row) => row.vehicleId),
      thresholds.idleAlertHours,
      now,
    );

    const byVehicle = new Map(live.map((row) => [row.vehicleId, row]));
    let raised = 0;

    for (const finding of detectIdle(trails, thresholds.idleAlertHours, now)) {
      const row = byVehicle.get(finding.vehicleId);
      if (!row) continue;
      const alert = await this.alerts.raise(companyId, {
        type: AlertType.VEHICLE_IDLE,
        titleKey: 'alerts.vehicleIdle.title',
        messageKey: 'alerts.vehicleIdle.message',
        params: {
          plate: row.plateNumber,
          hours: finding.hours,
          tripNumber: row.trip?.tripNumber ?? '—',
        },
        relatedType: 'Vehicle',
        relatedId: row.vehicleId,
      });
      if (alert) raised += 1;
    }

    const deviations = detectDeviation(
      watched.map((row) => ({
        vehicleId: row.vehicleId,
        deviationKm: row.deviationKm,
        onTrip: row.status === LiveStatus.MOVING || row.status === LiveStatus.BREAKDOWN,
      })),
      thresholds.routeDeviationKm,
    );
    for (const finding of deviations) {
      const row = byVehicle.get(finding.vehicleId);
      if (!row) continue;
      const alert = await this.alerts.raise(companyId, {
        type: AlertType.ROUTE_DEVIATION,
        titleKey: 'alerts.routeDeviation.title',
        messageKey: 'alerts.routeDeviation.message',
        params: {
          plate: row.plateNumber,
          deviationKm: finding.deviationKm.toFixed(1),
          limitKm: thresholds.routeDeviationKm,
          tripNumber: row.trip?.tripNumber ?? '—',
        },
        relatedType: 'Vehicle',
        relatedId: row.vehicleId,
      });
      if (alert) raised += 1;
    }

    return raised;
  }

  /** GPS trail of each watched vehicle over the lookback window, in one query. */
  private async trails(
    companyId: string,
    vehicleIds: string[],
    idleHours: number,
    now: Date,
  ): Promise<Array<{ vehicleId: string; points: WatchPoint[] }>> {
    const since = new Date(now.getTime() - idleHours * IDLE_LOOKBACK_FACTOR * 3_600_000);
    const points = await this.prisma.forCompany(companyId).gpsTrack.findMany({
      where: { vehicleId: { in: vehicleIds }, recordedAt: { gte: since } },
      select: { vehicleId: true, lat: true, lng: true, recordedAt: true },
      orderBy: { recordedAt: 'asc' },
    });

    const byVehicle = new Map<string, WatchPoint[]>();
    for (const point of points) {
      const trail = byVehicle.get(point.vehicleId) ?? [];
      trail.push({ lat: point.lat, lng: point.lng, recordedAt: point.recordedAt });
      byVehicle.set(point.vehicleId, trail);
    }
    return [...byVehicle].map(([vehicleId, trail]) => ({ vehicleId, points: trail }));
  }
}
