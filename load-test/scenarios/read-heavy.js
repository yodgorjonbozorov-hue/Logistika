import { sleep } from 'k6';
import http from 'k6/http';
import { API, authed, ipFor, login, ok, userFor } from '../lib/session.js';

/**
 * What a logist's browser actually does: the trip list, a trip's finance, and
 * the live map polling every 30 seconds.
 *
 * These are the three reads TASK-4.1 and TASK-4.2 rewrote, so this scenario is
 * the one that says whether those rewrites hold under concurrency rather than
 * only in an EXPLAIN.
 *
 * Each virtual user gets its own login and its own source address. Sharing one
 * of either turns the run into a measurement of the rate limiter — the first
 * attempt at this test failed 97% of its requests with 429 for exactly that
 * reason, which is a finding about the test, not about the API.
 */
const VUS = Number(__ENV.VUS || 100);
const USERS = Number(__ENV.USERS || 200);
const PASSWORD = __ENV.PASSWORD || 'LoadTest1!';

export const options = {
  scenarios: {
    logists: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: VUS },
        { duration: __ENV.DURATION || '30s', target: VUS },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    // A list a person is waiting for; anything slower reads as a broken page.
    'http_req_duration{name:GET /trips}': ['p(95)<500'],
    // The map polls on a timer, so a slow response is a queue of slow responses.
    'http_req_duration{name:GET /tracking/live}': ['p(95)<300'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  // A fresh identity for the setup login too: /auth/login is capped at 5 per
  // minute per IP and the per-identifier budget is hourly, both deliberately.
  // Reusing one address made every run after the fifth fail in setup.
  const ip = `10.254.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  // A random block of accounts, so a second run in the same hour does not
  // reuse the identifiers the first one already spent.
  const offset = Math.floor(Math.random() * USERS);
  const token = login(userFor(0, USERS, offset), PASSWORD, ip);
  const trips = http.get(`${API}/trips?limit=20&withTotal=false`, authed(token, 'setup', ip));
  return { offset, tripIds: trips.json('data').map((trip) => trip.id) };
}

/** One login per VU, kept for the whole run: argon2 is meant to be expensive. */
let session;

export default function (data) {
  const ip = ipFor(__VU);
  if (!session) {
    session = login(userFor(__VU, USERS, data.offset), PASSWORD, ip);
    if (!session) {
      // Back off rather than spin: retrying a refusal immediately is how a
      // load generator ends up load-testing its own retry loop.
      sleep(10);
      return;
    }
  }

  const { tripIds } = data;
  const tripId = tripIds[__VU % tripIds.length];

  ok(http.get(`${API}/trips?page=1&limit=20`, authed(session, 'GET /trips', ip)), 'trips');
  ok(
    http.get(
      `${API}/expenses?tripId=${tripId}&limit=100&withTotal=false`,
      authed(session, 'GET /expenses', ip),
    ),
    'expenses',
  );
  ok(http.get(`${API}/tracking/live`, authed(session, 'GET /tracking/live', ip)), 'live');

  // A logist reads, thinks, then reads again. Without this the test measures
  // how fast k6 can shout, not how the API behaves behind a real screen.
  sleep(1);
}
