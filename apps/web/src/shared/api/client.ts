import type { ApiMeta, ApiResponse } from 'shared';
import i18n from '../i18n';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

/**
 * Marks "there is probably a session" so a reload can attempt a silent refresh.
 * It is NOT a credential — the refresh token itself lives in an httpOnly cookie
 * the browser attaches automatically and JavaScript cannot read (H-16).
 */
const SESSION_FLAG = 'tc.session';

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
 * Access token storage.
 *
 * Deliberately a module-level variable rather than `localStorage`: a token in
 * localStorage is readable by any script that ends up on the page (an XSS, a
 * compromised dependency), and the refresh token used to sit there for 30 days.
 * In memory the blast radius of the same XSS is one short-lived access token,
 * and it dies with the tab.
 */
let accessToken: string | null = null;

/**
 * The store is observable, and that is not a refinement — it is what makes
 * logging in work at all.
 *
 * `AuthProvider` reads the session out of here to decide whether to fetch the
 * current user and whether the route guard should let anyone through. While
 * this was a plain module variable, `login()` wrote the token and NOTHING
 * re-rendered: the `/auth/me` query stayed disabled, the context kept handing
 * out `hasSession: false`, and `ProtectedRoute` bounced the freshly
 * authenticated user straight back to /login. React's own
 * `useSyncExternalStore` is the supported way to read mutable external state,
 * so the store publishes a snapshot and notifies on every change.
 */
export interface SessionSnapshot {
  /** An access token is held in memory, so requests can be made right now. */
  hasAccess: boolean;
  /** A refresh cookie is expected to exist — the session may still be restoring. */
  hasSession: boolean;
}

const readFlag = (): boolean =>
  typeof localStorage !== 'undefined' && localStorage.getItem(SESSION_FLAG) === '1';

// Cached: getSnapshot must return a referentially stable value between changes,
// or useSyncExternalStore re-renders forever.
let snapshot: SessionSnapshot = { hasAccess: false, hasSession: readFlag() };
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = { hasAccess: accessToken !== null, hasSession: readFlag() };
  for (const listener of listeners) listener();
}

export const tokenStore = {
  get access(): string | null {
    return accessToken;
  },
  /** True when a refresh cookie is expected to exist — not a credential. */
  get hasSession(): boolean {
    return readFlag();
  },
  set(access: string) {
    accessToken = access;
    localStorage.setItem(SESSION_FLAG, '1');
    publish();
  },
  clear() {
    accessToken = null;
    localStorage.removeItem(SESSION_FLAG);
    publish();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): SessionSnapshot {
    return snapshot;
  },
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
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
    // Required for the httpOnly refresh cookie to travel with /auth requests.
    credentials: 'include',
    signal: options.signal,
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
 * In-flight refresh, shared by every caller (H-10).
 *
 * A dashboard fires half a dozen requests at once; when the access token
 * expires they all get AUTH_TOKEN_EXPIRED at the same moment. Each used to
 * start its own refresh — the first rotated the token, the rest presented the
 * now-revoked one, got a 401 and dumped the user on the login page mid-session.
 * (Server-side, replaying a rotated token now also trips reuse detection and
 * kills the whole family, so this is not cosmetic.)
 *
 * Everyone after the first waits on the same promise and then retries once.
 */
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const result = await rawRequest<{ accessToken: string; refreshToken: string }>(
        '/auth/refresh',
        { method: 'POST', body: {} },
      );
      if (result.success && result.data) {
        tokenStore.set(result.data.accessToken);
        return true;
      }
      tokenStore.clear();
      return false;
    } catch {
      // A network failure is not proof the session is gone; do not log the
      // user out over a dropped connection.
      return false;
    } finally {
      // Cleared in a microtask so callers that awaited this exact promise all
      // observe the same result before a new attempt can start.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();
  return refreshInFlight;
}

/** Exposed for the app shell: restores a session on a full page reload. */
export async function restoreSession(): Promise<boolean> {
  if (!tokenStore.hasSession) return false;
  return refreshSession();
}

/** Unwraps the { success, data, error, meta } envelope; auto-refreshes once on expiry. */
export async function api<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta: ApiMeta | null }> {
  let result = await rawRequest<T>(path, options);

  if (!result.success && result.error?.code === 'AUTH_TOKEN_EXPIRED') {
    if (await refreshSession()) {
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
