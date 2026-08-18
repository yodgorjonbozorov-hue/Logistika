import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { StoredFile } from '@prisma/client';
import * as Minio from 'minio';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import {
  detectFileType,
  looksLikeCompletePdf,
  type DetectedFileType,
} from '../../common/file-signature';
import { requireTenantActor } from '../../common/tenant-actor';
import { publicStorageEndpoint } from '../../config/env.validation';
import { FileScanner } from './file-scanner';
import { JobsService } from '../../common/jobs/jobs.service';
import { QUEUES, type CompressImageJob } from '../../common/jobs/job-queues';
import { PrismaService } from '../../prisma/prisma.service';

/** Photos are downscaled before storage — 1500px is enough for OCR (TZ §8.3). */
const MAX_IMAGE_DIMENSION = 1500;
const SIGNED_URL_TTL_SECONDS = 15 * 60;

const IMAGE_MIMES = new Set<DetectedFileType>(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Decompression bombs: a few-kilobyte PNG can declare a 50000x50000 canvas and
 * take the process down when decoded. sharp refuses beyond this pixel count.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/** Per-company storage allowance; raised per tariff plan later. */
const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

/** How long an unreferenced upload is kept before it counts as abandoned. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const ORPHAN_BATCH_SIZE = 500;

/** Keeps a user-supplied name from breaking out of the header it lands in. */
function sanitiseFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 100);
}

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
    private readonly scanner: FileScanner,
    private readonly jobs: JobsService,
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
    this.jobs.register(QUEUES.files, (job) => this.compressStored(job));
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
    const tenant = requireTenantActor(actor);

    // The client's Content-Type is a claim, not evidence: the bytes decide.
    const detected = detectFileType(file.buffer);
    if (!detected) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        undefined,
        { declared: file.mimetype },
      );
    }
    if (detected === 'application/pdf' && !looksLikeCompletePdf(file.buffer)) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        undefined,
        { reason: 'truncated pdf' },
      );
    }

    const scan = await this.scanner.scan(file.buffer, file.originalname);
    if (!scan.clean) {
      this.logger.warn(`Rejected infected upload from user ${tenant.userId}: ${scan.threat}`);
      throw new AppException('FILE_INFECTED', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }

    await this.assertQuota(tenant.companyId, file.buffer.length);

    // Validation, virus scan and quota stay on the request thread — they decide
    // whether the upload is allowed at all. Compression does not, and it is the
    // slow part (TASK-4.3): a driver on a village road used to hold the
    // connection open for seconds of sharp while their photo was resized.
    const isImage = IMAGE_MIMES.has(detected);
    if (isImage) await this.assertReadableImage(file.buffer);
    const mimeType: string = isImage ? 'image/jpeg' : detected;

    // Object keys are tenant-prefixed so bucket listings can never cross companies.
    const key = `${tenant.companyId}/${randomUUID()}${mimeType === 'application/pdf' ? '.pdf' : '.jpg'}`;
    await this.ensureBucket();
    // The original bytes go up as they are, so the file is downloadable from
    // this moment on. PROCESSING means "not yet shrunk", never "not yet there".
    await this.client.putObject(this.bucket, key, file.buffer, file.buffer.length, {
      'Content-Type': mimeType,
    });

    const stored = await this.prisma.forCompany(actor.companyId).storedFile.create({
      data: {
        companyId: actor.companyId as string,
        key,
        mimeType,
        size: file.buffer.length,
        originalName: file.originalname,
        createdById: actor.userId,
        status: isImage ? 'PROCESSING' : 'READY',
      },
    });

    if (isImage) {
      await this.jobs.enqueue(QUEUES.files, {
        companyId: stored.companyId,
        fileId: stored.id,
      });
    }
    return stored;
  }

  /**
   * Downscales a stored image in place, run by the worker.
   *
   * An unreadable image is not retried: sharp will not like it any better on
   * the third attempt. It is marked FAILED and the original stays downloadable,
   * which is better than deleting a receipt a driver cannot photograph again.
   */
  private async compressStored(job: CompressImageJob): Promise<void> {
    const db = this.prisma.forCompany(job.companyId);
    const file = await db.storedFile.findUnique({ where: { id: job.fileId } });
    if (!file || file.status === 'READY') return;

    const original = await this.readObject(file.key);
    let body: Buffer;
    try {
      body = await this.compressImage(original);
    } catch {
      await db.storedFile.update({ where: { id: file.id }, data: { status: 'FAILED' } });
      this.logger.warn(`Could not compress ${file.id}; original kept`);
      return;
    }

    await this.client.putObject(this.bucket, file.key, body, body.length, {
      'Content-Type': file.mimeType,
    });
    await db.storedFile.update({
      where: { id: file.id },
      data: { size: body.length, status: 'READY' },
    });
  }

  private async readObject(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /**
   * Rejects an unreadable image while the caller is still listening.
   *
   * Only the header is decoded, which is microseconds — the point is that a
   * corrupted photo still comes back as 415 at upload time. Moving compression
   * to a queue must not turn "your photo is broken" into a success followed by
   * a FAILED row nobody looks at.
   */
  private async assertReadableImage(buffer: Buffer): Promise<void> {
    try {
      const meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      if (!meta.width || !meta.height) throw new Error('no dimensions');
    } catch (error) {
      this.logger.warn(
        `Rejected unreadable image: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        undefined,
        { reason: 'unreadable image' },
      );
    }
  }

  /**
   * A malformed image is a client mistake (415), not a server failure (500):
   * sharp throwing straight out of the handler produced a bare 500 with a
   * stack trace in the logs for every corrupted photo a driver sent.
   */
  private async compressImage(buffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate() // respect EXIF orientation
        .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch (error) {
      this.logger.warn(
        `Rejected unreadable image: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        undefined,
        { reason: 'unreadable image' },
      );
    }
  }

  /** Storage is a shared, finite resource; one tenant must not eat all of it. */
  private async assertQuota(companyId: string, incomingBytes: number): Promise<void> {
    const used = await this.prisma
      .forCompany(companyId)
      .storedFile.aggregate({ _sum: { size: true } });
    const total = (used._sum.size ?? 0) + incomingBytes;
    if (total > DEFAULT_QUOTA_BYTES) {
      throw new AppException('QUOTA_EXCEEDED', HttpStatus.PAYLOAD_TOO_LARGE, undefined, {
        usedBytes: used._sum.size ?? 0,
        quotaBytes: DEFAULT_QUOTA_BYTES,
      });
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
    // Signed with the browser-facing host, otherwise the link points at a
    // hostname that only exists inside the Docker network.
    // Forces a download with a fixed type and name: without this a stored
    // SVG or HTML-ish blob could render in the browser on the storage origin.
    const url = await this.publicClient.presignedGetObject(
      this.bucket,
      file.key,
      SIGNED_URL_TTL_SECONDS,
      {
        'response-content-type': file.mimeType,
        'response-content-disposition': `attachment; filename="${sanitiseFilename(
          file.originalName ?? file.key.split('/').pop() ?? 'file',
        )}"`,
      },
    );
    return { url, expiresIn: SIGNED_URL_TTL_SECONDS };
  }

  /**
   * Uploads happen before the event or document that references them, so a
   * driver who abandons a form leaves the object behind for ever. Anything
   * older than a day that nothing points at is removed from both the bucket and
   * the database (M-17).
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeOrphanFiles(): Promise<void> {
    const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);
    try {
      const candidates = await this.prisma.storedFile.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true, key: true, companyId: true },
        take: ORPHAN_BATCH_SIZE,
      });
      if (candidates.length === 0) return;

      const referenced = await this.referencedFileIds(candidates.map((file) => file.id));
      const orphans = candidates.filter((file) => !referenced.has(file.id));
      if (orphans.length === 0) return;

      await this.client.removeObjects(
        this.bucket,
        orphans.map((file) => file.key),
      );
      await this.prisma.storedFile.deleteMany({
        where: { id: { in: orphans.map((file) => file.id) } },
      });
      this.logger.log(`Purged ${orphans.length} orphan files`);
    } catch (error) {
      // Housekeeping failure must not take the process down.
      this.logger.error(
        `Orphan file purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Which of these file ids a trip event still points at (TASK-4.2).
   *
   * This used to read every trip event that had a photo — in every tenant,
   * across all history — and filter the candidate ids in JavaScript. The
   * question is answered by the database instead: jsonb's `?|` asks "does this
   * array contain any of these keys", so only the matching rows are read, and
   * the table's growth stops being this job's problem.
   */
  private async referencedFileIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();

    const rows = await this.prisma.$queryRaw<Array<{ photo_file_ids: string[] }>>`
      SELECT photo_file_ids
      FROM trip_events
      WHERE photo_file_ids IS NOT NULL
        AND photo_file_ids ?| ${ids}::text[]
    `;

    const candidates = new Set(ids);
    const referenced = new Set<string>();
    for (const row of rows) {
      for (const value of row.photo_file_ids ?? []) {
        if (candidates.has(value)) referenced.add(value);
      }
    }
    return referenced;
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
