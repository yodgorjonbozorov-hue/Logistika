import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppException } from '../exceptions/app.exception';

/**
 * Guards the scheduled endpoints the platform calls instead of an in-process
 * cron. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; any other caller
 * is rejected. Without a configured secret the endpoints stay closed, so a
 * misconfigured deployment cannot expose them.
 */
@Injectable()
export class CronGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('CRON_SECRET');
    if (!secret) throw new AppException('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);

    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token || !safeEqual(token, secret)) {
      throw new AppException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}

/** Constant-time compare — length is checked first because the primitive throws. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
