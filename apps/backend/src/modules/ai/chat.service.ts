import { Injectable } from '@nestjs/common';
import { AiFeature } from '@prisma/client';
import { DEFAULT_LOCALE, type CurrentUserPayload, type Locale } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceService } from '../finance/finance.service';
import { FuelService } from '../fuel/fuel.service';
import type { ReportTable } from '../reports/report-table';
import { ReportsService } from '../reports/reports.service';
import { AiService } from './ai.service';
import { CHAT_TOOLS, parseChatCall, type ChatCall } from './chat.functions';
import {
  CHAT_ANSWER_TOOL,
  chatAnswerPrompt,
  chatResultMessage,
  chatRouterPrompt,
  parseChatAnswer,
  type ChartType,
} from './chat.prompt';

/** Rows a single answer may be built from; enough for a fleet, small enough to send. */
const MAX_ROWS = 40;

export interface ChatReply {
  answer: string;
  chart: ChartType;
  /** Which prepared query produced the figures — shown so the boss can check. */
  source: {
    function: string;
    from: string;
    to: string;
    rowCount: number;
  };
  data: unknown;
  requestIds: string[];
}

/**
 * AI-3 — the owner asks in plain language (TZ §8.4).
 *
 * Two steps, and the split is the point. First the model chooses one prepared
 * query from the whitelist and its parameters; then the system runs that query
 * itself and hands the result back for wording. The model never sees the
 * database, never writes SQL, and never produces a figure — it picks a question
 * and reads out an answer (TZ §8.12 rules 2 and 7).
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly finance: FinanceService,
    private readonly fuel: FuelService,
    private readonly reports: ReportsService,
  ) {}

  async ask(actor: CurrentUserPayload, question: string): Promise<ChatReply> {
    const companyId = actor.companyId as string;
    const locale = await this.localeOf(companyId);

    const routed = await this.ai.run<ChatCall>({
      companyId,
      userId: actor.userId,
      feature: AiFeature.CHAT,
      inputType: 'text',
      system: chatRouterPrompt(new Date()),
      messages: [{ role: 'user', content: question }],
      tools: CHAT_TOOLS,
      parse: parseChatCall,
      tier: 'smart',
      maxTokens: 400,
    });

    const call = routed.data;
    const data = await this.execute(actor, call);
    const rows = Array.isArray(data) ? data.length : 1;

    const worded = await this.ai.run({
      companyId,
      userId: actor.userId,
      feature: AiFeature.CHAT,
      inputType: 'text',
      inputRef: call.name,
      system: chatAnswerPrompt(locale),
      messages: [{ role: 'user', content: chatResultMessage(question, call, data) }],
      tools: [CHAT_ANSWER_TOOL],
      parse: parseChatAnswer,
      tier: 'smart',
      maxTokens: 800,
    });

    return {
      answer: worded.data.answer,
      chart: worded.data.chart,
      source: {
        function: call.name,
        from: call.period.fromDate.toISOString(),
        to: call.period.toDate.toISOString(),
        rowCount: rows,
      },
      data,
      requestIds: [routed.requestId, worded.requestId],
    };
  }

  /**
   * Runs the chosen query. Every branch calls an ordinary service the panel
   * uses too, so an answer can never contain a figure the screens would not.
   */
  private async execute(actor: CurrentUserPayload, call: ChatCall): Promise<unknown> {
    switch (call.name) {
      case 'get_vehicle_profit': {
        const rows = await this.finance.fleetEconomics(actor, call.period);
        return this.narrow(rows, call.subject, (row) => row.plateNumber);
      }
      case 'get_fuel_anomalies': {
        const rows = await this.fuel.control(actor, call.period);
        return this.narrow(rows, call.subject, (row) => row.plateNumber);
      }
      case 'get_driver_stats': {
        const table = await this.reports.table(actor, 'drivers', call.period);
        return this.narrowTable(table, call.subject);
      }
      case 'get_route_profitability': {
        const table = await this.reports.table(actor, 'routes', call.period);
        return this.narrowTable(table, call.subject);
      }
      case 'get_receivables': {
        const rows = await this.finance.receivables(actor);
        const wanted = call.status?.toLowerCase();
        const filtered =
          wanted === 'overdue'
            ? rows.filter((row) => row.overdue > 0n)
            : wanted === 'pending'
              ? rows.filter((row) => row.pending > 0n)
              : rows;
        return filtered.slice(0, MAX_ROWS);
      }
      case 'compare_periods': {
        const [first, second] = await Promise.all([
          this.finance.summary(actor, call.period),
          this.finance.summary(actor, call.comparePeriod ?? call.period),
        ]);
        // Both totals are handed over whole; the difference is the model's to
        // describe, not to compute — it reads two numbers that are already right.
        return { metric: call.metric, first, second };
      }
    }
  }

  /** Keeps the rows the question was about, or the first few if it named none. */
  private narrow<T>(rows: T[], subject: string | undefined, label: (row: T) => string): T[] {
    if (!subject) return rows.slice(0, MAX_ROWS);
    const needle = subject.toLowerCase();
    const matching = rows.filter((row) => label(row).toLowerCase().includes(needle));
    // A name the model misheard must not silently turn into "no data".
    return (matching.length > 0 ? matching : rows).slice(0, MAX_ROWS);
  }

  /** The first column of a report row is its name — driver, route, client. */
  private narrowTable(table: ReportTable, subject: string | undefined): ReportTable {
    const nameKey = table.columns[0]?.key ?? '';
    return {
      ...table,
      rows: this.narrow(table.rows, subject, (row) => String(row[nameKey] ?? '')),
    };
  }

  private async localeOf(companyId: string): Promise<Locale> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { locale: true },
    });
    return (company?.locale as Locale) ?? DEFAULT_LOCALE;
  }
}
