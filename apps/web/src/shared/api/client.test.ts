import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, tokenStore } from './client';

function mockFetchOnce(body: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    json: () => Promise.resolve(body),
  });
}

describe('api client', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
    tokenStore.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('unwraps the success envelope', async () => {
    mockFetchOnce({ success: true, data: { id: '1' }, error: null, meta: null });
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
    tokenStore.set('stale-access', 'valid-refresh');
    mockFetchOnce({
      success: false,
      data: null,
      error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' },
      meta: null,
    });
    mockFetchOnce({
      success: true,
      data: { accessToken: 'new-access', refreshToken: 'new-refresh' },
      error: null,
      meta: null,
    });
    mockFetchOnce({ success: true, data: { ok: true }, error: null, meta: null });

    const { data } = await api<{ ok: boolean }>('/trips');

    expect(data.ok).toBe(true);
    expect(tokenStore.access).toBe('new-access');
    expect(tokenStore.refresh).toBe('new-refresh');
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('sends the bearer token and passes query params', async () => {
    tokenStore.set('my-access', 'my-refresh');
    mockFetchOnce({ success: true, data: [], error: null, meta: null });

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

  it('refreshes once when several parallel requests hit an expired token', async () => {
    tokenStore.set('expired-access', 'refresh-1');
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
    const ok = { success: true, data: { id: '1' }, error: null, meta: null };

    const calls: string[] = [];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      calls.push(url);
      if (url.includes('/auth/refresh')) return Promise.resolve({ json: () => Promise.resolve(refreshed) });
      // Every business call fails once with an expired token, then succeeds.
      const isRetry = calls.filter((c) => c === url).length > 1;
      return Promise.resolve({ json: () => Promise.resolve(isRetry ? ok : expired) });
    });

    const results = await Promise.all([api('/trips'), api('/drivers'), api('/vehicles')]);

    // The whole point: one rotation, not three. Three would leave two requests
    // holding a token the server has already replaced.
    expect(calls.filter((c) => c.includes('/auth/refresh'))).toHaveLength(1);
    expect(results).toHaveLength(3);
    expect(tokenStore.access).toBe('new-access');
  });

  it('starts a fresh refresh after the previous one settled', async () => {
    tokenStore.set('expired-access', 'refresh-1');
    const expired = {
      success: false,
      data: null,
      error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' },
      meta: null,
    };
    const refreshed = {
      success: true,
      data: { accessToken: 'a', refreshToken: 'r' },
      error: null,
      meta: null,
    };
    const ok = { success: true, data: null, error: null, meta: null };

    let refreshes = 0;
    let businessCalls = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) {
        refreshes++;
        return Promise.resolve({ json: () => Promise.resolve(refreshed) });
      }
      businessCalls++;
      // Fail on the first call of each round, succeed on the retry.
      return Promise.resolve({
        json: () => Promise.resolve(businessCalls % 2 === 1 ? expired : ok),
      });
    });

    await api('/trips');
    await api('/trips');

    // The in-flight promise is cleared once settled, so a later expiry can
    // still refresh — single-flight, not once-per-session.
    expect(refreshes).toBe(2);
  });
});