import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { ApiMeta, ApiResponse } from 'shared';
import type { RequestWithSubscription } from '../subscription/subscription.guard';

/** Controllers return this when a response needs `meta` (pagination etc.). */
export class ApiPayload<T> {
  constructor(
    readonly data: T,
    readonly meta: ApiMeta,
  ) {}
}

@Injectable()
export class ApiResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    const warning = subscriptionWarning(context);
    return next.handle().pipe(
      map((result) => {
        const base = result instanceof ApiPayload ? result.meta : null;
        const meta = warning ? { ...(base ?? {}), ...warning } : base;
        const data = (result instanceof ApiPayload ? result.data : (result ?? null)) as T;
        return { success: true, data, error: null, meta };
      }),
    );
  }
}

/**
 * An expired subscription lets reads through (TASK-3.9), so the response has to
 * say so — otherwise the office sees its data load normally and only finds out
 * something is wrong when a save fails.
 */
function subscriptionWarning(context: ExecutionContext): ApiMeta | null {
  if (context.getType() !== 'http') return null;
  const request = context.switchToHttp().getRequest<RequestWithSubscription>();
  const state = request.subscription;
  if (!state?.expired) return null;
  return { subscription: { expired: true, until: state.until?.toISOString() ?? null } };
}
