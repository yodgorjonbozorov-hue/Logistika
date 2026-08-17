import type { ApiMeta, ApiResponse } from 'shared';
import i18n from '../i18n';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';



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

/**
 * The access token lives in memory only.
 *
 * localStorage is readable by any script on the page, so a single XSS used to
 * hand an attacker both tokens — including a 30-day refresh token. The refresh
 * token is now an httpOnly cookie the page cannot read at all, and the short
 * access token is lost on reload, where the cookie silently re-issues it.
 */
let accessToken: string | null = null;

export const tokenStore = {
  get access() {
    return accessToken;
  },
  set(access: string) {
    accessToken = access;
  },
  clear() {
    accessToken = null;
  },
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

async function rawRequest<T>(path: string, options: RequestOptions): Promise<ApiResponse<T>> {
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
    // Sends the httpOnly refresh cookie on the auth routes.
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return (await response.json().catch(() => ({
    success: false,
    data: null,
    error: { code: 'INTERNAL_ERROR', message: i18n.t('common.errorGeneric') },
    meta: null,
  }))) as ApiResponse<T>;
}

/**
 * Single-flight refresh.
 *
 * A page load fires several queries at once; when the access token has expired
 * they all get AUTH_TOKEN_EXPIRED together. Without this, each one would rotate
 * the refresh token: the first succeeds, the rest present a token that no
 * longer exists and get logged out — the "it signs me out for no reason"
 * complaint. Now they all await the same in-flight refresh.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  // No token is sent: the browser attaches the httpOnly cookie itself.
  const result = await rawRequest<{ accessToken: string }>('/auth/refresh', {
    method: 'POST',
    body: {},
  });
  if (result.success && result.data) {
    tokenStore.set(result.data.accessToken);
    return true;
  }
  tokenStore.clear();
  return false;
}

export async function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
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
