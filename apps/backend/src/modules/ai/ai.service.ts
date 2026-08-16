import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AiFeature,
  AiRequestStatus,
  type AiRequest,
  type AiSettings,
  Prisma,
} from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClient, type AiToolSpec } from './ai.client';
import { AI_MODELS, type AiModelTier, costMicroUsd, usageMonthOf } from './ai.pricing';

/** Per-feature switches a company can turn off (TZ §8.10 ai_settings). */
const FEATURE_TOGGLE: Partial<Record<AiFeature, keyof AiSettings>> = {
  [AiFeature.VOICE]: 'voiceEnabled',
  [AiFeature.OCR]: 'ocrEnabled',
  [AiFeature.CHAT]: 'chatEnabled',
  [AiFeature.ANOMALY]: 'anomalyEnabled',
};

const DEFAULT_LIMIT_MICRO_USD = 50_000_000n;
const DEFAULT_MAX_TOKENS = 1024;

export interface AiRunOptions<T> {
  companyId: string;
  userId?: string | null;
  feature: AiFeature;
  /** "photo" | "text" | "audio" | "system" — what was handed to the model. */
  inputType: string;
  /** File key or entity id the input came from; never the payload itself. */
  inputRef?: string | null;
  system: string;
  messages: MessageParam[];
  /** Every tool the model may call; with one entry it is forced to call it. */
  tools: AiToolSpec[];
  /**
   * Turns the chosen tool and its raw input into a domain object, rejecting
   * anything it does not recognise (see ai.validation.ts). Runs before the
   * value is returned, so nothing unvalidated ever leaves this service.
   */
  parse: (raw: unknown, toolName: string) => T;
  tier?: AiModelTier;
  maxTokens?: number;
  /** Model self-reported confidence, in basis points, for the accuracy report. */
  confidenceBp?: (value: T) => number | null;
  /** SHA-256 of a photographed document, for the duplicate-receipt check. */
  receiptHash?: string | null;
}

export interface AiRunResult<T> {
  /** Row in `ai_requests` — the handle a person later confirms or corrects. */
  requestId: string;
  data: T;
  confidenceBp: number | null;
  costMicroUsd: bigint;
}

export interface AiUsage {
  month: string;
  usedMicroUsd: bigint;
  limitMicroUsd: bigint;
  /** True once the cap is reached: AI stops, manual entry keeps working. */
  exhausted: boolean;
}

/**
 * The single door to the model (TZ §8).
 *
 * Every AI feature goes through `run()`, which enforces the rules that make AI
 * safe here: the feature must be switched on, the company must be inside its
 * monthly spend cap, the answer must validate, and the result is logged as a
 * *proposal* — `is_confirmed` stays false until a person accepts it. This
 * service writes to `ai_requests`/`ai_settings` only; no AI output ever reaches
 * a business table without passing through a controller a human drove.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: AiClient,
  ) {}

  /** Whether a key is configured at all — endpoints use it to degrade politely. */
  get available(): boolean {
    return this.client.configured;
  }

  async usage(companyId: string, now: Date = new Date()): Promise<AiUsage> {
    const settings = await this.prisma.forCompany(companyId).aiSettings.findFirst();
    return this.usageOf(settings, now);
  }

  private usageOf(settings: AiSettings | null, now: Date): AiUsage {
    const month = usageMonthOf(now);
    const limit = settings?.monthlyLimitMicroUsd ?? DEFAULT_LIMIT_MICRO_USD;
    // A stale month means last month's spend: this month starts at zero.
    const used = settings && settings.usageMonth === month ? settings.currentUsageMicroUsd : 0n;
    return { month, usedMicroUsd: used, limitMicroUsd: limit, exhausted: used >= limit };
  }

  private assertAllowed(feature: AiFeature, settings: AiSettings | null, usage: AiUsage): void {
    if (!this.client.configured) {
      throw new AppException('AI_NOT_CONFIGURED', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const toggle = FEATURE_TOGGLE[feature];
    if (settings && toggle && settings[toggle] === false) {
      throw new AppException('AI_FEATURE_DISABLED', HttpStatus.FORBIDDEN, { feature });
    }
    if (usage.exhausted) {
      throw new AppException('AI_LIMIT_REACHED', HttpStatus.TOO_MANY_REQUESTS, {
        month: usage.month,
      });
    }
  }

  /**
   * Runs one model call end to end: guard → call → validate → log → charge.
   * Tokens spent are charged even when validation rejects the answer, otherwise
   * a model stuck producing garbage would run outside the cap.
   */
  async run<T>(options: AiRunOptions<T>): Promise<AiRunResult<T>> {
    const now = new Date();
    const db = this.prisma.forCompany(options.companyId);
    const settings = await db.aiSettings.findFirst();
    const usage = this.usageOf(settings, now);
    this.assertAllowed(options.feature, settings, usage);

    const model = AI_MODELS[options.tier ?? 'cheap'];
    const started = Date.now();

    let raw;
    try {
      raw = await this.client.complete({
        model,
        system: options.system,
        messages: options.messages,
        tools: options.tools,
        forceTool: options.tools.length === 1 ? options.tools[0]?.name : undefined,
        maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      });
    } catch (error) {
      await this.logFailure(options, model, Date.now() - started, error);
      throw error;
    }

    const cost = costMicroUsd(model, raw.promptTokens, raw.completionTokens);
    const latencyMs = Date.now() - started;

    let data: T;
    try {
      data = options.parse(raw.json, raw.toolName);
    } catch (error) {
      await this.charge(options.companyId, cost, now);
      await this.logFailure(options, model, latencyMs, error, raw, cost);
      throw error;
    }

    const confidence = options.confidenceBp?.(data) ?? null;
    const request = await db.aiRequest.create({
      // companyId is stamped by the tenant extension, never taken from input.
      data: {
        userId: options.userId ?? null,
        feature: options.feature,
        inputType: options.inputType,
        inputRef: options.inputRef ?? null,
        modelUsed: model,
        promptTokens: raw.promptTokens,
        completionTokens: raw.completionTokens,
        costMicroUsd: cost,
        responseJson: raw.json as Prisma.InputJsonValue,
        confidenceBp: confidence,
        status: AiRequestStatus.SUCCEEDED,
        receiptHash: options.receiptHash ?? null,
        latencyMs,
      } as Prisma.AiRequestUncheckedCreateInput,
    });
    await this.charge(options.companyId, cost, now);

    return { requestId: request.id, data, confidenceBp: confidence, costMicroUsd: cost };
  }

  /**
   * Marks a proposal as accepted by a person (TZ §8.0). `correctedData` keeps
   * what the user changed, which is how OCR accuracy is measured later (§8.12).
   */
  async confirm(
    companyId: string,
    requestId: string,
    userId: string,
    correctedData?: unknown,
  ): Promise<AiRequest> {
    const db = this.prisma.forCompany(companyId);
    const request = await db.aiRequest.findFirst({ where: { id: requestId } });
    if (!request) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return db.aiRequest.update({
      where: { id: request.id },
      data: {
        isConfirmed: true,
        confirmedBy: userId,
        confirmedAt: new Date(),
        correctedData: (correctedData ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * An earlier reading of the very same photo that a person already accepted —
   * i.e. the receipt is being handed in twice (TZ §8.3).
   */
  async previousReceipt(
    companyId: string,
    receiptHash: string,
    excludeRequestId: string,
  ): Promise<AiRequest | null> {
    return this.prisma.forCompany(companyId).aiRequest.findFirst({
      where: { receiptHash, isConfirmed: true, id: { not: excludeRequestId } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Adds the spend of one call to the running month, rolling the bucket over. */
  private async charge(companyId: string, cost: bigint, now: Date): Promise<void> {
    if (cost <= 0n) return;
    const month = usageMonthOf(now);
    const db = this.prisma.forCompany(companyId);
    const settings = await db.aiSettings.findFirst({ select: { id: true, usageMonth: true } });
    if (!settings) {
      await db.aiSettings.create({
        data: {
          usageMonth: month,
          currentUsageMicroUsd: cost,
        } as Prisma.AiSettingsUncheckedCreateInput,
      });
      return;
    }
    await db.aiSettings.update({
      where: { id: settings.id },
      data:
        settings.usageMonth === month
          ? { currentUsageMicroUsd: { increment: cost } }
          : { usageMonth: month, currentUsageMicroUsd: cost },
    });
  }

  /**
   * Records a failed call. The log must survive even when the model is down, so
   * a logging error is reported and dropped rather than masking the real one.
   */
  private async logFailure<T>(
    options: AiRunOptions<T>,
    model: string,
    latencyMs: number,
    error: unknown,
    raw?: { json: unknown; promptTokens: number; completionTokens: number },
    cost = 0n,
  ): Promise<void> {
    const errorCode = error instanceof AppException ? error.code : 'INTERNAL_ERROR';
    try {
      await this.prisma.forCompany(options.companyId).aiRequest.create({
        data: {
          userId: options.userId ?? null,
          feature: options.feature,
          inputType: options.inputType,
          inputRef: options.inputRef ?? null,
          modelUsed: model,
          promptTokens: raw?.promptTokens ?? 0,
          completionTokens: raw?.completionTokens ?? 0,
          costMicroUsd: cost,
          responseJson: (raw?.json ?? Prisma.DbNull) as Prisma.InputJsonValue,
          status: AiRequestStatus.FAILED,
          errorCode,
          latencyMs,
        } as Prisma.AiRequestUncheckedCreateInput,
      });
    } catch (logError) {
      this.logger.error('Could not write the ai_requests row', logError as Error);
    }
  }
}
