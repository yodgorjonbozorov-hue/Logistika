import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

/** How long a daily job's claim stands. Comfortably longer than any of them. */
export const DEFAULT_LOCK_TTL_MS = 60 * 60 * 1000;

/**
 * One instance, not all of them (TASK-4.4, A-2/M-8).
 *
 * `@Cron` fires in *every* process running the app. With one box that is
 * invisible; the moment the API is scaled to two, the nightly archival runs
 * twice against the same rows and the token purge races itself. Nothing in the
 * code said so, which is exactly why it would have been found in production.
 *
 * The claim is a plain `SET key token NX PX ttl`. It is deliberately **not**
 * released when the job finishes: instances rarely agree on the second, and a
 * lock handed back after four seconds is a lock the next instance's cron picks
 * up four seconds later. Letting it expire on its own covers that skew, and
 * these jobs have a whole day before they are wanted again.
 */
@Injectable()
export class CronLockService implements OnModuleDestroy {
  private readonly logger = new Logger(CronLockService.name);
  private client?: Redis;

  constructor(private readonly config: ConfigService) {}

  /**
   * Runs `work` on whichever instance wins the claim, and returns whether this
   * one did.
   *
   * When Redis cannot be reached the work runs anyway. Every job behind this
   * lock is idempotent — deleting expired rows twice deletes nothing the second
   * time — so a doubled run costs a little CPU, while a skipped one is a
   * cleanup that silently never happened.
   */
  async runExclusive(
    name: string,
    work: () => Promise<void>,
    ttlMs: number = DEFAULT_LOCK_TTL_MS,
  ): Promise<boolean> {
    const acquired = await this.claim(name, ttlMs);
    if (!acquired) {
      this.logger.debug(`Cron ${name} is running on another instance; skipped`);
      return false;
    }
    await work();
    return true;
  }

  private async claim(name: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await this.redis().set(`cron:lock:${name}`, randomUUID(), 'PX', ttlMs, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logger.warn(
        `Cron lock unavailable for ${name}, running unguarded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  }

  private redis(): Redis {
    if (!this.client) {
      this.client = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
        maxRetriesPerRequest: 1,
        // A cron that cannot reach Redis should decide in a second, not hang
        // the scheduler waiting for a broker that is not coming back.
        connectTimeout: 1_000,
        lazyConnect: false,
      });
      this.client.on('error', () => {
        // Handled at the call site; without a listener ioredis makes it an
        // unhandled 'error' event and takes the process down.
      });
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
