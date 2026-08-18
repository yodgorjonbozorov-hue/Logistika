import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ApiPayload, ApiResponseInterceptor } from './api-response.interceptor';
import type { SubscriptionState } from '../subscription/subscription.service';

/** An HTTP context whose request carries whatever the guard left on it. */
const context = (subscription?: SubscriptionState): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ subscription }) }),
  }) as unknown as ExecutionContext;

const next = (result: unknown): CallHandler => ({ handle: () => of(result) });

describe('ApiResponseInterceptor', () => {
  const interceptor = new ApiResponseInterceptor();

  it('wraps plain results into { success, data, error, meta }', async () => {
    const response = await firstValueFrom(interceptor.intercept(context(), next({ id: 1 })));
    expect(response).toEqual({ success: true, data: { id: 1 }, error: null, meta: null });
  });

  it('normalizes undefined to null data', async () => {
    const response = await firstValueFrom(interceptor.intercept(context(), next(undefined)));
    expect(response).toEqual({ success: true, data: null, error: null, meta: null });
  });

  it('unpacks ApiPayload with meta (pagination)', async () => {
    const payload = new ApiPayload([1, 2], { pagination: { page: 1, limit: 10, total: 2 } });
    const response = await firstValueFrom(interceptor.intercept(context(), next(payload)));
    expect(response).toEqual({
      success: true,
      data: [1, 2],
      error: null,
      meta: { pagination: { page: 1, limit: 10, total: 2 } },
    });
  });

  describe('expired subscription (TASK-3.9)', () => {
    const until = new Date('2026-07-31T00:00:00Z');
    const expired: SubscriptionState = { isActive: true, until, expired: true };

    it('warns on a read that was allowed through', async () => {
      const response = await firstValueFrom(interceptor.intercept(context(expired), next([])));

      // Reads keep working, so without this the office sees everything load
      // normally and only finds out when a save fails.
      expect(response.meta).toEqual({
        subscription: { expired: true, until: until.toISOString() },
      });
    });

    it('keeps pagination alongside the warning', async () => {
      const payload = new ApiPayload([1], { pagination: { page: 1, limit: 10, total: 1 } });
      const response = await firstValueFrom(interceptor.intercept(context(expired), next(payload)));

      expect(response.meta).toEqual({
        pagination: { page: 1, limit: 10, total: 1 },
        subscription: { expired: true, until: until.toISOString() },
      });
    });

    it('says nothing outside an HTTP request', async () => {
      const rpc = { getType: () => 'rpc' } as unknown as ExecutionContext;
      const response = await firstValueFrom(interceptor.intercept(rpc, next({})));
      expect(response.meta).toBeNull();
    });

    it('says nothing while the subscription is current', async () => {
      const live: SubscriptionState = { isActive: true, until: null, expired: false };
      const response = await firstValueFrom(interceptor.intercept(context(live), next({})));
      expect(response.meta).toBeNull();
    });
  });
});
