import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentUserPayload } from 'shared';
import { AppThrottlerGuard } from './app-throttler.guard';

/**
 * Throttler names used with `@Throttle({ <name>: {...} })` on endpoints.
 * Each one tracks a different subject, because "5 logins per minute" only
 * means anything if it is 5 per *caller*.
 */
export const THROTTLERS = {
  /** Caller IP — the default for anonymous endpoints. */
  ip: 'ip',
  /** Login identifier (email/phone) from the body: one account, many IPs. */
  identifier: 'identifier',
  /** Phone number from the body: SMS costs real money per message. */
  phone: 'phone',
  /** Authenticated user id. */
  user: 'user',
} as const;

const ipOf = (req: Request): string =>
  (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
  req.ip ??
  req.socket?.remoteAddress ??
  'unknown';

const bodyField = (req: Request, field: string): string => {
  const value = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof value === 'string' && value.length > 0 ? value.toLowerCase() : ipOf(req);
};

const userOf = (req: Request): string =>
  (req as Request & { user?: CurrentUserPayload }).user?.userId ?? ipOf(req);

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Redis-backed so the limits hold across every API instance; ioredis was
        // already a dependency and unused until now.
        storage: new ThrottlerStorageRedisService(config.getOrThrow<string>('REDIS_URL')),
        throttlers: [
          // A wide default: endpoints that need something tighter declare it.
          {
            name: THROTTLERS.ip,
            ttl: seconds(60),
            limit: 120,
            getTracker: (req) => ipOf(req as Request),
          },
          {
            name: THROTTLERS.identifier,
            ttl: seconds(3600),
            limit: 1000,
            getTracker: (req) => bodyField(req as Request, 'identifier'),
          },
          {
            name: THROTTLERS.phone,
            ttl: seconds(3600),
            limit: 1000,
            getTracker: (req) => bodyField(req as Request, 'phone'),
          },
          {
            name: THROTTLERS.user,
            ttl: seconds(60),
            limit: 600,
            getTracker: (req) => userOf(req as Request),
          },
        ],
        // Health checks must answer even while something is hammering the API.
        skipIf: (context: ExecutionContext) =>
          context.switchToHttp().getRequest<Request>().path?.startsWith('/api/v1/health') ?? false,
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class ThrottlingModule {}
