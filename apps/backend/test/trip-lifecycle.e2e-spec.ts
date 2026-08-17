import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import '../src/common/serialization';

/**
 * The end-to-end smoke path of the whole product (docs/ROADMAP.md, stage 9):
 *
 *   open a trip → assign it → driver presses the ten buttons → the truck shows
 *   up on the live map → a receipt is read by AI-2 and confirmed by a person →
 *   the confirmed record is posted through the ordinary endpoints → the trip
 *   P&L and the dashboard show the money.
 *
 * Every step goes over HTTP with a real token, so route guards, DTO validation,
 * the tenant extension and the money serialization are all exercised the way a
 * client meets them. The numbers below are chosen so the P&L is asserted
 * exactly, not «greater than zero»: a formula that silently changes fails here.
 *
 *   docker compose up -d postgres
 *   DATABASE_URL=... pnpm --filter backend test:e2e
 */
const prisma = new PrismaClient();

const PASSWORD = 'smoke-test-password';

// Fixed UUIDs (route params go through ParseUUIDPipe), in their own company so
// this suite and the isolation suite never see each other's rows.
const IDS = {
  company: '00000000-0000-4000-8000-00000000000c',
  owner: '00000000-0000-4000-8000-0000000000c1',
  driverUser: '00000000-0000-4000-8000-0000000000c2',
  vehicle: '00000000-0000-4000-8000-0000000000c3',
  driver: '00000000-0000-4000-8000-0000000000c4',
  client: '00000000-0000-4000-8000-0000000000c5',
  aiRequest: '00000000-0000-4000-8000-0000000000c6',
};
const OWNER_EMAIL = 'owner-smoke@e2e.test';
const DRIVER_EMAIL = 'driver-smoke@e2e.test';

/**
 * Money and distance are picked to divide exactly, so the expected P&L is
 * arithmetic anyone can redo on paper (TZ §6):
 *
 *   income        12 000 000 tiyin (agreed price)
 *   expenses       3 000 000 fuel + 500 000 toll        = 3 500 000
 *   driver share   10% of the agreed price              = 1 200 000
 *   depreciation   1 000 000 000 ÷ 1 000 000 km × 500 km =   500 000
 *   cost                                                 = 5 200 000
 *   profit                                               = 6 800 000
 */
const AGREED_PRICE = 12_000_000n;
const FUEL_EXPENSE = 3_000_000n;
const TOLL_EXPENSE = 500_000n;
const START_ODOMETER = 100_000;
const END_ODOMETER = 100_500;
const DRIVEN_KM = END_ODOMETER - START_ODOMETER;
const EXPECTED = {
  income: '12000000',
  expensesTotal: '3500000',
  driverShare: '1200000',
  depreciation: '500000',
  costTotal: '5200000',
  profit: '6800000',
  // 6 800 000 ÷ 12 000 000 = 56.666…% → 5667 bp (half-up)
  marginBp: 5667,
  // 6 800 000 tiyin ÷ 500 km
  profitPerKm: '13600',
  distanceKm: '500.0',
};

/** The ten buttons of the driver app, in the order a real trip presses them. */
const BUTTONS = [
  'START',
  'LOADED',
  'REST',
  'RESUME',
  'REFUEL',
  'BREAKDOWN',
  'CUSTOMS',
  'EXPENSE',
  'DELIVERED',
  'FINISH',
] as const;

async function wipe(): Promise<void> {
  const companyId = IDS.company;
  await prisma.gpsTrack.deleteMany({ where: { companyId } });
  await prisma.tripEvent.deleteMany({ where: { companyId } });
  await prisma.chatMessage.deleteMany({ where: { companyId } });
  await prisma.expense.deleteMany({ where: { companyId } });
  await prisma.fuelLog.deleteMany({ where: { companyId } });
  await prisma.income.deleteMany({ where: { companyId } });
  await prisma.trackingLink.deleteMany({ where: { companyId } });
  await prisma.trip.deleteMany({ where: { companyId } });
  await prisma.driver.deleteMany({ where: { companyId } });
  await prisma.vehicle.deleteMany({ where: { companyId } });
  await prisma.client.deleteMany({ where: { companyId } });
  await prisma.notification.deleteMany({ where: { companyId } });
  await prisma.aiRequest.deleteMany({ where: { companyId } });
  await prisma.aiInsight.deleteMany({ where: { companyId } });
  await prisma.aiSettings.deleteMany({ where: { companyId } });
  await prisma.auditLog.deleteMany({ where: { companyId } });
  await prisma.refreshToken.deleteMany({
    where: { userId: { in: [IDS.owner, IDS.driverUser] } },
  });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
}

async function seed(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD);
  await prisma.company.create({ data: { id: IDS.company, name: 'E2E Smoke' } });
  await prisma.user.createMany({
    data: [
      {
        id: IDS.owner,
        companyId: IDS.company,
        fullName: 'Smoke owner',
        email: OWNER_EMAIL,
        passwordHash,
        role: 'OWNER',
      },
      {
        id: IDS.driverUser,
        companyId: IDS.company,
        fullName: 'Smoke driver',
        email: DRIVER_EMAIL,
        passwordHash,
        role: 'DRIVER',
      },
    ],
  });
  await prisma.vehicle.create({
    data: {
      id: IDS.vehicle,
      companyId: IDS.company,
      plateNumber: '01 C 555 CC',
      fuelNormPer100km: '30.00',
      purchasePrice: 1_000_000_000n,
      plannedTotalKm: 1_000_000,
    },
  });
  await prisma.driver.create({
    data: {
      id: IDS.driver,
      companyId: IDS.company,
      userId: IDS.driverUser,
      fullName: 'Smoke driver',
      salaryType: 'PERCENT',
      // Basis points: 10% of the agreed price.
      salaryValue: 1_000n,
    },
  });
  await prisma.client.create({
    data: { id: IDS.client, companyId: IDS.company, name: 'Smoke client' },
  });
}

async function login(app: INestApplication, identifier: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ identifier, password: PASSWORD })
    .expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

describe('trip lifecycle smoke (TZ §3–§8)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let driverToken: string;
  let tripId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    await wipe();
    await seed();
    ownerToken = await login(app, OWNER_EMAIL);
    driverToken = await login(app, DRIVER_EMAIL);
  });

  afterAll(async () => {
    await wipe();
    await app?.close();
    await prisma.$disconnect();
  });

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}` });
  const asDriver = () => ({ Authorization: `Bearer ${driverToken}` });

  it('the logist opens a trip', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/trips')
      .set(asOwner())
      .send({
        clientId: IDS.client,
        cargoName: 'Paxta',
        loadingAddress: 'Toshkent',
        loadingLat: 41.3,
        loadingLng: 69.24,
        unloadingAddress: 'Samarqand',
        unloadingLat: 39.65,
        unloadingLng: 66.96,
        plannedDistanceKm: 480,
        agreedPrice: AGREED_PRICE.toString(),
      })
      .expect(201);

    const trip = (response.body as { data: { id: string; status: string; tripNumber: string } })
      .data;
    // No vehicle and no driver yet, so the trip waits in DRAFT.
    expect(trip.status).toBe('DRAFT');
    tripId = trip.id;
  });

  it('assigning a vehicle and a driver moves it to ASSIGNED', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/trips/${tripId}/assign`)
      .set(asOwner())
      .send({ vehicleId: IDS.vehicle, driverId: IDS.driver })
      .expect(200);
    expect((response.body as { data: { status: string } }).data.status).toBe('ASSIGNED');
  });

  it('the driver sees it in their own list', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/trips/my')
      .set(asDriver())
      .expect(200);
    const trips = (response.body as { data: Array<{ id: string }> }).data;
    expect(trips.map((trip) => trip.id)).toContain(tripId);
  });

  it('the trip starts with an odometer reading', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/trips/${tripId}/start`)
      .set(asOwner())
      .send({ startOdometer: START_ODOMETER })
      .expect(200);
    expect((response.body as { data: { status: string } }).data.status).toBe('IN_PROGRESS');
  });

  it('the driver presses all ten buttons in one offline batch', async () => {
    const base = Date.now() - BUTTONS.length * 60_000;
    const events = BUTTONS.map((eventType, index) => ({
      clientEventId: randomUUID(),
      tripId,
      eventType,
      eventTime: new Date(base + index * 60_000).toISOString(),
      lat: 41.3 - index * 0.1,
      lng: 69.24 - index * 0.2,
      odometer: START_ODOMETER + index * 50,
    }));

    const response = await request(app.getHttpServer())
      .post('/api/v1/events/batch')
      .set(asDriver())
      .send({ events })
      .expect(200);
    const result = (response.body as { data: { accepted: string[]; duplicates: string[] } }).data;
    expect(result.accepted).toHaveLength(BUTTONS.length);
    expect(result.duplicates).toEqual([]);

    // Offline sync retries the same batch; the second run must add no rows.
    const retry = await request(app.getHttpServer())
      .post('/api/v1/events/batch')
      .set(asDriver())
      .send({ events })
      .expect(200);
    expect((retry.body as { data: { duplicates: string[] } }).data.duplicates).toHaveLength(
      BUTTONS.length,
    );
    expect(await prisma.tripEvent.count({ where: { tripId } })).toBe(BUTTONS.length);
  });

  it('the truck appears on the live map with its last position', async () => {
    const now = Date.now();
    const positions = [
      { lat: 41.3, lng: 69.24, speed: 60 },
      { lat: 41.0, lng: 68.8, speed: 72 },
      { lat: 40.7, lng: 68.4, speed: 65 },
    ].map((point, index) => ({
      ...point,
      tripId,
      recordedAt: new Date(now - (2 - index) * 60_000).toISOString(),
    }));

    await request(app.getHttpServer())
      .post('/api/v1/tracking/positions')
      .set(asDriver())
      .send({ positions })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get('/api/v1/tracking/live')
      .set(asOwner())
      .expect(200);
    const rows = (
      response.body as {
        data: Array<{
          vehicleId: string;
          trip: { id: string } | null;
          driverName: string | null;
          lastPosition: { lat: number; lng: number } | null;
        }>;
      }
    ).data;
    const vehicle = rows.find((row) => row.vehicleId === IDS.vehicle);
    expect(vehicle?.trip?.id).toBe(tripId);
    expect(vehicle?.driverName).toBe('Smoke driver');
    expect(vehicle?.lastPosition?.lat).toBeCloseTo(40.7);
  });

  /**
   * The photo itself needs object storage and a model key, so the reading is
   * covered by ocr.service.spec.ts. What this path proves is the rule that
   * makes AI-2 safe (TZ §8.0): confirming a proposal records the decision and
   * writes nothing to the business tables — the fuel log and the expense are
   * created afterwards through the ordinary endpoints.
   */
  it('a person confirms the AI reading, and the confirmation writes no records', async () => {
    await prisma.aiRequest.create({
      data: {
        id: IDS.aiRequest,
        companyId: IDS.company,
        userId: IDS.driverUser,
        feature: 'OCR',
        inputType: 'photo',
        inputRef: tripId,
        modelUsed: 'claude-haiku-4-5',
        status: 'SUCCEEDED',
        confidenceBp: 9_200,
        responseJson: { documentType: 'FUEL_RECEIPT', total: '3000000', liters: 120.5 },
      },
    });

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/ai/requests/${IDS.aiRequest}/confirm`)
      .set(asDriver())
      .send({ correctedData: { liters: 120.5 } })
      .expect(200);
    expect((response.body as { data: { isConfirmed: boolean } }).data.isConfirmed).toBe(true);

    expect(await prisma.fuelLog.count({ where: { companyId: IDS.company } })).toBe(0);
    expect(await prisma.expense.count({ where: { companyId: IDS.company } })).toBe(0);
  });

  it('the confirmed receipt is posted as a fuel log and an expense', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/fuel')
      .set(asOwner())
      .send({
        vehicleId: IDS.vehicle,
        tripId,
        driverId: IDS.driver,
        liters: 120.5,
        totalAmount: FUEL_EXPENSE.toString(),
        stationName: 'UNG Petrol',
        odometer: START_ODOMETER + 200,
        refuelTime: new Date().toISOString(),
      })
      .expect(201);

    for (const [category, amount] of [
      ['FUEL', FUEL_EXPENSE],
      ['TOLL', TOLL_EXPENSE],
    ] as const) {
      await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set(asOwner())
        .send({
          tripId,
          vehicleId: IDS.vehicle,
          driverId: IDS.driver,
          category,
          amount: amount.toString(),
          expenseDate: new Date().toISOString(),
        })
        .expect(201);
    }
  });

  it('the trip is completed with the closing odometer', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/trips/${tripId}/complete`)
      .set(asOwner())
      .send({ endOdometer: END_ODOMETER })
      .expect(200);
    const trip = (response.body as { data: { status: string; actualDistanceKm: string } }).data;
    expect(trip.status).toBe('COMPLETED');
    expect(Number(trip.actualDistanceKm)).toBe(DRIVEN_KM);
  });

  it('the trip P&L matches the formulas of TZ §6 to the tiyin', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/finance/trips/${tripId}`)
      .set(asOwner())
      .expect(200);
    const pnl = (response.body as { data: Record<string, unknown> }).data;

    expect(pnl).toMatchObject(EXPECTED);
    // Money crosses the wire as decimal strings, never as JSON numbers.
    expect(typeof pnl.profit).toBe('string');
  });

  it('the dashboard shows the same money', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/dashboard')
      .set(asOwner())
      .expect(200);
    const dashboard = (
      response.body as {
        data: {
          vehiclesTotal: number;
          tripsToday: number;
          month: { revenue: string; cost: string; profit: string; tripCount: number };
          recentEvents: Array<{ eventType: string }>;
        };
      }
    ).data;

    expect(dashboard.vehiclesTotal).toBe(1);
    expect(dashboard.tripsToday).toBe(1);
    expect(dashboard.month).toMatchObject({
      revenue: EXPECTED.income,
      cost: EXPECTED.costTotal,
      profit: EXPECTED.profit,
      tripCount: 1,
    });
    expect(dashboard.recentEvents[0]?.eventType).toBe('FINISH');
  });

  it('the fuel control table sees the refuel against the norm', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/fuel/control')
      .set(asOwner())
      .expect(200);
    const row = (
      response.body as {
        data: Array<{ vehicleId: string; actualLitres: string; normLitres: string }>;
      }
    ).data.find((item) => item.vehicleId === IDS.vehicle);

    expect(row?.actualLitres).toBe('120.50');
    // 500 km at 30 l/100 km.
    expect(row?.normLitres).toBe('150.00');
  });

  it('AI being unavailable never blocks the flow', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/ai/status')
      .set(asOwner())
      .expect(200);
    const status = (
      response.body as { data: { available: boolean; month: string; limitMicroUsd: string } }
    ).data;
    // Whatever the deployment configured, the endpoint answers instead of
    // failing — every step above ran without a model call.
    expect(typeof status.available).toBe('boolean');
    expect(status.month).toMatch(/^\d{4}-\d{2}$/);
  });
});
