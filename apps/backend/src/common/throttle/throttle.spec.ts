/**
 * The limiter's contract with the client.
 *
 * The interesting part is not "does it reject" — @nestjs/throttler does that —
 * but what the rejection *says*. A 429 whose Retry-After is wrong is worse than
 * no header: an under-estimate turns every throttled client into a tight retry
 * loop against an endpoint that is already refusing it.
 *
 * `ThrottlerLimitDetail` mixes units (timeToExpire and timeToBlockExpire in
 * seconds, ttl in milliseconds), which is exactly the kind of thing that is
 * wrong for months without a test.
 */
import { HttpStatus } from '@nestjs/common';
import type { ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request } from 'express';
import { AppException } from '../exceptions/app.exception';
import { AppThrottlerGuard } from './throttle';

const guard = new AppThrottlerGuard({ throttlers: [] }, {} as never, {} as never) as unknown as {
  getTracker(req: unknown): Promise<string>;
  throwThrottlingException(context: unknown, detail: ThrottlerLimitDetail): Promise<void>;
};

const detail = (over: Partial<ThrottlerLimitDetail>): ThrottlerLimitDetail =>
  ({
    ttl: 60_000, // milliseconds
    limit: 5,
    totalHits: 6,
    timeToExpire: 0, // seconds
    timeToBlockExpire: 0, // seconds
    isBlocked: false,
    key: 'k',
    tracker: 't',
    ...over,
  }) as ThrottlerLimitDetail;

async function retryAfterFor(over: Partial<ThrottlerLimitDetail>): Promise<number> {
  try {
    await guard.throwThrottlingException({}, detail(over));
  } catch (error) {
    const details = (error as AppException).details as { retryAfterSeconds: number };
    return details.retryAfterSeconds;
  }
  throw new Error('the guard did not throw');
}

describe('AppThrottlerGuard — the 429 it produces', () => {
  it('answers with the project error envelope, not the throttler default', async () => {
    await expect(guard.throwThrottlingException({}, detail({}))).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('reports the seconds left in the window, not the window in milliseconds', async () => {
    // 55 seconds left of a 60-second window.
    expect(await retryAfterFor({ timeToExpire: 55 })).toBe(55);
  });

  it('prefers the block expiry when the caller is actually blocked', async () => {
    expect(await retryAfterFor({ timeToExpire: 10, timeToBlockExpire: 300, isBlocked: true })).toBe(
      300,
    );
  });

  it('falls back to the configured window when the store reports nothing', async () => {
    expect(await retryAfterFor({ ttl: 60_000 })).toBe(60);
  });

  it('never says 0 — a client would retry in the same millisecond', async () => {
    expect(await retryAfterFor({ timeToExpire: 0, ttl: 100 })).toBe(1);
  });
});

describe('AppThrottlerGuard — who the limit is charged to', () => {
  it('buckets an authenticated caller by user', async () => {
    const request = { user: { userId: 'u-1' }, ip: '10.0.0.5' } as unknown as Request;
    expect(await guard.getTracker(request)).toBe('user:u-1');
  });

  it('buckets an anonymous caller by IP', async () => {
    const request = { ip: '10.0.0.5' } as unknown as Request;
    expect(await guard.getTracker(request)).toBe('ip:10.0.0.5');
  });

  it('uses the proxy-resolved client IP when Express was told to trust one', async () => {
    const request = { ips: ['203.0.113.7', '10.0.0.1'], ip: '10.0.0.1' } as unknown as Request;
    expect(await guard.getTracker(request)).toBe('ip:203.0.113.7');
  });

  it('does not throw when there is no identifiable caller at all', async () => {
    expect(await guard.getTracker({} as Request)).toBe('ip:unknown');
  });

  it('keeps two users on one office IP in separate buckets', async () => {
    const a = { user: { userId: 'u-1' }, ip: '10.0.0.5' } as unknown as Request;
    const b = { user: { userId: 'u-2' }, ip: '10.0.0.5' } as unknown as Request;
    expect(await guard.getTracker(a)).not.toBe(await guard.getTracker(b));
  });
});
