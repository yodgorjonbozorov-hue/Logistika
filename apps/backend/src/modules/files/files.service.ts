import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StoredFile } from '@prisma/client';
import * as Minio from 'minio';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { publicStorageEndpoint } from '../../config/env.validation';
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
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);
  private readonly client: Minio.Client;
  /** Same credentials, browser-reachable host: only used to sign download URLs. */
  private readonly publicClient: Minio.Client;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // getOrThrow, not `?? ''`: an app that boots without storage credentials
    // only fails later, once per upload, in front of a driver.
    const accessKey = config.getOrThrow<string>('MINIO_ROOT_USER');
    const secretKey = config.getOrThrow<string>('MINIO_ROOT_PASSWORD');
    const endPoint = config.getOrThrow<string>('MINIO_ENDPOINT');
    const port = Number(config.getOrThrow<number>('MINIO_PORT'));
    const useSSL = config.getOrThrow<string>('MINIO_USE_SSL') === 'true';

    this.bucket = config.getOrThrow<string>('MINIO_BUCKET');
    this.client = new Minio.Client({ endPoint, port, useSSL, accessKey, secretKey });

    const publicEndpoint = publicStorageEndpoint({
      MINIO_ENDPOINT: endPoint,
      MINIO_PUBLIC_ENDPOINT: config.get<string>('MINIO_PUBLIC_ENDPOINT'),
      MINIO_PORT: port,
      MINIO_PUBLIC_PORT: config.get<number>('MINIO_PUBLIC_PORT'),
      MINIO_USE_SSL: String(useSSL),
      MINIO_PUBLIC_USE_SSL: config.get<string>('MINIO_PUBLIC_USE_SSL'),
    });
    this.publicClient = new Minio.Client({ ...publicEndpoint, accessKey, secretKey });
  }

  /**
   * Create the bucket at boot so a fresh install is ready before the first
   * upload — otherwise the readiness probe reports storage down until someone
   * happens to upload a photo. A storage outage at boot is logged, not fatal:
   * the lazy path retries on every upload.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucket();
    } catch (error) {
      this.logger.warn(
        `Object storage not ready at startup, will retry on first upload: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
    // Signed with the browser-facing host, otherwise the link points at a
    // hostname that only exists inside the Docker network.
    const url = await this.publicClient.presignedGetObject(
      this.bucket,
      file.key,
      SIGNED_URL_TTL_SECONDS,
    );
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
