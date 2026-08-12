import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { AiClientService } from './ai-client.service';
import { AnalyzeReceiptDto, ConfirmOcrDto } from './dto/ocr.dto';

/** What the AI is asked to extract from a photo (TZ §8.3 table). */
export interface OcrProposal {
  docType: 'FUEL_RECEIPT' | 'TTN' | 'CMR' | 'CUSTOMS' | 'REPAIR' | 'FINE' | 'ODOMETER' | 'OTHER';
  stationName: string | null;
  liters: number | null;
  pricePerLiterSom: number | null;
  totalAmountSom: number | null;
  documentDate: string | null;
  odometer: number | null;
  description: string | null;
  confidence: number;
}

export interface OcrChecks {
  /** total ≈ liters × price within ±1% (TZ §8.3); null when inputs are missing. */
  amountMatches: boolean | null;
  /** Document date inside the trip window; null when unknown. */
  dateInTripWindow: boolean | null;
  /** Same photo was already processed — fraud signal. */
  duplicateReceipt: boolean;
}

export interface OcrAnalysis {
  requestId: string;
  proposal: OcrProposal;
  checks: OcrChecks;
}

const OCR_PROMPT = `You are reading a photo of a logistics document from Uzbekistan (fuel station receipt, TTN/CMR waybill, customs payment, repair invoice, fine, or an odometer photo). Text may be in Uzbek or Russian.

Return ONLY a JSON object, no prose, with exactly these keys:
{
  "docType": "FUEL_RECEIPT" | "TTN" | "CMR" | "CUSTOMS" | "REPAIR" | "FINE" | "ODOMETER" | "OTHER",
  "stationName": string | null,      // fuel station / organization name
  "liters": number | null,           // fuel volume in liters
  "pricePerLiterSom": number | null, // price per liter in UZS so'm
  "totalAmountSom": number | null,   // total amount in UZS so'm
  "documentDate": string | null,     // ISO 8601 date or datetime from the document
  "odometer": number | null,         // odometer reading in km, if visible
  "description": string | null,      // short human summary (goods, reason, etc.)
  "confidence": number               // 0..1 — your confidence in the extraction
}
Use null when a value is not present or unreadable. Never invent numbers.`;

function parseProposal(text: string): OcrProposal {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new AppException('AI_PARSE_FAILED', HttpStatus.UNPROCESSABLE_ENTITY);
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new AppException('AI_PARSE_FAILED', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  // AI output is validated like any external input (CLAUDE.md rule).
  const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 300) : null;
  const docTypes = ['FUEL_RECEIPT', 'TTN', 'CMR', 'CUSTOMS', 'REPAIR', 'FINE', 'ODOMETER', 'OTHER'];
  const docType = docTypes.includes(raw.docType as string)
    ? (raw.docType as OcrProposal['docType'])
    : 'OTHER';
  const confidenceRaw = num(raw.confidence);

  return {
    docType,
    stationName: str(raw.stationName),
    liters: num(raw.liters),
    pricePerLiterSom: num(raw.pricePerLiterSom),
    totalAmountSom: num(raw.totalAmountSom),
    documentDate: str(raw.documentDate),
    odometer: num(raw.odometer),
    description: str(raw.description),
    confidence: confidenceRaw === null ? 0 : Math.min(confidenceRaw, 1),
  };
}

/** total ≈ liters × price within ±1% (TZ §8.3). */
export function amountMatches(proposal: {
  liters: number | null;
  pricePerLiterSom: number | null;
  totalAmountSom: number | null;
}): boolean | null {
  if (!proposal.liters || !proposal.pricePerLiterSom || !proposal.totalAmountSom) return null;
  const expected = proposal.liters * proposal.pricePerLiterSom;
  return Math.abs(expected - proposal.totalAmountSom) <= proposal.totalAmountSom * 0.01;
}

const somToTiyin = (som: number): bigint => BigInt(Math.round(som * 100));

const DOC_TYPE_TO_CATEGORY: Record<string, string> = {
  FUEL_RECEIPT: 'FUEL',
  CUSTOMS: 'CUSTOMS',
  REPAIR: 'REPAIR',
  FINE: 'FINE',
};

/**
 * AI-2 (TZ §8.3): photo → structured proposal + deterministic auto-checks.
 * The AI NEVER writes business records — `analyze` only logs the AI request;
 * an expense/fuel row appears exclusively via human `confirm` (TZ §8.12.1).
 */
@Injectable()
export class OcrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClientService,
    private readonly files: FilesService,
  ) {}

  async analyze(actor: CurrentUserPayload, dto: AnalyzeReceiptDto): Promise<OcrAnalysis> {
    const db = this.prisma.forCompany(actor.companyId);
    const settings = await db.aiSettings.findFirst();
    if (settings && !settings.ocrEnabled) {
      throw new AppException('AI_DISABLED', HttpStatus.FORBIDDEN);
    }
    await this.enforceMonthlyLimit(actor, settings ? Number(settings.monthlyAiLimitUsd) : 50);

    const file = await db.storedFile.findUnique({ where: { id: dto.fileId } });
    if (!file) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    if (!file.mimeType.startsWith('image/')) {
      throw new AppException('FILE_TYPE_NOT_ALLOWED', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }

    const buffer = await this.files.getObjectBuffer(file.key);
    const receiptHash = createHash('sha256').update(buffer).digest('hex');
    const duplicate = await db.aiRequest.findFirst({
      where: { feature: 'ocr', receiptHash },
    });

    const result = await this.aiClient.vision(
      OCR_PROMPT,
      buffer.toString('base64'),
      file.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
    );
    const proposal = parseProposal(result.text);

    const checks: OcrChecks = {
      amountMatches: amountMatches(proposal),
      dateInTripWindow: await this.checkDateInTrip(actor, dto.tripId, proposal.documentDate),
      duplicateReceipt: duplicate !== null,
    };

    const request = await db.aiRequest.create({
      data: {
        companyId: actor.companyId as string,
        userId: actor.userId,
        feature: 'ocr',
        inputType: 'photo',
        inputRef: dto.fileId,
        modelUsed: result.model,
        promptTokens: result.inputTokens,
        completionTokens: result.outputTokens,
        costUsd: result.costUsd,
        responseJson: proposal as unknown as Prisma.InputJsonValue,
        confidence: proposal.confidence,
        receiptHash,
        latencyMs: result.latencyMs,
      },
    });

    return { requestId: request.id, proposal, checks };
  }

  /** Human approval turns the proposal (+ corrections) into a real record. */
  async confirm(
    actor: CurrentUserPayload,
    requestId: string,
    dto: ConfirmOcrDto,
  ): Promise<{ createdType: 'EXPENSE' | 'FUEL'; createdId: string }> {
    const db = this.prisma.forCompany(actor.companyId);
    const request = await db.aiRequest.findUnique({ where: { id: requestId } });
    if (!request || request.feature !== 'ocr') {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    if (request.isConfirmed) {
      throw new AppException('ALREADY_EXISTS', HttpStatus.CONFLICT);
    }

    const proposal = {
      ...(request.responseJson as unknown as OcrProposal),
      ...(dto.corrections ?? {}),
    } as OcrProposal;

    let createdId: string;
    if (dto.target === 'FUEL') {
      if (!dto.vehicleId || !proposal.liters) {
        throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST);
      }
      const fuelLog = await db.fuelLog.create({
        data: {
          companyId: actor.companyId as string,
          vehicleId: dto.vehicleId,
          tripId: dto.tripId,
          driverId: dto.driverId,
          liters: proposal.liters,
          pricePerLiter: proposal.pricePerLiterSom ? somToTiyin(proposal.pricePerLiterSom) : null,
          totalAmount: proposal.totalAmountSom ? somToTiyin(proposal.totalAmountSom) : null,
          stationName: proposal.stationName,
          odometer: proposal.odometer,
          receiptPhoto: request.inputRef,
          refuelTime: proposal.documentDate ? new Date(proposal.documentDate) : new Date(),
        } as Prisma.FuelLogUncheckedCreateInput,
      });
      createdId = fuelLog.id;
    } else {
      if (!proposal.totalAmountSom) {
        throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST);
      }
      const expense = await db.expense.create({
        data: {
          companyId: actor.companyId as string,
          tripId: dto.tripId,
          vehicleId: dto.vehicleId,
          driverId: dto.driverId,
          category: (DOC_TYPE_TO_CATEGORY[proposal.docType] ?? 'OTHER') as never,
          amount: somToTiyin(proposal.totalAmountSom),
          quantity: proposal.liters,
          unitPrice: proposal.pricePerLiterSom ? somToTiyin(proposal.pricePerLiterSom) : null,
          description: proposal.description,
          receiptPhoto: request.inputRef,
          expenseDate: proposal.documentDate ? new Date(proposal.documentDate) : new Date(),
          createdById: actor.userId,
        } as Prisma.ExpenseUncheckedCreateInput,
      });
      createdId = expense.id;
    }

    await db.aiRequest.update({
      where: { id: requestId },
      data: {
        isConfirmed: true,
        confirmedById: actor.userId,
        correctedData: dto.corrections ? (dto.corrections as Prisma.InputJsonValue) : undefined,
      },
    });

    return { createdType: dto.target, createdId };
  }

  /** Monthly AI spend and limit — W-11 / AI-8 material. */
  async usage(actor: CurrentUserPayload): Promise<{
    monthUsd: number;
    limitUsd: number;
    requestCount: number;
    byFeature: Record<string, number>;
  }> {
    const db = this.prisma.forCompany(actor.companyId);
    const settings = await db.aiSettings.findFirst();
    const rows = await db.aiRequest.findMany({
      where: { createdAt: { gte: monthStart() } },
      select: { feature: true, costUsd: true },
    });
    const byFeature: Record<string, number> = {};
    let monthUsd = 0;
    for (const row of rows) {
      const cost = Number(row.costUsd);
      monthUsd += cost;
      byFeature[row.feature] = (byFeature[row.feature] ?? 0) + cost;
    }
    return {
      monthUsd: round6(monthUsd),
      limitUsd: settings ? Number(settings.monthlyAiLimitUsd) : 50,
      requestCount: rows.length,
      byFeature,
    };
  }

  /** TZ §8.11: past the limit the company drops to manual mode until next month. */
  private async enforceMonthlyLimit(actor: CurrentUserPayload, limitUsd: number): Promise<void> {
    const rows = await this.prisma.forCompany(actor.companyId).aiRequest.findMany({
      where: { createdAt: { gte: monthStart() } },
      select: { costUsd: true },
    });
    const spent = rows.reduce((acc, row) => acc + Number(row.costUsd), 0);
    if (spent >= limitUsd) {
      throw new AppException('AI_LIMIT_EXCEEDED', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async checkDateInTrip(
    actor: CurrentUserPayload,
    tripId: string | undefined,
    documentDate: string | null,
  ): Promise<boolean | null> {
    if (!tripId || !documentDate) return null;
    const trip = await this.prisma.forCompany(actor.companyId).trip.findUnique({
      where: { id: tripId },
    });
    if (!trip) return null;
    const date = new Date(documentDate);
    if (Number.isNaN(date.getTime())) return null;
    const from = trip.startedAt ?? trip.loadingDate;
    const to = trip.finishedAt ?? trip.unloadingDate ?? new Date();
    if (!from) return null;
    return date >= from && date <= to;
  }
}

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
