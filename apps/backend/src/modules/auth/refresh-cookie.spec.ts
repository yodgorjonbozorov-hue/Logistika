/**
 * The refresh cookie's attributes decide whether a session survives at all.
 *
 * This was verified in a real browser before it was written down here: with
 * `SameSite=Strict` and the app and API on separate registrable domains, the
 * browser does not store the cookie — it never reaches the jar, the refresh
 * call goes out without it, and the first reload lands the user on /login. So
 * the interesting cases below are not "does it set a cookie" but "does each
 * deployment shape get attributes that actually work for it".
 */
import type { Response } from 'express';
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie } from './refresh-cookie';

function captureCookie() {
  const calls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const response = {
    cookie: (name: string, value: string, options: Record<string, unknown>) =>
      calls.push({ name, value, options }),
    clearCookie: (name: string, options: Record<string, unknown>) =>
      calls.push({ name, value: '', options }),
  } as unknown as Response;
  return { response, calls };
}

describe('refresh cookie attributes', () => {
  it('is httpOnly and path-scoped whatever the deployment shape', () => {
    const { response, calls } = captureCookie();
    setRefreshCookie(response, 'token', { isProduction: true, sameSite: 'strict', ttl: '30d' });

    expect(calls[0]!.name).toBe(REFRESH_COOKIE);
    expect(calls[0]!.options).toMatchObject({
      httpOnly: true,
      // Scoped so it is never attached to an endpoint that changes business
      // data — those need the Authorization header.
      path: '/api/v1/auth',
    });
  });

  it('uses Strict and Secure for a same-origin production deployment', () => {
    const { response, calls } = captureCookie();
    setRefreshCookie(response, 'token', { isProduction: true, sameSite: 'strict', ttl: '30d' });
    expect(calls[0]!.options).toMatchObject({ sameSite: 'strict', secure: true });
  });

  it('carries the configured lifetime', () => {
    const { response, calls } = captureCookie();
    setRefreshCookie(response, 'token', { isProduction: true, sameSite: 'strict', ttl: '30d' });
    expect(calls[0]!.options.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('drops Secure in development so the dev login flow works over http', () => {
    const { response, calls } = captureCookie();
    setRefreshCookie(response, 'token', { isProduction: false, sameSite: 'strict', ttl: '15m' });
    expect(calls[0]!.options.secure).toBe(false);
  });

  it('forces Secure with SameSite=None even outside production', () => {
    // Browsers reject `SameSite=None` without `Secure`, so a cross-site
    // development setup that is not Secure would have no cookie at all — the
    // exact failure this setting exists to avoid.
    const { response, calls } = captureCookie();
    setRefreshCookie(response, 'token', { isProduction: false, sameSite: 'none', ttl: '15m' });
    expect(calls[0]!.options).toMatchObject({ sameSite: 'none', secure: true });
  });

  it('clears with the same attributes it set — otherwise logout leaves the cookie', () => {
    const { response, calls } = captureCookie();
    const context = { isProduction: true, sameSite: 'none' as const };
    setRefreshCookie(response, 'token', { ...context, ttl: '30d' });
    clearRefreshCookie(response, context);

    const [set, cleared] = calls;
    // A browser matches a clear against name + path + domain; differing
    // attributes make it a different cookie and the old one survives.
    expect(cleared!.options.path).toBe(set!.options.path);
    expect(cleared!.options.sameSite).toBe(set!.options.sameSite);
    expect(cleared!.options.secure).toBe(set!.options.secure);
  });
});
