import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
const ALLOWED_MIMES = new Set([...IMAGE_MIMES, 'application/pdf']);

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
    const key = `${actor.companyId}/${randomUUID()}${mimeType === 'application/pdf' ? '.pdf' : '.jpg'}`;
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
      },
    });
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

  /** Raw object bytes (tenant checked by the caller's scoped lookup) — OCR input. */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
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
