import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UserRole, type CurrentUserPayload } from 'shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException } from '../exceptions/app.exception';
import { SubscriptionService, type SubscriptionState } from './subscription.service';

/** Methods that only look at data. Everything else changes it. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface RequestWithSubscription extends Request {
  user?: CurrentUserPayload;
  subscription?: SubscriptionState;
}

/**
 * Enforces the company's subscription (TASK-3.9).
 *
 * Two different situations, deliberately answered differently:
 *
 *  - **switched off** (`isActive = false`) — nothing is allowed. This is an
 *    administrative decision, not a billing state.
 *  - **expired** (`subscriptionUntil` in the past) — reads still work, writes
 *    return 402. A firm that is late on an invoice must still be able to open
 *    its own trips, see what it is owed and export its records; locking them
 *    out of their own history is punishment, not collection. Writing new data
 *    into a system they are not paying for is the part that stops.
 *
 * SUPERADMIN is outside all of it — that is the account that fixes the
 * subscription — and so are the public routes, or an expired company could not
 * log in to see why it is expired.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithSubscription>();
    const user = request.user;
    // No tenant to check: SUPERADMIN, or a request the auth guard already
    // rejected.
    if (!user?.companyId || user.role === UserRole.SUPERADMIN) return true;

    const state = await this.subscriptions.stateOf(user.companyId);
    // Kept on the request so the response can carry the warning without every
    // controller having to know about billing.
    request.subscription = state;

    if (!state.isActive) {
      throw new AppException('COMPANY_INACTIVE', HttpStatus.FORBIDDEN);
    }
    if (state.expired && !READ_METHODS.has(request.method)) {
      throw new AppException('SUBSCRIPTION_EXPIRED', HttpStatus.PAYMENT_REQUIRED, {
        until: state.until?.toISOString().slice(0, 10) ?? '',
      });
    }
    return true;
  }
}
