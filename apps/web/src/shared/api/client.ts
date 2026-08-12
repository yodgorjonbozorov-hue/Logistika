import type { ApiMeta, ApiResponse } from 'shared';
import i18n from '../i18n';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

/** Static demo build (VITE_DEMO=1): every request is served from ./demo.ts. */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

const ACCESS_KEY = 'tc.access';
const REFRESH_KEY = 'tc.refresh';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

async function rawRequest<T>(path: string, options: RequestOptions): Promise<ApiResponse<T>> {
  if (IS_DEMO) {
    const { demoRequest } = await import('./demo');
    return demoRequest<T>(path, options);
  }
  const url = new URL(API_URL + path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { 'accept-language': i18n.language };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (tokenStore.access) headers.authorization = `Bearer ${tokenStore.access}`;

  const response = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return (await response.json().catch(() => ({
    success: false,
    data: null,
    error: { code: 'INTERNAL_ERROR', message: i18n.t('common.errorGeneric') },
    meta: null,
  }))) as ApiResponse<T>;
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return false;
  const result = await rawRequest<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  });
  if (result.success && result.data) {
    tokenStore.set(result.data.accessToken, result.data.refreshToken);
    return true;
  }
  tokenStore.clear();
  return false;
}

/** Authenticated file download (report exports) — saves via a temporary link. */
export async function apiDownload(
  path: string,
  query: Record<string, string | number | undefined>,
): Promise<void> {
  const url = new URL(API_URL + path, window.location.origin);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { 'accept-language': i18n.language };
  if (tokenStore.access) headers.authorization = `Bearer ${tokenStore.access}`;
  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    throw new ApiError('INTERNAL_ERROR', i18n.t('common.errorGeneric'), undefined, response.status);
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'report';
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

/** Unwraps the { success, data, error, meta } envelope; auto-refreshes once on expiry. */
export async function api<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta: ApiMeta | null }> {
  let result = await rawRequest<T>(path, options);

  if (!result.success && result.error?.code === 'AUTH_TOKEN_EXPIRED') {
    if (await tryRefresh()) {
      result = await rawRequest<T>(path, options);
    } else {
      window.dispatchEvent(new CustomEvent('tc:logout'));
    }
  }

  if (!result.success || result.error) {
    const error = result.error ?? {
      code: 'INTERNAL_ERROR',
      message: i18n.t('common.errorGeneric'),
    };
    throw new ApiError(error.code, error.message, error.details);
  }
  return { data: result.data as T, meta: result.meta };
}
