import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ApiPayload, ApiResponseInterceptor } from './api-response.interceptor';

const context = {} as ExecutionContext;
const next = (result: unknown): CallHandler => ({ handle: () => of(result) });

describe('ApiResponseInterceptor', () => {
  const interceptor = new ApiResponseInterceptor();

  it('wraps plain results into { success, data, error, meta }', async () => {
    const response = await firstValueFrom(interceptor.intercept(context, next({ id: 1 })));
    expect(response).toEqual({ success: true, data: { id: 1 }, error: null, meta: null });
  });

  it('normalizes undefined to null data', async () => {
    const response = await firstValueFrom(interceptor.intercept(context, next(undefined)));
    expect(response).toEqual({ success: true, data: null, error: null, meta: null });
  });

  it('unpacks ApiPayload with meta (pagination)', async () => {
    const payload = new ApiPayload([1, 2], { pagination: { page: 1, limit: 10, total: 2 } });
    const response = await firstValueFrom(interceptor.intercept(context, next(payload)));
    expect(response).toEqual({
      success: true,
      data: [1, 2],
      error: null,
      meta: { pagination: { page: 1, limit: 10, total: 2 } },
    });
  });
});
