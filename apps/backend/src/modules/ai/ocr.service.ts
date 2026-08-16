import type { Base64ImageSource, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AiFeature } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AlertType, type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { SettingsService } from '../companies/settings.service';
import { FilesService } from '../files/files.service';
import { AiService } from './ai.service';
import {
  checkAmount,
  checkConfidence,
  checkDate,
  checkLocation,
  duplicateCheck,
  type OcrCheck,
  type TrackPoint,
} from './ocr.checks';
import { OCR_SYSTEM_PROMPT, OCR_TOOL, parseOcr, type OcrFields } from './ocr.prompt';

/** Media types AI Vision accepts; uploads are normalised to JPEG anyway. */
const VISION_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const TRACK_WINDOW_MS = 3 * 3_600_000;

export interface ReadDocumentInput {
  fileId: string;
  tripId?: string;
  vehicleId?: string;
  /** Where the phone was when the photo was taken, if it reported a position. */
  lat?: number;
  lng?: number;
}

export interface OcrProposal {
  /** ai_requests row: the handle for confirming or correcting this reading. */
  requestId: string;
  fileId: string;
  fields: OcrFields;
  /** Deterministic checks (TZ §8.3) — advisory, they never block the entry. */
  checks: OcrCheck[];
  confidenceBp: number | null;
}

/**
 * AI-2 — reading a photographed receipt or document (TZ §8.3).
 *
 * The photo goes to the model, the answer comes back validated, and then plain
 * code checks it against what the system already knows: the arithmetic on the
 * receipt, the trip dates, the vehicle's GPS trail and whether this exact photo
 * has been handed in before. The result is a *proposal*. Nothing is written to
 * fuel_logs or expenses here — the user posts the confirmed record through the
 * ordinary endpoints, which is what keeps TZ §8.0 true.
 */
@Injectable()
export class OcrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly files: FilesService,
    private readonly alerts: AlertsService,
    private readonly settings: SettingsService,
  ) {}

  async readDocument(actor: CurrentUserPayload, input: ReadDocumentInput): Promise<OcrProposal> {
    const companyId = actor.companyId as string;
    const file = await this.files.read(companyId, input.fileId);
    if (!VISION_MIMES.has(file.mimeType)) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        undefined,
        {
          mimeType: file.mimeType,
        },
      );
    }

    // The stored bytes are already downscaled to 1500px by FilesService.
    const receiptHash = createHash('sha256').update(file.body).digest('hex');
    const image: ImageBlockParam = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: file.mimeType as Base64ImageSource['media_type'],
        data: file.body.toString('base64'),
      },
    };

    const result = await this.ai.run({
      companyId,
      userId: actor.userId,
      feature: AiFeature.OCR,
      inputType: 'photo',
      inputRef: input.fileId,
      receiptHash,
      system: OCR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [image] }],
      tools: [OCR_TOOL],
      parse: parseOcr,
      confidenceBp: (fields) => fields.confidenceBp,
      maxTokens: 1500,
    });

    const checks = await this.runChecks(actor, input, result.requestId, result.data, receiptHash);
    return {
      requestId: result.requestId,
      fileId: input.fileId,
      fields: result.data,
      checks,
      confidenceBp: result.confidenceBp,
    };
  }

  /** The four TZ §8.3 checks plus the confidence floor, all in plain code. */
  private async runChecks(
    actor: CurrentUserPayload,
    input: ReadDocumentInput,
    requestId: string,
    fields: OcrFields,
    receiptHash: string,
  ): Promise<OcrCheck[]> {
    const companyId = actor.companyId as string;
    const db = this.prisma.forCompany(companyId);
    const now = new Date();

    const trip = input.tripId
      ? await db.trip.findFirst({
          where: { id: input.tripId },
          select: {
            id: true,
            vehicleId: true,
            startedAt: true,
            finishedAt: true,
            loadingDate: true,
            unloadingDate: true,
          },
        })
      : null;

    const capture =
      input.lat !== undefined && input.lng !== undefined
        ? { lat: input.lat, lng: input.lng }
        : null;
    const vehicleId = input.vehicleId ?? trip?.vehicleId ?? null;
    const track: TrackPoint[] =
      capture && vehicleId && fields.date
        ? await db.gpsTrack.findMany({
            where: {
              vehicleId,
              recordedAt: {
                gte: new Date(fields.date.getTime() - TRACK_WINDOW_MS),
                lte: new Date(fields.date.getTime() + TRACK_WINDOW_MS),
              },
            },
            select: { lat: true, lng: true, recordedAt: true },
            take: 500,
          })
        : [];

    const thresholds = await this.settings.thresholds(companyId);
    const duplicate = await this.ai.previousReceipt(companyId, receiptHash, requestId);
    if (duplicate) await this.raiseDuplicateAlert(companyId, requestId, duplicate.id);

    return [
      checkAmount(fields.litersCl, fields.pricePerLiter, fields.totalAmount),
      checkDate(fields.date, trip, now),
      checkLocation(capture, fields.date, track, thresholds.routeDeviationKm),
      checkConfidence(fields.confidenceBp),
      duplicate ? duplicateCheck(duplicate.id) : null,
    ].filter((check): check is OcrCheck => check !== null);
  }

  /** TZ §8.3: a receipt handed in twice goes to the boss straight away. */
  private async raiseDuplicateAlert(
    companyId: string,
    requestId: string,
    previousRequestId: string,
  ): Promise<void> {
    await this.alerts.raise(companyId, {
      type: AlertType.DUPLICATE_RECEIPT,
      titleKey: 'alerts.duplicateReceipt.title',
      messageKey: 'alerts.duplicateReceipt.message',
      params: { requestId, previousRequestId },
      relatedType: 'AiRequest',
      relatedId: requestId,
    });
  }
}
