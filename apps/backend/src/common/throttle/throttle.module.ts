import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { PhoneRateLimitGuard } from './throttle';

const logger = new Logger('ThrottleModule');

/**
 * Rate limiting (C-5).
 *
 * Storage is Redis-backed in production so the limits hold across replicas —
 * an in-memory counter on three pods is really a 3x limit. Development and
 * tests fall back to the in-process store so no infrastructure is required.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): ThrottlerModuleOptions => {
        const ttl = config.get<number>('RATE_LIMIT_TTL_SECONDS', 60) * 1000;
        const limit = config.get<number>('RATE_LIMIT_MAX', 300);
        const redisUrl = config.get<string>('REDIS_URL');
        const useRedis = config.get<string>('NODE_ENV') !== 'test' && Boolean(redisUrl);

        if (!useRedis) {
          logger.warn('Rate limiting uses in-memory storage — not shared between replicas.');
        }
        return {
          throttlers: [{ name: 'default', ttl, limit }],
          errorMessage: 'RATE_LIMITED',
          ...(useRedis ? { storage: new ThrottlerStorageRedisService(redisUrl) } : {}),
        };
      },
    }),
  ],
  providers: [PhoneRateLimitGuard],
  exports: [ThrottlerModule, PhoneRateLimitGuard],
})
export class ThrottleModule {}
