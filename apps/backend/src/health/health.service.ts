import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as Minio from 'minio';
import { PrismaService } from '../prisma/prisma.service';

export type DependencyStatus = 'up' | 'down';

export interface ReadinessReport {
  ready: boolean;
  checks: Record<string, { status: DependencyStatus; latencyMs: number; error?: string }>;
}

/** A hung dependency must not hang the probe itself. */
const CHECK_TIMEOUT_MS = 3000;

async function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} check timed out after ${CHECK_TIMEOUT_MS}ms`)),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Readiness really asks each dependency a question it can only answer when it
 * works: PostgreSQL runs a query, Redis answers PING, MinIO is asked whether
 * the bucket exists. Anything that fails or is slow makes the pod not-ready.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private minio: Minio.Client | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async readiness(): Promise<ReadinessReport> {
    const results = await Promise.all([
      this.timed('database', () => this.prisma.$queryRaw`SELECT 1`),
      this.timed('redis', () => this.pingRedis()),
      this.timed('storage', () => this.pingStorage()),
    ]);

    const checks = Object.fromEntries(results.map(({ name, ...rest }) => [name, rest]));
    return { ready: results.every((r) => r.status === 'up'), checks };
  }

  private async timed(
    name: string,
    probe: () => Promise<unknown>,
  ): Promise<{ name: string; status: DependencyStatus; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      await withTimeout(Promise.resolve(probe()), name);
      return { name, status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Readiness check "${name}" failed: ${message}`);
      // The message is a dependency status, not user data — but keep it short
      // so a connection string can never end up in a public response body.
      return {
        name,
        status: 'down',
        latencyMs: Date.now() - started,
        error: message.slice(0, 120),
      };
    }
  }

  /**
   * A short-lived connection per probe, torn down in `finally`.
   *
   * A long-lived client is the obvious optimisation and the wrong one here: a
   * cached ioredis instance whose server is unreachable keeps retrying forever,
   * which both holds the event loop open (the process will not shut down) and
   * makes the next probe answer from a stale connection state.
   */
  private async pingRedis(): Promise<void> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) throw new Error('REDIS_URL is not configured');
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: CHECK_TIMEOUT_MS,
      retryStrategy: () => null, // one attempt, then give up — this is a probe
    });
    try {
      await client.connect();
      const pong = await client.ping();
      if (pong !== 'PONG') throw new Error(`unexpected PING reply: ${pong}`);
    } finally {
      client.disconnect();
    }
  }

  private async pingStorage(): Promise<void> {
    const bucket = this.config.get<string>('MINIO_BUCKET') ?? 'truckcontrol';
    this.minio ??= new Minio.Client({
      endPoint: this.config.get<string>('MINIO_ENDPOINT') ?? 'localhost',
      port: Number(this.config.get<number>('MINIO_PORT') ?? 9000),
      useSSL:
        this.config.get<boolean | string>('MINIO_USE_SSL') === true ||
        this.config.get<boolean | string>('MINIO_USE_SSL') === 'true',
      accessKey: this.config.get<string>('MINIO_ROOT_USER') ?? 'truckcontrol',
      secretKey: this.config.get<string>('MINIO_ROOT_PASSWORD') ?? '',
    });
    const exists = await this.minio.bucketExists(bucket);
    if (!exists) throw new Error(`bucket "${bucket}" does not exist`);
  }
}
