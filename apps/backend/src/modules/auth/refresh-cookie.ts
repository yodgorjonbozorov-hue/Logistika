import type { CookieOptions, Response } from 'express';
import { ttlToSeconds } from './auth.service';

/**
 * Refresh-token cookie (H-16).
 *
 * The web app used to keep the 30-day refresh token in `localStorage`, where
 * any XSS — a compromised npm dependency is enough — could read it and hold a
 * month-long session. As an httpOnly cookie the token is unreachable from
 * JavaScript, so the worst an injected script can steal is the in-memory access
 * token, which expires in minutes.
 *
 * The token is ALSO still returned in the response body: the Flutter driver app
 * is not a browser and stores it in the platform keystore instead.
 *
 * CSRF is addressed by construction rather than by a token:
 *   - `sameSite: 'strict'` means the cookie is never attached to a cross-site
 *     request, so another origin cannot even trigger a refresh;
 *   - `path` scopes it to the auth routes, so it is not sent to any endpoint
 *     that changes business data — those need the Authorization header, which
 *     a cross-site attacker cannot set.
 */
export const REFRESH_COOKIE = 'tc_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function baseOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    // Secure would make the cookie invisible over plain http://localhost during
    // development, breaking the dev login flow for no security benefit there.
    secure: isProduction,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(
  response: Response,
  token: string,
  options: { isProduction: boolean; ttl: string },
): void {
  response.cookie(REFRESH_COOKIE, token, {
    ...baseOptions(options.isProduction),
    maxAge: ttlToSeconds(options.ttl) * 1000,
  });
}

export function clearRefreshCookie(response: Response, isProduction: boolean): void {
  response.clearCookie(REFRESH_COOKIE, baseOptions(isProduction));
}
