import { CronLockService, DEFAULT_LOCK_TTL_MS } from './cron-lock.service';
import { createConfigMock } from '../../test-utils/tenant-db.mock';

/**
 * `@Cron` fires in every process running the app (A-2, M-8). One box hides
 * that; two boxes means the nightly archival moves the same rows twice and the
 * token purge races itself.
 */

/** Replaces the ioredis client with a stub, so no broker is involved. */
function setup(set: jest.Mock) {
  const service = new CronLockService(createConfigMock({ REDIS_URL: 'redis://x' }));
  (service as unknown as { redis: () => unknown }).redis = () => ({ set });
  return service;
}

describe('CronLockService', () => {
  it('runs the work on the instance that wins the claim', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const service = setup(set);
    const work = jest.fn().mockResolvedValue(undefined);

    await expect(service.runExclusive('gps-archive', work)).resolves.toBe(true);

    expect(work).toHaveBeenCalled();
  });

  it('claims the lock with NX and an expiry, never a bare SET', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const service = setup(set);

    await service.runExclusive('gps-archive', jest.fn());

    // Without NX every instance "wins"; without PX a crashed instance holds the
    // lock for ever and the job never runs again.
    const [key, , px, ttl, nx] = set.mock.calls[0] as [string, string, string, number, string];
    expect(key).toBe('cron:lock:gps-archive');
    expect(px).toBe('PX');
    expect(ttl).toBe(DEFAULT_LOCK_TTL_MS);
    expect(nx).toBe('NX');
  });

  it('skips the work on every instance that loses', async () => {
    // The whole point: on two API boxes only one nightly archival runs.
    const set = jest.fn().mockResolvedValue(null);
    const service = setup(set);
    const work = jest.fn();

    await expect(service.runExclusive('gps-archive', work)).resolves.toBe(false);

    expect(work).not.toHaveBeenCalled();
  });

  it('gives each lock its own key', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const service = setup(set);

    await service.runExclusive('idempotency-purge', jest.fn());

    expect(set.mock.calls[0]![0]).toBe('cron:lock:idempotency-purge');
  });

  it('uses a fresh token per claim so two instances never write the same value', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const service = setup(set);

    await service.runExclusive('a', jest.fn());
    await service.runExclusive('b', jest.fn());

    expect(set.mock.calls[0]![1]).not.toBe(set.mock.calls[1]![1]);
  });

  it('runs the work anyway when Redis cannot be reached', async () => {
    const set = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const service = setup(set);
    const work = jest.fn().mockResolvedValue(undefined);

    await expect(service.runExclusive('gps-archive', work)).resolves.toBe(true);

    // Every job behind this lock is idempotent, so a doubled run costs some
    // CPU — while a skipped one is a cleanup that silently never happened.
    expect(work).toHaveBeenCalled();
  });

  it('honours a caller that wants a shorter claim', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const service = setup(set);

    await service.runExclusive('quick', jest.fn(), 5_000);

    expect(set.mock.calls[0]![3]).toBe(5_000);
  });

  it('lets a failing job fail loudly rather than reporting success', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const service = setup(set);

    // The lock decides *who* runs, not whether errors matter; each job keeps
    // its own try/catch and its own log line.
    await expect(
      service.runExclusive('gps-archive', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });
});
