import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  Throttle,
  ThrottlerGuard,
  ThrottlerStorage,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler';
import type { Request } from 'express';
import { AppException } from '../exceptions/app.exception';

const MINUTE = 60_000;

/**
 * Per-route limits (C-5). A single `default` throttler is registered globally
 * and these decorators tighten it where abuse is cheap and damaging.
 *
 * NOTE: several *named* throttlers would ALL apply to every route in NestJS,
 * so overriding the one `default` bucket per handler is the correct shape.
 */

/** Password login — brute force. */
export const ThrottleLogin = () => Throttle({ default: { limit: 5, ttl: MINUTE } });

/** SMS code request — costs real money and spams the driver's phone. */
export const ThrottleSms = () => Throttle({ default: { limit: 3, ttl: MINUTE } });

/** SMS code verification — guessing a 6-digit code. */
export const ThrottleSmsVerify = () => Throttle({ default: { limit: 10, ttl: MINUTE } });

/** Token refresh — cheap, but a rotation-storm amplifier. */
export const ThrottleRefresh = () => Throttle({ default: { limit: 30, ttl: MINUTE } });

/** Unauthenticated public tracking page. */
export const ThrottlePublic = () => Throttle({ default: { limit: 60, ttl: MINUTE } });

/** File upload — bandwidth, storage and image-processing CPU. */
export const ThrottleUpload = () => Throttle({ default: { limit: 30, ttl: MINUTE } });

/**
 * AI questions — each one runs several analytics rollups and may call a paid
 * provider, so this is the most expensive request an ordinary user can make.
 * Bucketed per user by AppThrottlerGuard, so one company cannot spend another's
 * budget.
 */
export const ThrottleAi = () => Throttle({ default: { limit: 20, ttl: MINUTE } });

/** Driver telemetry batches — high legitimate volume, still bounded. */
export const ThrottleIngest = () => Throttle({ default: { limit: 120, ttl: MINUTE } });

/**
 * Creating, editing or removing an account — including setting someone's
 * password.
 *
 * These are authenticated OWNER actions, so the global 300/minute applied to
 * them, which is three hundred password changes a minute from one stolen
 * session. A real administrator manages a handful of staff; anything faster is
 * either automation nobody asked for or an attacker working through a
 * compromised token, and both should be slowed down.
 */
export const ThrottleAccount = () => Throttle({ default: { limit: 10, ttl: MINUTE } });

/**
 * Global throttler guard.
 *
 * Two deliberate differences from the stock guard:
 *  - the 429 comes back in the project's `{ success, error: { code } }` shape
 *    with a machine-readable `RATE_LIMITED` code, and
 *  - authenticated traffic is bucketed per user, so one company on a shared
 *    office NAT cannot lock out another company's staff.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Request & { user?: { userId?: string } },
  ): Promise<string> {
    if (req.user?.userId) return `user:${req.user.userId}`;
    // `req.ips` is only populated when `trust proxy` is configured; without it
    // the client-controlled X-Forwarded-For header is ignored on purpose.
    const ip = req.ips?.length ? req.ips[0] : req.ip;
    return `ip:${ip ?? 'unknown'}`;
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    // Units differ inside ThrottlerLimitDetail and it is easy to get wrong:
    // `timeToExpire` and `timeToBlockExpire` are SECONDS, while `ttl` is
    // MILLISECONDS. Dividing the first two by 1000 as well produced a
    // Retry-After of 1 for a 60-second window, which tells a client to come
    // straight back and turns the limiter into a busy-wait for both sides.
    const seconds =
      detail.timeToBlockExpire > 0
        ? detail.timeToBlockExpire
        : detail.timeToExpire > 0
          ? detail.timeToExpire
          : detail.ttl / 1000;

    throw new AppException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, undefined, {
      retryAfterSeconds: Math.max(1, Math.ceil(seconds)),
    });
  }
}

// ---------------------------------------------------------------------------
// Victim-keyed SMS limiter
// ---------------------------------------------------------------------------

interface PhoneLimit {
  limit: number;
  ttl: number;
}

const PHONE_LIMIT_KEY = 'phone-rate-limit';

/**
 * Caps how often a code may be sent to ONE phone number, independently of who
 * asks. The per-caller limit alone cannot stop an attacker rotating IPs to bomb
 * a single victim's phone, and it cannot protect one driver without locking out
 * every other driver behind the same office IP.
 *
 * Deliberately a standalone guard rather than a second named throttler: named
 * throttlers in NestJS apply to *every* route, which is not what we want here.
 */
export const PhoneRateLimit = (limit = 1, ttl = MINUTE) =>
  SetMetadata(PHONE_LIMIT_KEY, { limit, ttl } satisfies PhoneLimit);

@Injectable()
export class PhoneRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<PhoneLimit | undefined>(PHONE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!config) return true;

    const request = context.switchToHttp().getRequest<Request & { body?: { phone?: unknown } }>();
    const phone = typeof request.body?.phone === 'string' ? request.body.phone : null;
    if (!phone) return true;

    // blockDuration must be > 0: the in-memory store treats a zero-length
    // block as "already expired" and immediately resets the counter, so the
    // limit would never actually bite. Blocking for the window itself is the
    // behaviour we want anyway.
    const record = await this.storage.increment(
      `sms-phone:${phone}`,
      config.ttl,
      config.limit,
      config.ttl,
      'phone',
    );
    if (record.totalHits > config.limit) {
      throw new AppException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, undefined, {
        retryAfterSeconds: Math.max(1, Math.ceil(record.timeToExpire)),
      });
    }
    return true;
  }
}
