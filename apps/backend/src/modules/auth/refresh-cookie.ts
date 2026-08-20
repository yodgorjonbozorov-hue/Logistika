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

/** How the deployment is laid out, which decides what SameSite can be. */
export type CookieSameSite = 'strict' | 'none';

export interface CookieContext {
  isProduction: boolean;
  sameSite: CookieSameSite;
}

/**
 * `sameSite` is configuration, not a constant, because the right answer depends
 * on where the app is served from — and getting it wrong is invisible.
 *
 * `strict` is correct and strongest when the app and the API share an origin.
 * When they do not — the app on Vercel, the API on its own domain — the browser
 * does not merely decline to send a Strict cookie on cross-site requests: it
 * REFUSES TO STORE IT AT ALL. Verified in a real browser across two separate
 * registrable domains: the cookie never appears in the jar, the refresh call
 * goes out without it, and the user is bounced to the login page by the first
 * reload or as soon as the 15-minute access token expires.
 *
 * `none` is the only value that works cross-site, and it requires `secure`,
 * which production already is. The CSRF exposure it would otherwise open is
 * closed separately by the Origin check on the auth routes — see
 * auth.controller.ts — so this is not a trade of a working session against a
 * forged one.
 */
function baseOptions(context: CookieContext): CookieOptions {
  return {
    httpOnly: true,
    // Secure would make the cookie invisible over plain http://localhost during
    // development, breaking the dev login flow for no security benefit there.
    // `sameSite: 'none'` REQUIRES Secure, so a cross-site development setup has
    // to use https — browsers drop the cookie otherwise.
    secure: context.isProduction || context.sameSite === 'none',
    sameSite: context.sameSite,
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(
  response: Response,
  token: string,
  options: CookieContext & { ttl: string },
): void {
  response.cookie(REFRESH_COOKIE, token, {
    ...baseOptions(options),
    maxAge: ttlToSeconds(options.ttl) * 1000,
  });
}

export function clearRefreshCookie(response: Response, context: CookieContext): void {
  // The attributes must match the ones the cookie was set with, or the browser
  // treats it as a different cookie and the old one survives the logout.
  response.clearCookie(REFRESH_COOKIE, baseOptions(context));
}
