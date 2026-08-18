/**
 * Realistic data for the load test (TASK-4.6).
 *
 * 40 vehicles, 100k trips, 1M ledger entries — the audit's target scale. Bulk
 * `COPY`-style inserts through raw SQL rather than Prisma `create` calls: a
 * million rows one round-trip at a time takes hours and measures nothing.
 *
 * Idempotent: run it twice and it tops up rather than duplicating.
 *
 *   node load-test/seed.mjs [--trips 100000] [--ledger 1000000]
 */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Resolved against the backend rather than this folder: load-test is
// deliberately outside the pnpm workspace, so it does not drag itself into
// lint, build and test gates that have nothing to say about it.
const backendRequire = createRequire(new URL('../apps/backend/package.json', import.meta.url));
const { PrismaClient } = backendRequire('@prisma/client');
const argon2 = backendRequire('argon2');
backendRequire('dotenv').config({ path: new URL('../.env', import.meta.url).pathname });

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
};

const TRIPS = arg('trips', 100_000);
const LEDGER = arg('ledger', 1_000_000);
const VEHICLES = arg('vehicles', 40);
const GPS_DAYS = arg('gpsDays', 7);
/** Distinct logins, so the rate limiter is not what the run measures. */
const USERS = arg('users', 200);
const PASSWORD = process.env.LOAD_TEST_PASSWORD || 'LoadTest1!';
const CHUNK = 5_000;

const prisma = new PrismaClient();

const chunked = (total, size) => {
  const out = [];
  for (let start = 0; start < total; start += size) out.push(Math.min(size, total - start));
  return out;
};

async function company() {
  const existing = await prisma.company.findFirst({ where: { name: 'Load Test' } });
  if (existing) return existing;
  return prisma.company.create({ data: { name: 'Load Test', isActive: true } });
}

/**
 * One user per virtual user, not one user shared by all of them.
 *
 * The rate limiter counts per authenticated user (600/min) and per IP
 * (120/min). A thousand VUs behind a single login is a thousand people sharing
 * one person's budget, so the run measures the throttle rather than the API —
 * which is exactly what the first attempt at this test did. In production a
 * thousand concurrent users are a thousand separate budgets.
 */
async function users(companyId) {
  const passwordHash = await argon2.hash(PASSWORD);
  const make = (role, email, fullName) =>
    prisma.user.upsert({
      where: { email },
      update: { passwordHash, isActive: true, companyId, role },
      create: { companyId, email, fullName, role, passwordHash },
    });

  const owner = await make('OWNER', 'owner@loadtest.test', 'Load Owner');
  for (let i = 0; i < USERS; i += 1) {
    await make('LOGIST', `logist${i}@loadtest.test`, `Load Logist ${i}`);
  }

  // One driver per vehicle, because "one active trip per driver" is a real
  // rule (TASK-3.10): a single seeded driver can hold exactly one IN_PROGRESS
  // trip, so a fleet of one driver is a fleet with one moving truck.
  const drivers = [];
  for (let i = 0; i < VEHICLES; i += 1) {
    const user = await make('DRIVER', `driver${i}@loadtest.test`, `Load Driver ${i}`);
    drivers.push(
      await prisma.driver.upsert({
        where: { userId: user.id },
        update: {},
        create: { companyId, userId: user.id, fullName: `Load Driver ${i}` },
      }),
    );
  }
  return { owner, drivers };
}

async function fleet(companyId) {
  const have = await prisma.vehicle.count({ where: { companyId } });
  for (let i = have; i < VEHICLES; i += 1) {
    await prisma.vehicle.create({
      data: { companyId, plateNumber: `01L${String(i).padStart(4, '0')}` },
    });
  }
  const client = await prisma.client.findFirst({ where: { companyId, name: 'Load Client' } });
  return {
    vehicles: await prisma.vehicle.findMany({ where: { companyId }, select: { id: true } }),
    client:
      client ??
      (await prisma.client.create({
        data: { companyId, name: 'Load Client', paymentTermsDays: 14 },
      })),
  };
}

async function trips(companyId, { vehicles, client, drivers }) {
  const have = await prisma.trip.count({ where: { companyId } });
  const missing = Math.max(0, TRIPS - have);
  if (missing > 0) {
    console.log(`trips: ${have} → ${TRIPS}`);
    let made = 0;
    for (const size of chunked(missing, CHUNK)) {
      const rows = Array.from({ length: size }, (_, i) => {
        const n = have + made + i;
        return {
          id: randomUUID(),
          companyId,
          tripNumber: `TR-LOAD-${n}`,
          clientId: client.id,
          vehicleId: vehicles[n % vehicles.length].id,
          driverId: drivers[n % drivers.length].id,
          status: 'COMPLETED',
          agreedPrice: BigInt(5_000_000 + (n % 100) * 10_000),
          createdAt: new Date(Date.now() - (n % 365) * 86_400_000),
        };
      });
      await prisma.trip.createMany({ data: rows, skipDuplicates: true });
      made += size;
      process.stdout.write(`\r  ${made}/${missing}`);
    }
    process.stdout.write('\n');
  }

  // One trip on the road per driver, which is the most the rules allow and
  // exactly what a working fleet looks like.
  const active = await prisma.trip.count({ where: { companyId, status: 'IN_PROGRESS' } });
  if (active >= drivers.length) return;
  for (const [i, driver] of drivers.entries()) {
    await prisma.trip
      .create({
        data: {
          companyId,
          tripNumber: `TR-LIVE-${i}-${randomUUID().slice(0, 6)}`,
          clientId: client.id,
          vehicleId: vehicles[i % vehicles.length].id,
          driverId: driver.id,
          status: 'IN_PROGRESS',
          agreedPrice: 9_000_000n,
        },
      })
      .catch(() => undefined); // already has one on the road
  }
}

async function ledger(companyId, clientId, ownerId) {
  const have = await prisma.ledgerEntry.count({ where: { companyId } });
  const missing = Math.max(0, LEDGER - have);
  if (missing === 0) return;
  console.log(`ledger: ${have} → ${LEDGER}`);

  let made = 0;
  for (const size of chunked(missing, CHUNK)) {
    const rows = Array.from({ length: size }, (_, i) => {
      const n = have + made + i;
      const debit = n % 3 !== 0;
      return {
        companyId,
        clientId,
        direction: debit ? 'DEBIT' : 'CREDIT',
        reason: debit ? 'TRIP_INVOICED' : 'PAYMENT_RECEIVED',
        amount: BigInt(100_000 + (n % 50) * 1_000),
        amountBase: BigInt(100_000 + (n % 50) * 1_000),
        createdById: ownerId,
        createdAt: new Date(Date.now() - (n % 700) * 86_400_000),
      };
    });
    await prisma.ledgerEntry.createMany({ data: rows });
    made += size;
    process.stdout.write(`\r  ${made}/${missing}`);
  }
  process.stdout.write('\n');
}

/**
 * GPS points at the real reporting rate, so the live map and history are asked
 * the question they are asked in production rather than a toy one.
 */
async function gps(companyId, vehicles) {
  const have = await prisma.gpsTrack.count({ where: { companyId } });
  if (have > 0) return;
  const perVehicle = (GPS_DAYS * 24 * 60 * 60) / 30;
  console.log(`gps: ${vehicles.length} vehicles × ${perVehicle} points`);

  for (const [index, vehicle] of vehicles.entries()) {
    for (let start = 0; start < perVehicle; start += CHUNK) {
      const size = Math.min(CHUNK, perVehicle - start);
      await prisma.gpsTrack.createMany({
        data: Array.from({ length: size }, (_, i) => ({
          companyId,
          vehicleId: vehicle.id,
          lat: 41.3 + ((start + i) % 1_000) / 10_000,
          lng: 69.2 + ((start + i) % 1_000) / 10_000,
          speed: 60,
          recordedAt: new Date(Date.now() - (start + i) * 30_000),
        })),
        skipDuplicates: true,
      });
    }
    process.stdout.write(`\r  vehicle ${index + 1}/${vehicles.length}`);
  }
  process.stdout.write('\n');
}

const started = Date.now();
const co = await company();
const { owner, drivers } = await users(co.id);
const { vehicles, client } = await fleet(co.id);
await trips(co.id, { vehicles, client, drivers });
await ledger(co.id, client.id, owner.id);
await gps(co.id, vehicles);
console.log(`done in ${Math.round((Date.now() - started) / 1000)}s — company ${co.id}`);
await prisma.$disconnect();
