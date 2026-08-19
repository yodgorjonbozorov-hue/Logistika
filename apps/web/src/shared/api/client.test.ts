import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, restoreSession, tokenStore } from './client';

function mockFetchOnce(body: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    json: () => Promise.resolve(body),
  });
}

const expired = {
  success: false,
  data: null,
  error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' },
  meta: null,
};
const refreshed = {
  success: true,
  data: { accessToken: 'new-access', refreshToken: 'new-refresh' },
  error: null,
  meta: null,
};
const ok = (data: unknown) => ({ success: true, data, error: null, meta: null });

describe('api client', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
    tokenStore.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('unwraps the success envelope', async () => {
    mockFetchOnce(ok({ id: '1' }));
    const { data } = await api<{ id: string }>('/trips/1');
    expect(data.id).toBe('1');
  });

  it('throws ApiError with the machine-readable code on failure', async () => {
    mockFetchOnce({
      success: false,
      data: null,
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: "Login yoki parol noto'g'ri" },
      meta: null,
    });
    await expect(api('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      message: "Login yoki parol noto'g'ri",
    });
  });

  it('refreshes once on AUTH_TOKEN_EXPIRED and retries the request', async () => {
    tokenStore.set('stale-access');
    mockFetchOnce(expired);
    mockFetchOnce(refreshed);
    mockFetchOnce(ok({ ok: true }));

    const { data } = await api<{ ok: boolean }>('/trips');

    expect(data.ok).toBe(true);
    expect(tokenStore.access).toBe('new-access');
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('sends the bearer token and passes query params', async () => {
    tokenStore.set('my-access');
    mockFetchOnce(ok([]));

    await api('/trips', { query: { page: 2, status: 'DRAFT', empty: undefined } });

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain('page=2');
    expect(String(url)).toContain('status=DRAFT');
    expect(String(url)).not.toContain('empty=');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer my-access');
  });

  it('exposes ApiError as Error instance', () => {
    const error = new ApiError('NOT_FOUND', 'topilmadi');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // H-16 — the refresh token is never touched by JavaScript
  // -------------------------------------------------------------------------

  describe('token storage (H-16)', () => {
    it('keeps the access token in memory, never in localStorage', () => {
      tokenStore.set('secret-access');
      expect(tokenStore.access).toBe('secret-access');

      const persisted = Object.keys(localStorage).map((key) => localStorage.getItem(key));
      expect(persisted).not.toContain('secret-access');
    });

    it('persists only a non-credential session marker', () => {
      tokenStore.set('secret-access');
      expect(localStorage.getItem('tc.session')).toBe('1');
      tokenStore.clear();
      expect(localStorage.getItem('tc.session')).toBeNull();
      expect(tokenStore.access).toBeNull();
    });

    it('sends credentials so the httpOnly refresh cookie travels', async () => {
      mockFetchOnce(ok([]));
      await api('/trips');
      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(init.credentials).toBe('include');
    });

    it('never puts a refresh token in the refresh request body', async () => {
      tokenStore.set('stale-access');
      mockFetchOnce(expired);
      mockFetchOnce(refreshed);
      mockFetchOnce(ok({ ok: true }));

      await api('/trips');

      const [, refreshInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]!;
      expect(refreshInit.body).toBe('{}');
    });

    it('restores a session on reload only when the marker is present', async () => {
      expect(await restoreSession()).toBe(false);
      expect(globalThis.fetch).not.toHaveBeenCalled();

      tokenStore.set('old');
      mockFetchOnce(refreshed);
      expect(await restoreSession()).toBe(true);
      expect(tokenStore.access).toBe('new-access');
    });
  });

  // -------------------------------------------------------------------------
  // H-10 — parallel 401s must not race each other into a logout
  // -------------------------------------------------------------------------

  describe('single-flight refresh (H-10)', () => {
    it('five parallel expired requests trigger exactly ONE refresh call', async () => {
      tokenStore.set('stale-access');
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

      fetchMock.mockImplementation((url: string | URL, init?: { body?: string }) => {
        const href = String(url);
        if (href.includes('/auth/refresh')) {
          expect(init?.body).toBe('{}');
          // Deliberately async so the other callers really are in flight.
          return new Promise((resolve) =>
            setTimeout(() => resolve({ json: () => Promise.resolve(refreshed) }), 10),
          );
        }
        return Promise.resolve({
          json: () =>
            Promise.resolve(tokenStore.access === 'new-access' ? ok({ ok: true }) : expired),
        });
      });

      const results = await Promise.all([
        api<{ ok: boolean }>('/trips'),
        api<{ ok: boolean }>('/drivers'),
        api<{ ok: boolean }>('/vehicles'),
        api<{ ok: boolean }>('/clients'),
        api<{ ok: boolean }>('/expenses'),
      ]);

      for (const result of results) expect(result.data.ok).toBe(true);

      const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/auth/refresh'),
      );
      expect(refreshCalls).toHaveLength(1);
    });

    it('a failed refresh logs out once, not once per pending request', async () => {
      tokenStore.set('stale-access');
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const logoutEvents = vi.fn();
      window.addEventListener('tc:logout', logoutEvents);

      fetchMock.mockImplementation((url: string | URL) =>
        String(url).includes('/auth/refresh')
          ? new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    json: () =>
                      Promise.resolve({
                        success: false,
                        data: null,
                        error: { code: 'AUTH_REFRESH_INVALID', message: 'gone' },
                        meta: null,
                      }),
                  }),
                10,
              ),
            )
          : Promise.resolve({ json: () => Promise.resolve(expired) }),
      );

      await Promise.allSettled([api('/trips'), api('/drivers'), api('/vehicles')]);

      const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/auth/refresh'),
      );
      expect(refreshCalls).toHaveLength(1);
      expect(tokenStore.access).toBeNull();
      window.removeEventListener('tc:logout', logoutEvents);
    });

    it('a later expiry starts a fresh refresh rather than reusing the old promise', async () => {
      tokenStore.set('stale-access');
      mockFetchOnce(expired);
      mockFetchOnce(refreshed);
      mockFetchOnce(ok({ first: true }));
      await api('/trips');

      mockFetchOnce(expired);
      mockFetchOnce(refreshed);
      mockFetchOnce(ok({ second: true }));
      const { data } = await api<{ second: boolean }>('/trips');

      expect(data.second).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(6);
    });
  });
});
