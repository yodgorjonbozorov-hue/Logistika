import { Cron } from '@nestjs/schedule';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AiFeature,
  AiInsightStatus,
  type AiInsight,
  type AiInsightSeverity,
  Prisma,
} from '@prisma/client';
import {
  DEFAULT_LOCALE,
  ExpenseCategory,
  TripEventType,
  type CurrentUserPayload,
  type Locale,
} from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { I18nService } from '../../i18n/i18n.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../companies/settings.service';
import { FuelService } from '../fuel/fuel.service';
import { periodOf } from '../finance/dto/finance.dto';
import { AiService } from './ai.service';
import {
  detectExpensiveRepair,
  detectFrequentBreakdown,
  detectFuelOverrun,
  detectSlowTrip,
  type AnomalyFinding,
} from './anomaly.detect';
import {
  ANOMALY_TOOL,
  anomalySystemPrompt,
  anomalyUserMessage,
  parseNarrative,
} from './anomaly.prompt';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Window the fuel, repair and breakdown detectors look back over. */
const SCAN_DAYS = 30;
/** Route durations need a longer history before a median means anything. */
const ROUTE_HISTORY_DAYS = 180;
/** The same anomaly is not reported again while it is still open. */
const REOPEN_AFTER_DAYS = 7;

const OPEN_STATUSES: AiInsightStatus[] = [AiInsightStatus.NEW, AiInsightStatus.REVIEWED];
const REPAIR_CATEGORIES = [ExpenseCategory.REPAIR, ExpenseCategory.PARTS];

/**
 * AI-4 — the nightly anomaly scan (TZ §8.5).
 *
 * The detectors in anomaly.detect.ts find and measure; this service feeds them,
 * decides what is new, and asks AI for the explanation. When AI is off, capped
 * or unreachable the insight is still stored, worded from the i18n catalogue —
 * the control does not stop working because the explanation service is down
 * (TZ §8.12 rule 5).
 */
@Injectable()
export class AnomalyService {
  private readonly logger = new Logger(AnomalyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly fuel: FuelService,
    private readonly settings: SettingsService,
    private readonly i18n: I18nService,
  ) {}

  /** Nightly, after the GPS archive job has finished. */
  @Cron('30 3 * * *')
  async scanAllCompanies(): Promise<void> {
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const company of companies) {
      try {
        await this.scan(company.id);
      } catch (error) {
        // One tenant's bad data must not stop the scan for the others.
        this.logger.error(`Anomaly scan failed for company ${company.id}`, error as Error);
      }
    }
  }

  /** Runs every detector for one company and stores what is new. */
  async scan(companyId: string, now: Date = new Date()): Promise<AiInsight[]> {
    const findings = await this.detect(companyId, now);
    const stored: AiInsight[] = [];
    for (const finding of findings) {
      if (await this.isOpen(companyId, finding, now)) continue;
      stored.push(await this.store(companyId, finding));
    }
    return stored;
  }

  async detect(companyId: string, now: Date): Promise<AnomalyFinding[]> {
    const db = this.prisma.forCompany(companyId);
    const from = new Date(now.getTime() - SCAN_DAYS * DAY_MS);
    const routeFrom = new Date(now.getTime() - ROUTE_HISTORY_DAYS * DAY_MS);

    const [thresholds, fuelRows, repairs, drivers, trips] = await Promise.all([
      this.settings.thresholds(companyId),
      // The W-8 control table is the fuel detector. This runs on a cron, so the
      // actor carries the tenant and nothing else; every query underneath it is
      // company-scoped by the extension all the same.
      this.fuel.control(
        { userId: null as unknown as string, companyId, role: 'OWNER' } as CurrentUserPayload,
        periodOf(from, now),
      ),
      db.expense.findMany({
        where: {
          category: { in: REPAIR_CATEGORIES },
          isApproved: true,
          expenseDate: { gte: from, lte: now },
        },
        select: {
          id: true,
          vehicleId: true,
          amount: true,
          description: true,
          expenseDate: true,
          vehicle: { select: { plateNumber: true } },
        },
      }),
      db.driver.findMany({
        where: { isActive: true },
        select: {
          id: true,
          fullName: true,
          _count: {
            select: {
              tripEvents: {
                where: { eventType: TripEventType.BREAKDOWN, eventTime: { gte: from, lte: now } },
              },
              trips: { where: { finishedAt: { gte: from, lte: now } } },
            },
          },
        },
      }),
      db.trip.findMany({
        where: {
          status: 'COMPLETED',
          startedAt: { not: null },
          finishedAt: { gte: routeFrom, lte: now },
        },
        select: {
          id: true,
          tripNumber: true,
          loadingAddress: true,
          unloadingAddress: true,
          startedAt: true,
          finishedAt: true,
        },
      }),
    ]);

    return [
      ...detectFuelOverrun(fuelRows, thresholds.fuelDeviationThresholdBp),
      ...detectExpensiveRepair(
        repairs
          .filter((repair) => repair.vehicleId !== null)
          .map((repair) => ({
            id: repair.id,
            vehicleId: repair.vehicleId as string,
            plateNumber: repair.vehicle?.plateNumber ?? '',
            amount: repair.amount,
            description: repair.description,
            date: repair.expenseDate,
          })),
      ),
      ...detectFrequentBreakdown(
        drivers.map((driver) => ({
          driverId: driver.id,
          driverName: driver.fullName,
          breakdowns: driver._count.tripEvents,
          trips: driver._count.trips,
        })),
      ),
      ...detectSlowTrip(
        trips
          .filter((trip) => trip.loadingAddress && trip.unloadingAddress && trip.startedAt)
          .map((trip) => ({
            tripId: trip.id,
            tripNumber: trip.tripNumber,
            route: `${trip.loadingAddress} → ${trip.unloadingAddress}`,
            hours:
              ((trip.finishedAt as Date).getTime() - (trip.startedAt as Date).getTime()) /
              3_600_000,
          })),
      ),
    ];
  }

  private async isOpen(companyId: string, finding: AnomalyFinding, now: Date): Promise<boolean> {
    const existing = await this.prisma.forCompany(companyId).aiInsight.findFirst({
      where: {
        type: finding.type,
        relatedType: finding.relatedType,
        relatedId: finding.relatedId,
        status: { in: OPEN_STATUSES },
        createdAt: { gte: new Date(now.getTime() - REOPEN_AFTER_DAYS * DAY_MS) },
      },
      select: { id: true },
    });
    return existing !== null;
  }

  private async store(companyId: string, finding: AnomalyFinding): Promise<AiInsight> {
    const locale = await this.localeOf(companyId);
    const narrative = await this.explain(companyId, finding, locale);

    return this.prisma.forCompany(companyId).aiInsight.create({
      // companyId is stamped by the tenant extension, never taken from input.
      data: {
        type: finding.type,
        severity: finding.severity as AiInsightSeverity,
        locale,
        title: narrative.title,
        description: narrative.description,
        recommendation: narrative.recommendation,
        relatedType: finding.relatedType,
        relatedId: finding.relatedId,
        estimatedLoss: finding.estimatedLoss,
        data: finding.facts as Prisma.InputJsonValue,
      } as Prisma.AiInsightUncheckedCreateInput,
    });
  }

  /**
   * The explanation, from AI when it is available and from the message
   * catalogue when it is not. Either way the insight carries the same figures.
   */
  private async explain(
    companyId: string,
    finding: AnomalyFinding,
    locale: Locale,
  ): Promise<{ title: string; description: string; recommendation: string | null }> {
    try {
      const result = await this.ai.run({
        companyId,
        feature: AiFeature.ANOMALY,
        inputType: 'system',
        inputRef: `${finding.relatedType}:${finding.relatedId}`,
        system: anomalySystemPrompt(locale),
        messages: [{ role: 'user', content: anomalyUserMessage(finding) }],
        tool: ANOMALY_TOOL,
        parse: parseNarrative,
        tier: 'smart',
        maxTokens: 700,
      });
      return result.data;
    } catch (error) {
      this.logger.warn(
        `AI explanation unavailable for ${finding.type}, falling back to the catalogue: ${
          error instanceof AppException ? error.code : String(error)
        }`,
      );
      return {
        title: this.i18n.translate(`insights.${finding.type}.title`, locale, finding.facts),
        description: this.i18n.translate(
          `insights.${finding.type}.description`,
          locale,
          finding.facts,
        ),
        recommendation: this.i18n.translate(
          `insights.${finding.type}.recommendation`,
          locale,
          finding.facts,
        ),
      };
    }
  }

  private async localeOf(companyId: string): Promise<Locale> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { locale: true },
    });
    return (company?.locale as Locale) ?? DEFAULT_LOCALE;
  }

  async list(companyId: string, status?: AiInsightStatus): Promise<AiInsight[]> {
    return this.prisma.forCompany(companyId).aiInsight.findMany({
      where: status ? { status } : { status: { in: OPEN_STATUSES } },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  /**
   * The boss's verdict on a finding. `FALSE_POSITIVE` is the important one: it
   * is how the quality of the detector gets measured (TZ §8.10).
   */
  async setStatus(
    companyId: string,
    id: string,
    status: AiInsightStatus,
    userId: string,
  ): Promise<AiInsight> {
    const db = this.prisma.forCompany(companyId);
    const insight = await db.aiInsight.findFirst({ where: { id }, select: { id: true } });
    if (!insight) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return db.aiInsight.update({
      where: { id: insight.id },
      data: { status, reviewedBy: userId, reviewedAt: new Date() },
    });
  }
}
