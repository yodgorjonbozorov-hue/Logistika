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
});
