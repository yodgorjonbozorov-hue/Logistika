import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const API = `${BASE_URL}/api/v1`;

/**
 * Logs in and returns the token, or `null` if the server refused.
 *
 * Deliberately not `fail()`: an aborted iteration skips its `sleep`, so a
 * single 429 turned into a tight retry loop that produced thousands more
 * logins per second and buried every real measurement. A load generator that
 * amplifies its own rejections is measuring itself.
 */
export function login(email, password, ip) {
  const res = http.post(`${API}/auth/login`, JSON.stringify({ identifier: email, password }), {
    headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
    tags: { name: 'POST /auth/login' },
  });
  const good = check(res, { 'login 200': (r) => r.status === 200 });
  if (!good) {
    console.warn(`login ${email} failed: ${res.status} ${String(res.body).slice(0, 120)}`);
    return null;
  }
  return res.json('data.accessToken');
}

export const authed = (token, name, ip) => ({
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...(ip ? { 'x-forwarded-for': ip } : {}),
  },
  tags: { name },
});

/**
 * A distinct source address per virtual user.
 *
 * The per-IP limit is 120/min and login is capped at 5/min/IP, while every VU
 * here comes from the same loopback address. Real users do not share one IP,
 * so without this the run measures the anti-abuse layer instead of the
 * application.
 */
export const ipFor = (vu) => `10.${(vu >> 16) & 255}.${(vu >> 8) & 255}.${vu & 255}`;

/**
 * The login this virtual user owns, seeded by load-test/seed.mjs.
 *
 * `offset` moves the whole run to a different block of accounts. The
 * per-identifier budget is hourly, so without it a second run in the same hour
 * reuses accounts the first run already spent.
 */
export const userFor = (vu, count, offset = 0) => `logist${(vu + offset) % count}@loadtest.test`;

/** One check per request, so the failure rate in the summary means something. */
export function ok(res, label) {
  return check(res, { [`${label} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
}
