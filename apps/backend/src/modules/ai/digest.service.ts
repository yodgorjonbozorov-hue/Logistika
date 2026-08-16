import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AiFeature, AiInsightStatus } from '@prisma/client';
import { DEFAULT_LOCALE, type CurrentUserPayload, type Locale } from 'shared';
import { I18nService } from '../../i18n/i18n.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../companies/settings.service';
import { DocumentsService } from '../documents/documents.service';
import { FinanceService } from '../finance/finance.service';
import { periodOf } from '../finance/dto/finance.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../notifications/telegram.service';
import { AiService } from './ai.service';
import {
  digestHour,
  isQuietDay,
  localDayBounds,
  localHour,
  type DigestFacts,
} from './digest.facts';
import { DIGEST_TOOL, digestSystemPrompt, digestUserMessage, parseDigest } from './digest.prompt';

const DOCUMENT_WARNING_DAYS = 7;
const MAX_ATTENTION_ITEMS = 5;

/**
 * AI-8 — one message a day to the owner's Telegram (TZ §8.9).
 *
 * The cron wakes hourly and sends to the companies whose own digest hour has
 * just arrived in their own zone, so «20:00» means 20:00 where the owner is.
 * The figures are counted here; AI only turns them into a message, and when it
 * cannot, the catalogue sentence goes out instead — a digest that skips itself
 * because the model is down is worse than a plain one.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly finance: FinanceService,
    private readonly documents: DocumentsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
    private readonly i18n: I18nService,
  ) {}

  @Cron('0 * * * *')
  async sendDueDigests(now: Date = new Date()): Promise<void> {
    if (!this.telegram.configured) return;

    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true, timezone: true },
    });

    for (const company of companies) {
      try {
        const thresholds = await this.settings.thresholds(company.id);
        if (localHour(now, company.timezone) !== digestHour(thresholds.digestTime)) continue;
        await this.sendDigest(company.id, now);
      } catch (error) {
        // One company's failure must not silence every company after it.
        this.logger.error(`Daily digest failed for company ${company.id}`, error as Error);
      }
    }
  }

  /** Builds and sends one company's digest. Returns how many chats got it. */
  async sendDigest(companyId: string, now: Date = new Date()): Promise<number> {
    const chats = await this.notifications.digestRecipients(companyId);
    if (chats.length === 0) return 0;

    const facts = await this.collect(companyId, now);
    if (isQuietDay(facts)) return 0;

    const message = await this.compose(companyId, facts);
    let sent = 0;
    for (const chat of chats) {
      if (await this.telegram.send(chat, message)) sent += 1;
    }
    return sent;
  }

  /** The day's figures, all counted by ordinary queries (TZ §8.12 rule 7). */
  async collect(companyId: string, now: Date): Promise<DigestFacts> {
    const db = this.prisma.forCompany(companyId);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    const day = localDayBounds(now, company?.timezone ?? 'UTC');
    const tomorrow = { from: day.to, to: new Date(day.to.getTime() + 24 * 60 * 60 * 1000) };
    const actor = {
      userId: null as unknown as string,
      companyId,
      role: 'OWNER',
    } as CurrentUserPayload;

    const [onRoad, vehiclesTotal, finished, started, totals, loadings, expiring, insights] =
      await Promise.all([
        db.trip.findMany({ where: { status: 'IN_PROGRESS' }, select: { vehicleId: true } }),
        db.vehicle.count({ where: { isActive: true, type: { not: 'TRAILER' } } }),
        db.trip.count({
          where: { status: 'COMPLETED', finishedAt: { gte: day.from, lt: day.to } },
        }),
        db.trip.count({ where: { startedAt: { gte: day.from, lt: day.to } } }),
        this.finance.summary(actor, periodOf(day.from, day.to)),
        db.trip.count({ where: { loadingDate: { gte: tomorrow.from, lt: tomorrow.to } } }),
        this.documents.expiring(actor, DOCUMENT_WARNING_DAYS, now),
        db.aiInsight.findMany({
          where: { status: { in: [AiInsightStatus.NEW, AiInsightStatus.REVIEWED] } },
          orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
          take: MAX_ATTENTION_ITEMS,
          select: { title: true, description: true },
        }),
      ]);

    return {
      date: day.date,
      vehiclesOnRoad: new Set(onRoad.map((trip) => trip.vehicleId).filter(Boolean)).size,
      vehiclesTotal,
      tripsFinished: finished,
      tripsStarted: started,
      revenueToday: totals.revenue,
      expensesToday: totals.cost,
      profitToday: totals.profit,
      attention: insights.map((insight) => ({
        title: insight.title,
        detail: insight.description,
      })),
      loadingsTomorrow: loadings,
      documentsExpiringSoon: expiring.length,
    };
  }

  /** AI wording when it is available, the catalogue sentence when it is not. */
  private async compose(companyId: string, facts: DigestFacts): Promise<string> {
    const locale = await this.localeOf(companyId);
    try {
      const result = await this.ai.run({
        companyId,
        feature: AiFeature.DIGEST,
        inputType: 'system',
        inputRef: facts.date,
        system: digestSystemPrompt(locale),
        messages: [{ role: 'user', content: digestUserMessage(facts) }],
        tools: [DIGEST_TOOL],
        parse: parseDigest,
        maxTokens: 600,
      });
      return result.data.message;
    } catch (error) {
      this.logger.warn(
        `AI wording unavailable for the digest, sending the plain one: ${String(error)}`,
      );
      return this.plainDigest(facts, locale);
    }
  }

  /** The same figures, laid out from the message catalogue. */
  private plainDigest(facts: DigestFacts, locale: Locale): string {
    const som = (tiyin: bigint) => (tiyin / 100n).toString();
    const lines = [
      this.i18n.translate('digest.title', locale, { date: facts.date }),
      this.i18n.translate('digest.fleet', locale, {
        onRoad: facts.vehiclesOnRoad,
        total: facts.vehiclesTotal,
        finished: facts.tripsFinished,
        started: facts.tripsStarted,
      }),
      this.i18n.translate('digest.money', locale, {
        revenue: som(facts.revenueToday),
        expenses: som(facts.expensesToday),
        profit: som(facts.profitToday),
      }),
    ];
    if (facts.attention.length > 0) {
      lines.push(
        this.i18n.translate('digest.attention', locale, { count: facts.attention.length }),
        ...facts.attention.map((item) => `• ${item.title}`),
      );
    }
    if (facts.loadingsTomorrow > 0 || facts.documentsExpiringSoon > 0) {
      lines.push(
        this.i18n.translate('digest.tomorrow', locale, {
          loadings: facts.loadingsTomorrow,
          documents: facts.documentsExpiringSoon,
        }),
      );
    }
    return lines.join('\n');
  }

  private async localeOf(companyId: string): Promise<Locale> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { locale: true },
    });
    return (company?.locale as Locale) ?? DEFAULT_LOCALE;
  }
}
