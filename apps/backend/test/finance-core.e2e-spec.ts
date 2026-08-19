/**
 * Finance core (TZ §6, Roadmap 7) on real PostgreSQL.
 *
 * Every figure asserted below is a literal, computed by hand from the fixture
 * and checked against the integer arithmetic in `finance.math`. Nothing here
 * recomputes an expectation with the code under test, because a test that says
 * `expect(profit).toBe(revenue - expenses)` proves only that subtraction works.
 *
 * The fixture rows are inserted through Prisma rather than HTTP: a finance
 * rollup is a read-only view over history, and history needs exact
 * `finished_at`, `actual_distance_km` and back-dated months that the trip
 * lifecycle endpoints deliberately will not let a caller forge. The endpoints
 * themselves are always exercised over real HTTP, through the real guards.
 *
 * Fixture (company A, all money in tiyin, 1 so'm = 100 tiyin):
 *
 *   vehicles   V1 «norm 30.00 L/100km», V2 «norm 25.00 L/100km»
 *   routes     R1 «Toshkent–Samarqand», R2 «Toshkent–Buxoro»
 *
 *   trip  route  vehicle  distance  price          status       period
 *   T0    R1     V1        400.0    1 000 000 000  COMPLETED    previous month
 *   T1    R1     V1        500.0      900 000 000  COMPLETED    this month
 *   T2    R1     V1        500.0      800 000 000  COMPLETED    this month
 *   T3    R2     V2        300.5      500 000 000  COMPLETED    this month
 *   T4    —      V2          —        100 000 000  IN_PROGRESS  this month
 *
 *   expenses   T0 FUEL 400 000 000 (previous month)
 *              T1 FUEL 300 000 000, T1 TOLL 20 000 000
 *              T2 FUEL 250 000 000
 *              T3 FUEL 150 000 000
 *              V1 REPAIR 40 000 000 (no trip — booked against the truck)
 *
 *   fuel logs  V1 150.00 L / 300 000 000   V1 160.00 L / 250 000 000
 *              V2 100.50 L / 150 000 000
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import {
  api,
  auth,
  createCompany,
  createTestApp,
  createUser,
  login,
  prisma,
  resetDatabase,
  resetRateLimits,
  uniqueSuffix,
  type TestCompany,
  type TestUser,
} from './harness';

const FINANCE_ENDPOINTS = [
  '/api/v1/finance/summary',
  '/api/v1/finance/trips',
  '/api/v1/finance/routes',
  '/api/v1/finance/vehicles',
  '/api/v1/finance/monthly',
  '/api/v1/finance/fuel',
] as const;

/** The month the fixture lives in, anchored in UTC like every stored timestamp. */
const NOW = new Date();
const YEAR = NOW.getUTCFullYear();
const MONTH = NOW.getUTCMonth();
const monthStart = new Date(Date.UTC(YEAR, MONTH, 1));
const nextMonthStart = new Date(Date.UTC(YEAR, MONTH + 1, 1));
const day = (n: number): Date => new Date(Date.UTC(YEAR, MONTH, n, 12));
const previousMonthDay = new Date(Date.UTC(YEAR, MONTH - 1, 10, 12));
const monthKey = (offset: number): string => {
  const d = new Date(Date.UTC(YEAR, MONTH + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** `from`/`to` covering exactly the fixture month. */
const thisMonth = { from: monthStart.toISOString(), to: nextMonthStart.toISOString() };

/**
 * `/finance/monthly` takes a month count rather than a date range, and the
 * global pipe runs with `forbidNonWhitelisted` — sending it `from`/`to` is a
 * 400, not a wider window.
 */
const queryFor = (path: string): Record<string, string | number> =>
  path.endsWith('/monthly') ? { months: 3 } : thisMonth;

interface Fixture {
  company: TestCompany;
  owner: TestUser;
  vehicle1: string;
  vehicle2: string;
  route1: string;
  route2: string;
  trips: Record<'T0' | 'T1' | 'T2' | 'T3' | 'T4', string>;
}

/**
 * Builds the documented fixture for one company. Called twice in the isolation
 * test so that company B holds a full, differently-priced book of its own —
 * an isolation test against an empty neighbour proves much less.
 */
async function seedCompany(app: NestExpressApplication, priceScale: bigint): Promise<Fixture> {
  const company = await createCompany();
  const owner = await login(app, company.owner);
  const suffix = uniqueSuffix().slice(-5).toUpperCase();

  const [vehicle1, vehicle2] = await Promise.all([
    prisma.vehicle.create({
      data: {
        companyId: company.id,
        plateNumber: `01A${suffix}`,
        fuelNormPer100km: new Prisma.Decimal('30.00'),
      },
    }),
    prisma.vehicle.create({
      data: {
        companyId: company.id,
        plateNumber: `01B${suffix}`,
        fuelNormPer100km: new Prisma.Decimal('25.00'),
      },
    }),
  ]);

  const [route1, route2] = await Promise.all([
    prisma.route.create({
      data: {
        companyId: company.id,
        name: 'Toshkent-Samarqand',
        originName: 'Toshkent',
        destinationName: 'Samarqand',
        plannedDistanceKm: new Prisma.Decimal('300.0'),
      },
    }),
    prisma.route.create({
      data: {
        companyId: company.id,
        name: 'Toshkent-Buxoro',
        originName: 'Toshkent',
        destinationName: 'Buxoro',
        plannedDistanceKm: new Prisma.Decimal('580.0'),
      },
    }),
  ]);

  const trip = async (
    number: string,
    data: {
      routeId?: string;
      vehicleId: string;
      distanceKm?: string;
      price: bigint;
      status: 'COMPLETED' | 'IN_PROGRESS';
      startedAt: Date;
      finishedAt?: Date;
    },
  ): Promise<string> => {
    const row = await prisma.trip.create({
      data: {
        companyId: company.id,
        tripNumber: number,
        routeId: data.routeId,
        vehicleId: data.vehicleId,
        actualDistanceKm: data.distanceKm ? new Prisma.Decimal(data.distanceKm) : null,
        agreedPrice: data.price * priceScale,
        status: data.status,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
      },
    });
    return row.id;
  };

  const trips = {
    T0: await trip('T-0000', {
      routeId: route1.id,
      vehicleId: vehicle1.id,
      distanceKm: '400.0',
      price: 1_000_000_000n,
      status: 'COMPLETED',
      startedAt: previousMonthDay,
      finishedAt: previousMonthDay,
    }),
    T1: await trip('T-0001', {
      routeId: route1.id,
      vehicleId: vehicle1.id,
      distanceKm: '500.0',
      price: 900_000_000n,
      status: 'COMPLETED',
      startedAt: day(10),
      finishedAt: day(10),
    }),
    T2: await trip('T-0002', {
      routeId: route1.id,
      vehicleId: vehicle1.id,
      distanceKm: '500.0',
      price: 800_000_000n,
      status: 'COMPLETED',
      startedAt: day(11),
      finishedAt: day(11),
    }),
    T3: await trip('T-0003', {
      routeId: route2.id,
      vehicleId: vehicle2.id,
      distanceKm: '300.5',
      price: 500_000_000n,
      status: 'COMPLETED',
      startedAt: day(12),
      finishedAt: day(12),
    }),
    T4: await trip('T-0004', {
      vehicleId: vehicle2.id,
      price: 100_000_000n,
      status: 'IN_PROGRESS',
      startedAt: day(13),
    }),
  };

  await prisma.expense.createMany({
    data: [
      {
        companyId: company.id,
        tripId: trips.T0,
        category: 'FUEL',
        amount: 400_000_000n * priceScale,
        expenseDate: previousMonthDay,
      },
      {
        companyId: company.id,
        tripId: trips.T1,
        category: 'FUEL',
        amount: 300_000_000n * priceScale,
        expenseDate: day(10),
      },
      {
        companyId: company.id,
        tripId: trips.T1,
        category: 'TOLL',
        amount: 20_000_000n * priceScale,
        expenseDate: day(10),
      },
      {
        companyId: company.id,
        tripId: trips.T2,
        category: 'FUEL',
        amount: 250_000_000n * priceScale,
        expenseDate: day(11),
      },
      {
        companyId: company.id,
        tripId: trips.T3,
        category: 'FUEL',
        amount: 150_000_000n * priceScale,
        expenseDate: day(12),
      },
      {
        companyId: company.id,
        vehicleId: vehicle1.id,
        category: 'REPAIR',
        amount: 40_000_000n * priceScale,
        expenseDate: day(14),
      },
    ],
  });

  await prisma.fuelLog.createMany({
    data: [
      {
        companyId: company.id,
        vehicleId: vehicle1.id,
        tripId: trips.T1,
        liters: new Prisma.Decimal('150.00'),
        totalAmount: 300_000_000n * priceScale,
        refuelTime: day(10),
      },
      {
        companyId: company.id,
        vehicleId: vehicle1.id,
        tripId: trips.T2,
        liters: new Prisma.Decimal('160.00'),
        totalAmount: 250_000_000n * priceScale,
        refuelTime: day(11),
      },
      {
        companyId: company.id,
        vehicleId: vehicle2.id,
        tripId: trips.T3,
        liters: new Prisma.Decimal('100.50'),
        totalAmount: 150_000_000n * priceScale,
        refuelTime: day(12),
      },
    ],
  });

  return {
    company,
    owner,
    vehicle1: vehicle1.id,
    vehicle2: vehicle2.id,
    route1: route1.id,
    route2: route2.id,
    trips,
  };
}

describe('Finance core', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Aggregations
  // ---------------------------------------------------------------------------

  describe('aggregations', () => {
    let fixture: Fixture;

    beforeAll(async () => {
      await resetDatabase();
      resetRateLimits(app);
      fixture = await seedCompany(app, 1n);
    });

    const get = (path: string, query: Record<string, string | number> = {}) =>
      api(app).get(path).query(query).set(auth(fixture.owner.accessToken));

    it('GET /finance/summary — revenue, expenses, profit and margin to the tiyin', async () => {
      const { body } = await get('/api/v1/finance/summary', thisMonth).expect(200);
      const data = body.data;

      // 900 000 000 + 800 000 000 + 500 000 000 + 100 000 000
      expect(data.revenue).toBe('2300000000');
      // 300 + 20 + 250 + 150 + 40 (millions), T0's 400M is last month's
      expect(data.expenses).toBe('760000000');
      expect(data.profit).toBe('1540000000');
      expect(data.marginBp).toBe(6696); // 66.96 %

      // Fuel is recorded twice over — as FUEL expenses and as fuel logs, both
      // 700 000 000. Reported once, not added into 1 400 000 000.
      expect(data.fuelCost).toBe('700000000');
      expect(data.fuelLitres).toBe('410.50');

      expect(data.trips).toEqual({ total: 4, completed: 3, cancelled: 0, inProgress: 1 });
      expect(data.trucksDispatched).toBe(2);
      expect(data.routesUsed).toBe(2); // T4 has no route and is not counted
      expect(data.distanceKm).toBe('1300.5');

      expect(data.costPerKm).toBe('584391');
      expect(data.revenuePerKm).toBe('1768551');
      expect(data.profitPerKm).toBe('1184160');
      expect(data.profitPerTrip).toBe('385000000');
    });

    it('GET /finance/summary — expenses break down by category with shares', async () => {
      const { body } = await get('/api/v1/finance/summary', thisMonth).expect(200);
      expect(body.data.expensesByCategory).toEqual([
        { category: 'FUEL', amount: '700000000', shareBp: 9211 },
        { category: 'REPAIR', amount: '40000000', shareBp: 526 },
        { category: 'TOLL', amount: '20000000', shareBp: 263 },
      ]);
    });

    it('GET /finance/summary — money never crosses the wire as a JSON number', async () => {
      const response = await get('/api/v1/finance/summary', thisMonth).expect(200);
      // Read the raw body: a JSON number would have been silently coerced to a
      // double before `expect` ever saw it.
      expect(response.text).toContain('"revenue":"2300000000"');
      expect(response.text).not.toMatch(/"revenue":\s*\d/);
    });

    it('GET /finance/trips — per-trip P&L, newest first', async () => {
      const { body } = await get('/api/v1/finance/trips', thisMonth).expect(200);
      expect(body.meta.pagination).toEqual({ page: 1, limit: 20, total: 4 });
      const rows = body.data;
      expect(rows).toHaveLength(4);

      const t1 = rows.find((r: { tripNumber: string }) => r.tripNumber === 'T-0001');
      expect(t1).toMatchObject({
        status: 'COMPLETED',
        routeName: 'Toshkent-Samarqand',
        distanceKm: '500.0',
        revenue: '900000000',
        expenses: '320000000', // 300M fuel + 20M toll
        fuelCost: '300000000',
        profit: '580000000',
        marginBp: 6444, // 58/90
        profitPerKm: '1160000',
      });

      // The in-progress trip has revenue and no expenses yet — a 100 % margin
      // is the honest answer, not a reason to hide the row.
      const t4 = rows.find((r: { tripNumber: string }) => r.tripNumber === 'T-0004');
      expect(t4).toMatchObject({
        status: 'IN_PROGRESS',
        routeId: null,
        routeName: null,
        distanceKm: '0.0',
        revenue: '100000000',
        expenses: '0',
        profit: '100000000',
        marginBp: 10_000,
        profitPerKm: null, // no distance — null, never a misleading 0
      });
    });

    it('GET /finance/trips — filters by route and by vehicle without changing the maths', async () => {
      const byRoute = await get('/api/v1/finance/trips', {
        ...thisMonth,
        routeId: fixture.route1,
      }).expect(200);
      const routeRows = byRoute.body.data;
      expect(routeRows.map((r: { tripNumber: string }) => r.tripNumber).sort()).toEqual([
        'T-0001',
        'T-0002',
      ]);

      const byVehicle = await get('/api/v1/finance/trips', {
        ...thisMonth,
        vehicleId: fixture.vehicle2,
      }).expect(200);
      const vehicleRows = byVehicle.body.data;
      expect(vehicleRows.map((r: { tripNumber: string }) => r.tripNumber).sort()).toEqual([
        'T-0003',
        'T-0004',
      ]);
    });

    it('GET /finance/trips — paginates without moving the totals', async () => {
      const page1 = await get('/api/v1/finance/trips', { ...thisMonth, page: 1, limit: 2 }).expect(
        200,
      );
      const page2 = await get('/api/v1/finance/trips', { ...thisMonth, page: 2, limit: 2 }).expect(
        200,
      );
      const rows1 = page1.body.data;
      const rows2 = page2.body.data;
      expect(rows1).toHaveLength(2);
      expect(rows2).toHaveLength(2);
      // Same total on both pages, and no row served twice.
      expect(page1.body.meta.pagination.total).toBe(4);
      expect(page2.body.meta.pagination.total).toBe(4);
      const numbers = [...rows1, ...rows2].map((r: { tripNumber: string }) => r.tripNumber);
      expect(new Set(numbers).size).toBe(4);
    });

    it('GET /finance/routes — profit per route and per kilometre', async () => {
      const { body } = await get('/api/v1/finance/routes', thisMonth).expect(200);
      const rows = body.data;
      expect(rows).toHaveLength(3);

      // Ordered by revenue, so the busiest lane leads.
      expect(rows[0]).toMatchObject({
        routeName: 'Toshkent-Samarqand',
        trips: 2,
        completedTrips: 2,
        distanceKm: '1000.0',
        revenue: '1700000000',
        expenses: '570000000',
        profit: '1130000000',
        marginBp: 6647,
        profitPerTrip: '565000000',
        profitPerKm: '1130000',
      });
      expect(rows[1]).toMatchObject({
        routeName: 'Toshkent-Buxoro',
        trips: 1,
        revenue: '500000000',
        expenses: '150000000',
        profit: '350000000',
        marginBp: 7000,
        profitPerKm: '1164725',
      });
      // Trips with no route are their own bucket, not silently dropped.
      expect(rows[2]).toMatchObject({
        routeId: null,
        routeName: 'UNASSIGNED',
        trips: 1,
        revenue: '100000000',
        profit: '100000000',
        profitPerKm: null,
      });

      // Every route's revenue must add back up to the company total.
      const total = rows.reduce(
        (sum: bigint, r: { revenue: string }) => sum + BigInt(r.revenue),
        0n,
      );
      expect(total.toString()).toBe('2300000000');
    });

    it('GET /finance/vehicles — includes expenses booked against the truck itself', async () => {
      const { body } = await get('/api/v1/finance/vehicles', thisMonth).expect(200);
      const rows = body.data;
      expect(rows).toHaveLength(2);

      // 570M of trip expenses + the 40M repair booked directly on the truck.
      expect(rows[0]).toMatchObject({
        vehicleId: fixture.vehicle1,
        trips: 2,
        distanceKm: '1000.0',
        revenue: '1700000000',
        expenses: '610000000',
        profit: '1090000000',
        marginBp: 6412,
        profitPerKm: '1090000',
        fuelLitres: '310.00',
        fuelCost: '550000000',
        consumption: '31.00',
        normConsumption: '30.00',
        deviationBp: 333, // 3.33 % over norm — under the 7 % alert line
      });

      expect(rows[1]).toMatchObject({
        vehicleId: fixture.vehicle2,
        trips: 2,
        distanceKm: '300.5', // T4 has no measured distance yet
        revenue: '600000000',
        expenses: '150000000',
        profit: '450000000',
        consumption: '33.44',
        normConsumption: '25.00',
        deviationBp: 3376,
      });
    });

    it('GET /finance/fuel — flags only the vehicle past the 7 % norm threshold', async () => {
      const { body } = await get('/api/v1/finance/fuel', thisMonth).expect(200);
      const rows = body.data;
      expect(rows).toHaveLength(2);

      expect(rows[0]).toMatchObject({
        vehicleId: fixture.vehicle1,
        refuels: 2,
        litres: '310.00',
        cost: '550000000',
        distanceKm: '1000.0',
        consumption: '31.00',
        normConsumption: '30.00',
        deviationBp: 333,
        overNorm: false,
      });
      expect(rows[1]).toMatchObject({
        vehicleId: fixture.vehicle2,
        refuels: 1,
        litres: '100.50',
        cost: '150000000',
        consumption: '33.44',
        deviationBp: 3376,
        overNorm: true,
      });
    });

    it('GET /finance/monthly — month-over-month change against the previous month', async () => {
      const { body } = await get('/api/v1/finance/monthly', { months: 12 }).expect(200);
      const rows = body.data;
      expect(rows).toHaveLength(12);
      expect(rows[11].month).toBe(monthKey(0));

      const previous = rows.find((r: { month: string }) => r.month === monthKey(-1));
      expect(previous).toMatchObject({
        trips: 1,
        trucksDispatched: 1,
        routesUsed: 1,
        distanceKm: '400.0',
        revenue: '1000000000',
        expenses: '400000000',
        profit: '600000000',
        marginBp: 6000,
      });

      expect(rows[11]).toMatchObject({
        trips: 4,
        trucksDispatched: 2,
        routesUsed: 2,
        distanceKm: '1300.5',
        revenue: '2300000000',
        expenses: '760000000',
        profit: '1540000000',
        marginBp: 6696,
        revenueChangeBp: 13_000, // +130 %
        profitChangeBp: 15_667, // +156.67 %
      });

      // A month with no activity is a zero row, not a gap in the series.
      const quiet = rows.find((r: { month: string }) => r.month === monthKey(-5));
      expect(quiet).toMatchObject({ trips: 0, revenue: '0', profit: '0', revenueChangeBp: null });
    });

    it('an empty period returns zeroes and nulls, never NaN or Infinity', async () => {
      const from = new Date(Date.UTC(YEAR - 3, 0, 1)).toISOString();
      const to = new Date(Date.UTC(YEAR - 3, 1, 1)).toISOString();
      const { body } = await get('/api/v1/finance/summary', { from, to }).expect(200);
      expect(body.data).toMatchObject({
        revenue: '0',
        expenses: '0',
        profit: '0',
        marginBp: 0,
        costPerKm: null,
        profitPerTrip: null,
        distanceKm: '0.0',
        expensesByCategory: [],
      });
      // A double-based implementation would have divided by zero somewhere and
      // serialised the result; `null` here is deliberate, `NaN` never is.
      expect(JSON.stringify(body)).not.toMatch(/NaN|Infinity/);
    });
  });

  // ---------------------------------------------------------------------------
  // Precision
  // ---------------------------------------------------------------------------

  describe('BigInt precision', () => {
    let owner: TestUser;

    beforeAll(async () => {
      await resetDatabase();
      resetRateLimits(app);
      const company = await createCompany();
      owner = await login(app, company.owner);
      const vehicle = await prisma.vehicle.create({
        data: {
          companyId: company.id,
          plateNumber: `01P${uniqueSuffix().slice(-5).toUpperCase()}`,
        },
      });
      // Two amounts either side of Number.MAX_SAFE_INTEGER (9 007 199 254 740 991).
      // Summed as doubles they collapse; summed as BigInt they are exact.
      await prisma.trip.create({
        data: {
          companyId: company.id,
          tripNumber: 'BIG-1',
          vehicleId: vehicle.id,
          agreedPrice: 9_007_199_254_740_993n,
          status: 'COMPLETED',
          startedAt: day(10),
          finishedAt: day(10),
        },
      });
      await prisma.trip.create({
        data: {
          companyId: company.id,
          tripNumber: 'BIG-2',
          vehicleId: vehicle.id,
          agreedPrice: 1n,
          status: 'COMPLETED',
          startedAt: day(10),
          finishedAt: day(10),
        },
      });
      await prisma.expense.create({
        data: {
          companyId: company.id,
          category: 'OTHER',
          amount: 3n,
          expenseDate: day(10),
        },
      });
    });

    it('sums past Number.MAX_SAFE_INTEGER without losing a tiyin', async () => {
      const { body } = await api(app)
        .get('/api/v1/finance/summary')
        .query(thisMonth)
        .set(auth(owner.accessToken))
        .expect(200);

      expect(body.data.revenue).toBe('9007199254740994');
      expect(body.data.profit).toBe('9007199254740991');
      expect(BigInt(body.data.revenue) - BigInt(body.data.profit)).toBe(3n);

      // The figure a double-based sum would have produced instead: 9 007 199
      // 254 740 993 is not representable, so it rounds down and the +1 vanishes.
      expect(Number('9007199254740993') + 1).toBe(9_007_199_254_740_992);
      expect(body.data.revenue).not.toBe('9007199254740992');
    });
  });

  // ---------------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------------

  describe('tenant isolation', () => {
    let a: Fixture;
    let b: Fixture;

    beforeAll(async () => {
      await resetDatabase();
      resetRateLimits(app);
      a = await seedCompany(app, 1n);
      b = await seedCompany(app, 7n); // same shape, seven times the money
    });

    it("company B's totals are its own, never the sum of both books", async () => {
      const { body } = await api(app)
        .get('/api/v1/finance/summary')
        .query(thisMonth)
        .set(auth(b.owner.accessToken))
        .expect(200);
      expect(body.data.revenue).toBe('16100000000'); // 2 300 000 000 × 7
      expect(body.data.expenses).toBe('5320000000');
      expect(body.data.trips.total).toBe(4); // not 8
    });

    it.each(FINANCE_ENDPOINTS)('%s never leaks a row across the tenant boundary', async (path) => {
      const query = queryFor(path);
      const [forA, forB] = await Promise.all([
        api(app).get(path).query(query).set(auth(a.owner.accessToken)).expect(200),
        api(app).get(path).query(query).set(auth(b.owner.accessToken)).expect(200),
      ]);

      // Every identifier company A sees must be absent from company B's payload.
      const idsOfA = [a.vehicle1, a.vehicle2, a.route1, a.route2, ...Object.values(a.trips)];
      const bodyOfB = JSON.stringify(forB.body);
      for (const id of idsOfA) expect(bodyOfB).not.toContain(id);

      const idsOfB = [b.vehicle1, b.vehicle2, b.route1, b.route2, ...Object.values(b.trips)];
      const bodyOfA = JSON.stringify(forA.body);
      for (const id of idsOfB) expect(bodyOfA).not.toContain(id);
    });

    it('a routeId belonging to another company filters to nothing, it does not read across', async () => {
      const { body } = await api(app)
        .get('/api/v1/finance/trips')
        .query({ ...thisMonth, routeId: a.route1 })
        .set(auth(b.owner.accessToken))
        .expect(200);
      expect(body.data).toHaveLength(0);
    });

    it('a vehicleId belonging to another company filters to nothing', async () => {
      const { body } = await api(app)
        .get('/api/v1/finance/trips')
        .query({ ...thisMonth, vehicleId: a.vehicle1 })
        .set(auth(b.owner.accessToken))
        .expect(200);
      expect(body.data).toHaveLength(0);
    });

    it('the monthly series is per company too', async () => {
      const { body } = await api(app)
        .get('/api/v1/finance/monthly')
        .query({ months: 3 })
        .set(auth(b.owner.accessToken))
        .expect(200);
      expect(body.data[body.data.length - 1].revenue).toBe('16100000000');
    });
  });

  // ---------------------------------------------------------------------------
  // Authorisation
  // ---------------------------------------------------------------------------

  describe('authorisation', () => {
    let owner: TestUser;
    let driver: TestUser;
    let accountant: TestUser;

    beforeAll(async () => {
      await resetDatabase();
      resetRateLimits(app);
      const company = await createCompany();
      owner = await login(app, company.owner);
      driver = await login(app, await createUser(company.id, 'DRIVER'));
      accountant = await login(app, await createUser(company.id, 'ACCOUNTANT'));
    });
    beforeEach(() => resetRateLimits(app));

    it.each(FINANCE_ENDPOINTS)('%s rejects an anonymous caller', async (path) => {
      await api(app).get(path).expect(401);
    });

    it.each(FINANCE_ENDPOINTS)('%s rejects a DRIVER', async (path) => {
      // A driver must not be able to read the company's P&L. Backend-enforced —
      // hiding the menu item in the web app would not be a control.
      await api(app).get(path).set(auth(driver.accessToken)).expect(403);
    });

    it.each(FINANCE_ENDPOINTS)('%s allows an ACCOUNTANT', async (path) => {
      await api(app).get(path).set(auth(accountant.accessToken)).expect(200);
    });

    it('rejects a companyId smuggled in the query string', async () => {
      // `whitelist: true` + `forbidNonWhitelisted` means an attempt to override
      // the tenant from the wire is a 400, not a silent success.
      await api(app)
        .get('/api/v1/finance/summary')
        .query({ ...thisMonth, companyId: '00000000-0000-4000-8000-000000000000' })
        .set(auth(owner.accessToken))
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Query bounds
  // ---------------------------------------------------------------------------

  describe('query validation', () => {
    let owner: TestUser;

    beforeAll(async () => {
      await resetDatabase();
      resetRateLimits(app);
      const company = await createCompany();
      owner = await login(app, company.owner);
    });
    beforeEach(() => resetRateLimits(app));

    it('refuses a range wider than 400 days rather than scanning the whole history', async () => {
      await api(app)
        .get('/api/v1/finance/summary')
        .query({
          from: new Date(Date.UTC(YEAR - 5, 0, 1)).toISOString(),
          to: new Date(Date.UTC(YEAR, 0, 1)).toISOString(),
        })
        .set(auth(owner.accessToken))
        .expect(400);
    });

    it('refuses an inverted range', async () => {
      await api(app)
        .get('/api/v1/finance/summary')
        .query({ from: thisMonth.to, to: thisMonth.from })
        .set(auth(owner.accessToken))
        .expect(400);
    });

    it('refuses a date that is not a date', async () => {
      await api(app)
        .get('/api/v1/finance/summary')
        .query({ from: 'yesterday-ish' })
        .set(auth(owner.accessToken))
        .expect(400);
    });

    it('caps the trips page size', async () => {
      await api(app)
        .get('/api/v1/finance/trips')
        .query({ ...thisMonth, limit: 5000 })
        .set(auth(owner.accessToken))
        .expect(400);
    });

    it('caps the monthly window', async () => {
      await api(app)
        .get('/api/v1/finance/monthly')
        .query({ months: 500 })
        .set(auth(owner.accessToken))
        .expect(400);
    });

    it('defaults to the last 30 days when no period is given', async () => {
      const { body } = await api(app)
        .get('/api/v1/finance/summary')
        .set(auth(owner.accessToken))
        .expect(200);
      const spanDays =
        (new Date(body.data.to).getTime() - new Date(body.data.from).getTime()) / 86_400_000;
      expect(spanDays).toBeGreaterThan(29.9);
      expect(spanDays).toBeLessThan(30.1);
    });
  });
});
