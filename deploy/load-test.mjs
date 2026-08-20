/**
 * Concurrent load test against a running TruckAI deployment.
 *
 *   node deploy/load-test.mjs --url https://api.staging.truckcontrol.local \
 *     --identifier owner@example.uz --password '…' --duration 15 --concurrency 20
 *
 * Deliberately dependency-free: it runs on the deployment host with nothing
 * installed, and it is the same script in CI, on staging and on production.
 *
 * What it reports per endpoint: throughput, the status-code distribution, and
 * p50/p95/p99. The status distribution matters as much as the latency — a run
 * that looks fast because 80% of it was rejected with 429 is not a fast run,
 * and a summary of latency alone would hide that.
 *
 * Note on rate limits: the production limits are per user and per minute, so a
 * sustained load test from ONE account will hit them. That is the limiter
 * working. To measure the application rather than the limiter, raise
 * RATE_LIMIT_MAX on the target for the duration of the run, and say so in the
 * report.
 */
import { randomUUID } from 'node:crypto';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const BASE = (args.url ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const DURATION_MS = Number(args.duration ?? 10) * 1000;
const CONCURRENCY = Number(args.concurrency ?? 10);

// A self-signed staging certificate is not a reason to skip the test.
if (args.insecure === 'true') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const percentile = (sorted, p) =>
  sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function login() {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: args.identifier, password: args.password }),
  });
  const body = await response.json();
  if (!body?.data?.accessToken) {
    throw new Error(`login failed (${response.status}): ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.data.accessToken;
}

/** Runs one endpoint at CONCURRENCY for DURATION_MS and returns its statistics. */
async function measure(name, request, token) {
  const latencies = [];
  const statuses = new Map();
  const deadline = Date.now() + DURATION_MS;
  let errors = 0;

  const worker = async () => {
    while (Date.now() < deadline) {
      const started = process.hrtime.bigint();
      try {
        const response = await fetch(`${API}${request.path}`, {
          method: request.method ?? 'GET',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            // A distinct id per request so a slow one can be found in the log.
            'x-request-id': randomUUID(),
          },
          body: request.body ? JSON.stringify(request.body) : undefined,
        });
        await response.arrayBuffer(); // drain, or the timing excludes the body
        latencies.push(Number(process.hrtime.bigint() - started) / 1e6);
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      } catch {
        errors++;
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const sorted = latencies.slice().sort((a, b) => a - b);
  const seconds = DURATION_MS / 1000;
  return {
    name,
    requests: latencies.length,
    rps: (latencies.length / seconds).toFixed(1),
    statuses: [...statuses.entries()]
      .sort()
      .map(([code, n]) => `${code}×${n}`)
      .join(' '),
    p50: percentile(sorted, 50).toFixed(1),
    p95: percentile(sorted, 95).toFixed(1),
    p99: percentile(sorted, 99).toFixed(1),
    max: (sorted.at(-1) ?? 0).toFixed(1),
    errors,
  };
}

const SCENARIOS = [
  ['finance summary', { path: '/finance/summary' }],
  ['finance monthly', { path: '/finance/monthly' }],
  ['trips list', { path: '/trips?page=1&limit=20' }],
  ['vehicles list', { path: '/vehicles?page=1&limit=20' }],
  ['tracking live', { path: '/tracking/live' }],
  ['ai insights', { path: '/ai/insights' }],
  [
    'ai chat',
    {
      path: '/ai/chat',
      method: 'POST',
      body: { question: 'Bu oy qancha foyda?', locale: 'uz-latn' },
    },
  ],
];

const token = await login();
console.log(`target ${BASE} · ${CONCURRENCY} concurrent · ${DURATION_MS / 1000}s per endpoint\n`);
console.log(
  'endpoint'.padEnd(18) +
    'req'.padStart(7) +
    'rps'.padStart(8) +
    'p50'.padStart(8) +
    'p95'.padStart(8) +
    'p99'.padStart(8) +
    'max'.padStart(9) +
    '  statuses',
);

let failed = false;
for (const [name, request] of SCENARIOS) {
  const r = await measure(name, request, token);
  console.log(
    r.name.padEnd(18) +
      String(r.requests).padStart(7) +
      r.rps.padStart(8) +
      `${r.p50}ms`.padStart(8) +
      `${r.p95}ms`.padStart(8) +
      `${r.p99}ms`.padStart(8) +
      `${r.max}ms`.padStart(9) +
      `  ${r.statuses}${r.errors ? ` errors×${r.errors}` : ''}`,
  );
  // A 5xx under load is a failure of the run, not a slow result.
  if (/ 5\d\d×| ^5\d\d×/.test(` ${r.statuses}`) || r.errors > 0) failed = true;
}

process.exit(failed ? 1 : 0);
