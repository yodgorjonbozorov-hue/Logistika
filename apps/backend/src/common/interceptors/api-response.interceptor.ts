import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { ApiMeta, ApiResponse } from 'shared';

/** Controllers return this when a response needs `meta` (pagination etc.). */
export class ApiPayload<T> {
  constructor(
    readonly data: T,
    readonly meta: ApiMeta,
  ) {}
}

@Injectable()
export class ApiResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((result) => {
        if (result instanceof ApiPayload) {
          return { success: true, data: result.data as T, error: null, meta: result.meta };
        }
        return { success: true, data: result ?? null, error: null, meta: null };
      }),
    );
  }
}
