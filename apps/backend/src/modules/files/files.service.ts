import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { StoredFile } from '@prisma/client';
import * as Minio from 'minio';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';

/** Photos are downscaled before storage — 1500px is enough for OCR (TZ §8.3). */
const MAX_IMAGE_DIMENSION = 1500;
const SIGNED_URL_TTL_SECONDS = 15 * 60;

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Voice notes from the driver app (TZ §8.2); kept for 30 days, then deleted. */
const AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/ogg',
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
]);
const ALLOWED_MIMES = new Set([...IMAGE_MIMES, ...AUDIO_MIMES, 'application/pdf']);

/** TZ §8.2: a voice note is evidence in a dispute, but only for a month. */
export const AUDIO_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function extensionFor(mimeType: string): string {
  if (mimeType === 'application/pdf') return '.pdf';
  return AUDIO_MIMES.has(mimeType) ? '.audio' : '.jpg';
}

export interface UploadedFileInput {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly client: Minio.Client;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.bucket = config.get<string>('MINIO_BUCKET') ?? 'truckcontrol';
    this.client = new Minio.Client({
      endPoint: config.get<string>('MINIO_ENDPOINT') ?? 'localhost',
      port: Number(config.get<string>('MINIO_PORT') ?? 9000),
      useSSL: config.get<string>('MINIO_USE_SSL') === 'true',
      accessKey: config.get<string>('MINIO_ROOT_USER') ?? 'truckcontrol',
      secretKey: config.get<string>('MINIO_ROOT_PASSWORD') ?? '',
    });
  }

  async upload(actor: CurrentUserPayload, file: UploadedFileInput): Promise<StoredFile> {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        undefined,
        {
          mimeType: file.mimetype,
        },
      );
    }

    let body = file.buffer;
    let mimeType = file.mimetype;
    if (IMAGE_MIMES.has(file.mimetype)) {
      body = await sharp(file.buffer)
        .rotate() // respect EXIF orientation
        .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82 })
        .toBuffer();
      mimeType = 'image/jpeg';
    }

    // Object keys are tenant-prefixed so bucket listings can never cross companies.
    const key = `${actor.companyId}/${randomUUID()}${extensionFor(mimeType)}`;
    await this.ensureBucket();
    await this.client.putObject(this.bucket, key, body, body.length, {
      'Content-Type': mimeType,
    });

    return this.prisma.forCompany(actor.companyId).storedFile.create({
      data: {
        companyId: actor.companyId as string,
        key,
        mimeType,
        size: body.length,
        originalName: file.originalname,
        createdById: actor.userId,
        expiresAt: AUDIO_MIMES.has(mimeType)
          ? new Date(Date.now() + AUDIO_RETENTION_DAYS * MS_PER_DAY)
          : null,
      },
    });
  }

  /**
   * Deletes files whose retention has run out — voice notes, today (TZ §8.2).
   *
   * Runs across every tenant, so it uses the bare client on purpose: this is a
   * platform job, not a request, and `expires_at` is what scopes it. The row is
   * removed only once the object is gone, so a failed delete is retried
   * tomorrow instead of leaving an orphan in the bucket.
   */
  @Cron('15 3 * * *')
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.storedFile.findMany({
      where: { expiresAt: { not: null, lte: now } },
      select: { id: true, key: true },
      take: 500,
    });

    let purged = 0;
    for (const file of expired) {
      try {
        await this.client.removeObject(this.bucket, file.key);
        await this.prisma.storedFile.delete({ where: { id: file.id } });
        purged += 1;
      } catch (error) {
        this.logger.warn(
          `Could not purge ${file.key}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return purged;
  }

  /**
   * Raw bytes of a stored file, for server-side processing such as AI Vision.
   * The tenant-scoped lookup is what keeps one company's photos out of another's
   * request — the object key alone is never trusted.
   */
  async read(companyId: string, id: string): Promise<{ body: Buffer; mimeType: string }> {
    const file = await this.prisma.forCompany(companyId).storedFile.findUnique({ where: { id } });
    if (!file) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    try {
      const stream = await this.client.getObject(this.bucket, file.key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return { body: Buffer.concat(chunks), mimeType: file.mimeType };
    } catch (error) {
      this.logger.error(
        `MinIO read failed for ${file.key}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new AppException('INTERNAL_ERROR', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** Short-lived signed URL; the tenant-scoped lookup guards cross-company access. */
  async getSignedUrl(
    actor: CurrentUserPayload,
    id: string,
  ): Promise<{ url: string; expiresIn: number }> {
    const file = await this.prisma
      .forCompany(actor.companyId)
      .storedFile.findUnique({ where: { id } });
    if (!file) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    const url = await this.client.presignedGetObject(this.bucket, file.key, SIGNED_URL_TTL_SECONDS);
    return { url, expiresIn: SIGNED_URL_TTL_SECONDS };
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) await this.client.makeBucket(this.bucket);
      this.bucketReady = true;
    } catch (error) {
      this.logger.error(
        `MinIO bucket check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new AppException('INTERNAL_ERROR', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
