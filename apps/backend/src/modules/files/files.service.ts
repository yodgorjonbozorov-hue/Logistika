import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StoredFile } from '@prisma/client';
import * as Minio from 'minio';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import {
  detectFileType,
  EXTENSION_BY_TYPE,
  sanitizeOriginalName,
  type DetectedType,
} from './file-type';

/** Photos are downscaled before storage — 1500px is enough for OCR (TZ §8.3). */
const MAX_IMAGE_DIMENSION = 1500;
const SIGNED_URL_TTL_SECONDS = 15 * 60;

const IMAGE_TYPES: ReadonlySet<DetectedType> = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface UploadedFileInput {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

@Injectable()
export class FilesService implements OnModuleInit {
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
      // The config schema coerces this to a real boolean, so the old
      // `=== 'true'` string comparison was ALWAYS false — TLS would have been
      // silently off against a remote object store, sending the access key in
      // cleartext. Accept both shapes and default to off only when unset.
      useSSL:
        config.get<boolean | string>('MINIO_USE_SSL') === true ||
        config.get<boolean | string>('MINIO_USE_SSL') === 'true',
      accessKey: config.get<string>('MINIO_ROOT_USER') ?? 'truckcontrol',
      secretKey: config.get<string>('MINIO_ROOT_PASSWORD') ?? '',
    });
  }

  /**
   * Provision the bucket at boot rather than on the first upload.
   *
   * Lazily creating it meant a freshly deployed instance reported "storage
   * down" on the readiness probe until somebody happened to upload a photo.
   * A failure here is logged, not fatal: the API is still useful without
   * uploads, and readiness will keep saying so until storage recovers.
   */
  async onModuleInit(): Promise<void> {
    await this.ensureBucket().catch((error: unknown) => {
      this.logger.warn(
        `Object storage not ready at boot: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async upload(actor: CurrentUserPayload, file: UploadedFileInput): Promise<StoredFile> {
    // M-10: the whitelist is checked against the SNIFFED type, never against
    // the client-declared Content-Type, which is free text an attacker picks.
    const detected = detectFileType(file.buffer);
    if (!detected) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        undefined,
        { declared: file.mimetype },
      );
    }

    let body = file.buffer;
    let mimeType: DetectedType = detected;
    if (IMAGE_TYPES.has(detected)) {
      // Re-encoding is also a sanitiser: it drops EXIF (including GPS), any
      // trailing polyglot payload, and anything sharp itself refuses to parse.
      try {
        body = await sharp(file.buffer)
          .rotate() // respect EXIF orientation
          .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 82 })
          .toBuffer();
      } catch (error) {
        // A photo truncated by a dropped mobile connection has the right magic
        // bytes and a corrupt body, so it passes the sniff and then makes sharp
        // throw. Left unhandled that is a 500, and the driver app's offline
        // queue re-sends the same broken bytes forever. It is the client's
        // problem, so it gets a 4xx it can act on.
        this.logger.warn(
          `Rejected an unreadable image upload: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw new AppException('FILE_CORRUPT', HttpStatus.BAD_REQUEST);
      }
      mimeType = 'image/jpeg';
    }

    // Object keys are tenant-prefixed so bucket listings can never cross
    // companies, and every component is server-generated — no client string
    // ever reaches the key (path traversal).
    const key = `${actor.companyId}/${randomUUID()}${EXTENSION_BY_TYPE[mimeType]}`;
    await this.ensureBucket();
    await this.client.putObject(this.bucket, key, body, body.length, {
      'Content-Type': mimeType,
      // Belt and braces for anything that later serves the object directly.
      'X-Amz-Meta-Original-Type': detected,
      'Content-Disposition': 'attachment',
    });

    return this.prisma.forCompany(actor.companyId).storedFile.create({
      data: {
        companyId: actor.companyId as string,
        key,
        mimeType,
        size: body.length,
        originalName: sanitizeOriginalName(file.originalname),
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
