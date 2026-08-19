import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StoredFile } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveS3Settings } from './s3-config';

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
  private readonly client: S3Client;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const settings = resolveS3Settings((key) => config.get<string>(key));
    this.bucket = settings.bucket;
    this.client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
        sessionToken: settings.sessionToken,
      },
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
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
        ContentLength: body.length,
      }),
    );

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
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: file.key }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
    return { url, expiresIn: SIGNED_URL_TTL_SECONDS };
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.bucketReady = true;
      return;
    } catch {
      // Falls through to creation — a missing bucket is the common case in dev.
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.bucketReady = true;
    } catch (error) {
      this.logger.error(
        `Object storage bucket check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new AppException('INTERNAL_ERROR', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
