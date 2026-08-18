import { check, sleep } from 'k6';
import http from 'k6/http';
import { API, authed, ipFor, login, userFor } from '../lib/session.js';

/**
 * What a fleet of phones does: GPS batches every few minutes.
 *
 * The interesting part is not raw throughput but what happens on a repeat —
 * every VU re-sends its previous batch on purpose, because that is the case
 * TASK-4.5 made idempotent and the one a flaky mobile network produces all day.
 *
 * One VU is one phone, so one driver: "one active trip per driver" (TASK-3.10)
 * means a fleet with one driver is a fleet with one moving truck, however many
 * VUs are pointed at it.
 */
const VUS = Number(__ENV.VUS || 40);
const USERS = Number(__ENV.USERS || 2000);
const PASSWORD = __ENV.PASSWORD || 'LoadTest1!';

export const options = {
  scenarios: {
    phones: {
      executor: 'constant-vus',
      vus: VUS,
      duration: __ENV.DURATION || '30s',
    },
  },
  thresholds: {
    // A phone on a village road will retry anyway; what must not happen is the
    // request hanging long enough for the OS to kill the background task.
    'http_req_duration{name:POST /tracking/positions}': ['p(95)<1000'],
    checks: ['rate>0.99'],
  },
};

/**
 * Discovery runs as a logist: `GET /trips` is forbidden to DRIVER by design
 * (drivers see their own work through the mobile endpoints), so a driver token
 * cannot be used to find out what is on the road.
 */
export function setup() {
  const ip = `10.253.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const token = login(userFor(0, USERS, Math.floor(Math.random() * USERS)), PASSWORD, ip);
  const res = http.get(
    `${API}/trips?limit=100&status=IN_PROGRESS&withTotal=false`,
    authed(token, 'setup', ip),
  );
  // The seed puts the driver's index in the trip number (TR-LIVE-<i>-…), which
  // is how a VU knows which login owns which trip. Posting to someone else's
  // trip is answered 200 with `accepted: 0` — every point silently dropped —
  // so guessing here produced a green run that stored nothing at all.
  const trips = res
    .json('data')
    .map((trip) => ({ id: trip.id, driver: Number(String(trip.tripNumber).split('-')[2]) }))
    .filter((trip) => Number.isInteger(trip.driver));
  if (trips.length < VUS) {
    // Said out loud rather than left to show up as mysterious 429s: sharing a
    // driver account between VUs breaks the 60/min per-user cap on
    // /tracking/positions, which exists because a real phone reports every
    // 2–5 minutes. More phones means more seeded drivers.
    console.warn(
      `only ${trips.length} trips on the road for ${VUS} VUs — reseed with --vehicles ${VUS}`,
    );
  }
  return { trips };
}

/** A batch of ten points, two minutes apart. */
function batch(tripId, offsetMinutes) {
  const base = Date.now() - offsetMinutes * 60_000;
  return Array.from({ length: 10 }, (_, i) => ({
    tripId,
    lat: 41.3 + i / 10_000,
    lng: 69.2 + i / 10_000,
    speed: 60 + i,
    recordedAt: new Date(base + i * 120_000).toISOString(),
  }));
}

let phone;

export default function (data) {
  const { trips } = data;
  if (trips.length === 0) return;
  const ip = ipFor(__VU);
  const mine = trips[__VU % trips.length];

  if (!phone) {
    const token = login(`driver${mine.driver}@loadtest.test`, PASSWORD, ip);
    if (!token) {
      // Back off rather than spin: retrying a refusal immediately is how a load
      // generator ends up load-testing its own retry loop.
      sleep(10);
      return;
    }
    phone = { token, tripId: mine.id };
  }

  const fresh = batch(phone.tripId, __ITER * 20 + __VU * 1000);
  const first = http.post(
    `${API}/tracking/positions`,
    JSON.stringify({ positions: fresh }),
    authed(phone.token, 'POST /tracking/positions', ip),
  );
  // 2xx is not enough: a trip that is not this driver's is answered 200 with
  // every point dropped, which is how this scenario once ran green and stored
  // nothing.
  check(first, { 'positions stored': (r) => r.json('data.accepted') === fresh.length });

  // The same batch again: a phone that died between the response and its own
  // bookkeeping. Must be cheap, and must store nothing (TASK-4.5).
  const repeat = http.post(
    `${API}/tracking/positions`,
    JSON.stringify({ positions: fresh }),
    authed(phone.token, 'POST /tracking/positions (repeat)', ip),
  );
  check(repeat, {
    'repeat stored nothing': (r) =>
      r.json('data.accepted') === 0 && r.json('data.duplicates') === fresh.length,
  });

  // TZ §3.3: phones report every 2–5 minutes to save battery. Compressed here
  // so a 30-second run still covers many batches.
  sleep(2);
}
