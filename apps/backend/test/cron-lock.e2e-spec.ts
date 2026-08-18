/**
 * Only one instance runs the nightly work (TASK-4.4, A-2/M-8).
 *
 * `@Cron` fires in every process running the app. With one box that is
 * invisible, which is why it survived the audit; with two, the archival moves
 * the same rows twice and the token purge races itself. This test uses a real
 * Redis — the same one the app uses — and two lock services standing in for two
 * API instances.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CronLockService } from '../src/common/jobs/cron-lock.service';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrackingService } from '../src/modules/tracking/tracking.service';

jest.setTimeout(60_000);

describe('Cron distributed lock (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  const instances: CronLockService[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
    config = app.get(ConfigService);
  });

  afterAll(async () => {
    await Promise.all(instances.map((instance) => instance.onModuleDestroy()));
    await app.close();
  });

  /** A lock service with its own connection — a second API process. */
  function instance(): CronLockService {
    const service = new CronLockService(config);
    instances.push(service);
    return service;
  }

  it('lets exactly one of two instances through', async () => {
    const name = `test-${randomUUID()}`;
    const ran: string[] = [];

    const results = await Promise.all([
      instance().runExclusive(name, async () => {
        ran.push('a');
      }),
      instance().runExclusive(name, async () => {
        ran.push('b');
      }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(ran).toHaveLength(1);
  });

  it('keeps the claim after the work is done, so a skewed clock cannot re-run it', async () => {
    const name = `test-${randomUUID()}`;
    const first = instance();

    await first.runExclusive(name, async () => undefined);
    // Instances rarely agree on the second. A lock handed back on completion
    // is a lock the next instance's cron picks up moments later.
    const second = await instance().runExclusive(name, async () => undefined);

    expect(second).toBe(false);
  });

  it('does not block a different job', async () => {
    const shared = instance();
    await shared.runExclusive(`test-${randomUUID()}`, async () => undefined);

    await expect(shared.runExclusive(`test-${randomUUID()}`, async () => undefined)).resolves.toBe(
      true,
    );
  });

  it('releases the claim once its expiry passes', async () => {
    const name = `test-${randomUUID()}`;
    const shared = instance();

    // A crashed instance must not hold a daily job hostage for ever.
    await shared.runExclusive(name, async () => undefined, 300);
    await new Promise((resolve) => setTimeout(resolve, 500));

    await expect(shared.runExclusive(name, async () => undefined)).resolves.toBe(true);
  });

  it('runs the real archival job once across two instances', async () => {
    await truncateAll(prisma);
    // The claim outlives the test run by design (an hour), so a second `pnpm
    // test:e2e` would otherwise find it already taken and see zero runs.
    const redis = new Redis(config.getOrThrow<string>('REDIS_URL'));
    await redis.del('cron:lock:gps-archive');
    await redis.quit();

    const tracking = app.get(TrackingService);
    const runs = jest.spyOn(
      tracking as unknown as { runArchive: () => Promise<void> },
      'runArchive',
    );

    // Both "instances" share the app's own lock service here; the second call
    // is the one that must find the claim already taken.
    await tracking.archiveOldTracks();
    await tracking.archiveOldTracks();

    expect(runs).toHaveBeenCalledTimes(1);
    runs.mockRestore();
  });
});
