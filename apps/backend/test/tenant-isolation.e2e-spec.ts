import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import '../src/common/serialization';

/**
 * The isolation scenario CLAUDE.md requires, run against a real PostgreSQL
 * (docs/SECURITY.md F-7): a user of company B must not be able to read, change
 * or delete anything of company A.
 *
 * This is the test the unit-level tenant extension checks cannot be: those
 * prove the filter is added to the arguments, this proves the database agrees.
 *
 *   docker compose up -d postgres
 *   DATABASE_URL=... pnpm --filter backend test:e2e
 */
const prisma = new PrismaClient();

const PASSWORD = 'isolation-test-password';

// Fixed UUIDs, not readable slugs: route params go through ParseUUIDPipe, and a
// non-UUID id would be rejected as malformed before isolation was ever tested.
const A = {
  company: '00000000-0000-4000-8000-00000000000a',
  user: '00000000-0000-4000-8000-0000000000a1',
  vehicle: '00000000-0000-4000-8000-0000000000a2',
  driver: '00000000-0000-4000-8000-0000000000a3',
  client: '00000000-0000-4000-8000-0000000000a4',
  trip: '00000000-0000-4000-8000-0000000000a5',
  email: 'owner-a@e2e.test',
};
const B = {
  company: '00000000-0000-4000-8000-00000000000b',
  user: '00000000-0000-4000-8000-0000000000b1',
  vehicle: '00000000-0000-4000-8000-0000000000b2',
  driver: '00000000-0000-4000-8000-0000000000b3',
  client: '00000000-0000-4000-8000-0000000000b4',
  trip: '00000000-0000-4000-8000-0000000000b5',
  email: 'owner-b@e2e.test',
};

/** Everything company A owns, so B can be pointed at each of them by id. */
interface Fixtures {
  vehicleId: string;
  driverId: string;
  clientId: string;
  tripId: string;
}

async function seedCompany(
  ids: typeof A,
  suffix: string,
  withFixtures: boolean,
): Promise<Fixtures | null> {
  await prisma.company.upsert({
    where: { id: ids.company },
    update: {},
    create: { id: ids.company, name: `E2E ${suffix}` },
  });
  await prisma.user.upsert({
    where: { id: ids.user },
    update: { passwordHash: await argon2.hash(PASSWORD) },
    create: {
      id: ids.user,
      companyId: ids.company,
      fullName: `Owner ${suffix}`,
      email: ids.email,
      passwordHash: await argon2.hash(PASSWORD),
      role: 'OWNER',
    },
  });
  if (!withFixtures) return null;

  const vehicle = await prisma.vehicle.upsert({
    where: { id: ids.vehicle },
    update: {},
    create: { id: ids.vehicle, companyId: ids.company, plateNumber: '01 A 111 AA' },
  });
  const driver = await prisma.driver.upsert({
    where: { id: ids.driver },
    update: {},
    create: { id: ids.driver, companyId: ids.company, fullName: 'A driver' },
  });
  const client = await prisma.client.upsert({
    where: { id: ids.client },
    update: {},
    create: { id: ids.client, companyId: ids.company, name: 'A client' },
  });
  const trip = await prisma.trip.upsert({
    where: { id: ids.trip },
    update: {},
    create: {
      id: ids.trip,
      companyId: ids.company,
      tripNumber: 'A-001',
      vehicleId: vehicle.id,
      driverId: driver.id,
      clientId: client.id,
    },
  });

  return { vehicleId: vehicle.id, driverId: driver.id, clientId: client.id, tripId: trip.id };
}

async function wipe(): Promise<void> {
  // Children first; every row is keyed by one of the two test companies.
  const companies = [A.company, B.company];
  await prisma.chatMessage.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.tripEvent.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.trip.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.driver.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.vehicle.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.client.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: [A.user, B.user] } } });
  await prisma.auditLog.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.user.deleteMany({ where: { id: { in: [A.user, B.user] } } });
  await prisma.company.deleteMany({ where: { id: { in: companies } } });
}

describe('tenant isolation (TZ §9)', () => {
  let app: INestApplication;
  let ownA: Fixtures;
  let tokenB: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    await wipe();
    ownA = (await seedCompany(A, 'A', true)) as Fixtures;
    await seedCompany(B, 'B', false);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: B.email, password: PASSWORD })
      .expect(200);
    tokenB = (login.body as { data: { accessToken: string } }).data.accessToken;
  });

  afterAll(async () => {
    await wipe();
    await app?.close();
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${tokenB}` });

  describe("company B cannot reach company A's records", () => {
    it.each([
      ['vehicles', () => ownA.vehicleId],
      ['drivers', () => ownA.driverId],
      ['clients', () => ownA.clientId],
      ['trips', () => ownA.tripId],
    ])('GET /%s/:id answers 404', async (resource, id) => {
      await request(app.getHttpServer()).get(`/api/v1/${resource}/${id()}`).set(auth()).expect(404);
    });

    it.each([
      ['vehicles', () => ownA.vehicleId, { plateNumber: 'STOLEN' }],
      ['drivers', () => ownA.driverId, { fullName: 'Stolen' }],
      ['clients', () => ownA.clientId, { name: 'Stolen' }],
    ])('PATCH /%s/:id answers 404 and changes nothing', async (resource, id, body) => {
      await request(app.getHttpServer())
        .patch(`/api/v1/${resource}/${id()}`)
        .set(auth())
        .send(body)
        .expect(404);
    });

    it('leaves A untouched after every attempt', async () => {
      const vehicle = await prisma.vehicle.findUnique({ where: { id: ownA.vehicleId } });
      const client = await prisma.client.findUnique({ where: { id: ownA.clientId } });
      expect(vehicle?.plateNumber).toBe('01 A 111 AA');
      expect(client?.name).toBe('A client');
    });

    it('lists nothing of A', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/vehicles')
        .set(auth())
        .expect(200);
      const rows = (response.body as { data: Array<{ id: string }> }).data;
      expect(rows.map((row) => row.id)).not.toContain(ownA.vehicleId);
    });

    it("cannot open A's trip chat", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/chat/${ownA.tripId}/messages`)
        .set(auth())
        .expect(404);
    });

    it("cannot attach an expense to A's trip", async () => {
      await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set(auth())
        .send({
          tripId: ownA.tripId,
          category: 'TOLL',
          amount: '100000',
          expenseDate: new Date().toISOString(),
        })
        // The trip is a real UUID that simply does not belong to B.
        .expect(404);
      const expenses = await prisma.expense.count({ where: { tripId: ownA.tripId } });
      expect(expenses).toBe(0);
    });
  });

  describe('an unauthenticated caller reaches nothing at all', () => {
    it('refuses without a token', async () => {
      await request(app.getHttpServer()).get('/api/v1/vehicles').expect(401);
    });

    it('still serves the health check', async () => {
      await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    });
  });
});
