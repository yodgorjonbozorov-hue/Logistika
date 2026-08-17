import { HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerLimitDetail } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';

/**
 * The stock guard throws a plain ThrottlerException, which would reach the
 * client as an untranslated 429 outside the `{ success, data, error, meta }`
 * envelope. This one raises the standard AppException instead.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    return Promise.reject(
      new AppException('RATE_LIMIT_EXCEEDED', HttpStatus.TOO_MANY_REQUESTS, undefined, {
        retryAfterSeconds: Math.ceil(detail.timeToBlockExpire),
      }),
    );
  }
}
