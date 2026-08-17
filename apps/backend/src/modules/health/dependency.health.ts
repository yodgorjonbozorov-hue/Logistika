import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import Redis from 'ioredis';
import * as Minio from 'minio';
import { PrismaService } from '../../prisma/prisma.service';

const CHECK_TIMEOUT_MS = 3000;

/**
 * Readiness means "this instance can actually serve a request", which needs the
 * database, Redis and object storage — not just a live process. `/health`
 * returning a hardcoded ok told the load balancer nothing.
 */
@Injectable()
export class DependencyHealthIndicator {
  private readonly logger = new Logger(DependencyHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async checkDatabase(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('database');
    try {
      await this.withTimeout(this.prisma.$queryRaw`SELECT 1`);
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: this.describe(error) });
    }
  }

  async checkRedis(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('redis');
    const client = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: CHECK_TIMEOUT_MS,
    });
    try {
      await this.withTimeout(client.connect().then(() => client.ping()));
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: this.describe(error) });
    } finally {
      client.disconnect();
    }
  }

  async checkStorage(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('storage');
    try {
      const client = new Minio.Client({
        endPoint: this.config.getOrThrow<string>('MINIO_ENDPOINT'),
        port: Number(this.config.getOrThrow<number>('MINIO_PORT')),
        useSSL: this.config.getOrThrow<string>('MINIO_USE_SSL') === 'true',
        accessKey: this.config.getOrThrow<string>('MINIO_ROOT_USER'),
        secretKey: this.config.getOrThrow<string>('MINIO_ROOT_PASSWORD'),
      });
      const bucket = this.config.getOrThrow<string>('MINIO_BUCKET');
      const exists = await this.withTimeout(client.bucketExists(bucket));
      return exists ? indicator.up() : indicator.down({ message: `bucket "${bucket}" missing` });
    } catch (error) {
      return indicator.down({ message: this.describe(error) });
    }
  }

  private withTimeout<T>(promise: PromiseLike<T>): Promise<T> {
    return Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_resolve, reject) =>
        setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS).unref(),
      ),
    ]);
  }

  /** Never leak a connection string (it carries the password) to the caller. */
  private describe(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Health check failed: ${message}`);
    return message.replace(/\/\/[^@\s]*@/g, '//***@').slice(0, 200);
  }
}
