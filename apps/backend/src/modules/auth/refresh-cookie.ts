import type { CookieOptions, Request, Response } from 'express';

/** Scoped to the auth routes: no other endpoint has any use for it. */
export const REFRESH_COOKIE = 'tc_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * The refresh token lives in an httpOnly cookie for browsers.
 *
 * In localStorage it was readable by any script on the page, so one XSS handed
 * an attacker a 30-day credential. httpOnly keeps it out of JavaScript
 * entirely; SameSite=Strict keeps it off cross-site requests, which is also
 * what makes CSRF a non-issue for these routes.
 *
 * Native clients do not use cookies — they keep sending the token in the body,
 * stored in the platform keychain (see token_store.dart).
 */
export function refreshCookieOptions(isProduction: boolean, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    // Secure would make the cookie unusable over plain http in development.
    secure: isProduction,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

export function setRefreshCookie(
  res: Response,
  token: string,
  isProduction: boolean,
  maxAgeMs: number,
): void {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(isProduction, maxAgeMs));
}

export function clearRefreshCookie(res: Response, isProduction: boolean): void {
  res.clearCookie(REFRESH_COOKIE, {
    ...refreshCookieOptions(isProduction, 0),
    maxAge: undefined,
  });
}

/**
 * The cookie wins when present (browser), the body is the fallback (mobile).
 * Preferring the cookie means a page cannot be tricked into presenting some
 * other token that happens to be in a request body.
 */
export function readRefreshToken(req: Request, bodyToken?: string): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[REFRESH_COOKIE] ?? bodyToken;
}
