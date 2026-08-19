/**
 * Shared e2e harness: a real Nest application on a real PostgreSQL database.
 *
 * Everything here exists so the tests can make honest claims. In particular
 * the app is built from the real `AppModule` — same guards, same global pipe,
 * same exception filter, same tenant extension — so a test that says
 * "company B cannot read company A's trip" is testing the shipping stack.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageService } from '@nestjs/throttler/dist/throttler.service';
import { PrismaClient, type UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://truckcontrol:change-me@127.0.0.1:5432/truckcontrol_test?schema=public';

/** Test-only env. Secrets are throwaway values, never anything real. */
export function applyTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-at-least-32-characters-long';
  process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-at-least-32-characters-long';
  process.env.WEB_URL ??= 'http://localhost:5173';
  process.env.API_PORT ??= '3999';
  // Generous default so ordinary flows never trip the limiter; the rate-limit
  // suite sets its own tight numbers per route via decorators.
  process.env.RATE_LIMIT_MAX ??= '100000';
}

export const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

export async function createTestApp(): Promise<NestExpressApplication> {
  applyTestEnv();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // Listen for real on an ephemeral port: supertest otherwise calls
  // `server.listen(0)` per request, and 20 parallel calls then race each other
  // into ECONNRESET — an artefact of the harness, not of the application.
  const cookieParser = (await import('cookie-parser')).default;
  app.use(cookieParser());
  // Listen for real on an ephemeral port: supertest otherwise calls
  // `server.listen(0)` per request, and 20 parallel calls then race each other
  // into ECONNRESET — an artefact of the harness, not of the application.
  await app.listen(0);
  return app;
}

export const api = (app: NestExpressApplication) => request(app.getHttpServer());

/**
 * Empties the rate-limit buckets between tests.
 *
 * The limiter is deliberately left ENABLED for the whole e2e run — disabling it
 * would mean the tests exercise a stack that never ships. But supertest always
 * connects from 127.0.0.1, so every test shares one bucket and the 5-per-minute
 * login budget would otherwise be spent by the third test. `rate-limit.e2e-spec`
 * is the suite that asserts the budgets actually bite.
 */
export function resetRateLimits(app: NestExpressApplication): void {
  const storage = app.get<ThrottlerStorageService>(ThrottlerStorage, { strict: false });
  storage.storage?.clear();
}

/** Bearer helper — keeps the tests readable. */
export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: UserRole;
  accessToken: string;
  refreshToken: string;
}

export interface TestCompany {
  id: string;
  name: string;
  owner: TestUser;
}

let sequence = 0;
export const uniqueSuffix = (): string => `${Date.now().toString(36)}-${sequence++}`;

/**
 * Truncates every table between tests. RESTART IDENTITY + CASCADE keeps
 * BigInt sequences predictable and avoids FK ordering games.
 *
 * Guard rail: refuses to run against anything but a database whose name ends
 * in `_test`, so a stray DATABASE_URL can never wipe real data.
 */
export async function resetDatabase(): Promise<void> {
  const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to truncate "${dbName}" — e2e databases must end with _test`);
  }
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function createCompany(name = `Company-${uniqueSuffix()}`): Promise<TestCompany> {
  const company = await prisma.company.create({ data: { name } });
  const owner = await createUser(company.id, 'OWNER');
  return { id: company.id, name, owner };
}

export async function createUser(
  companyId: string | null,
  role: UserRole,
  overrides: { email?: string; phone?: string; password?: string; isActive?: boolean } = {},
): Promise<TestUser> {
  const password = overrides.password ?? 'test-password-2026';
  const email = overrides.email ?? `${role.toLowerCase()}-${uniqueSuffix()}@example.test`;
  const user = await prisma.user.create({
    data: {
      companyId,
      fullName: `${role} ${uniqueSuffix()}`,
      email,
      phone: overrides.phone,
      passwordHash: await argon2.hash(password),
      role,
      isActive: overrides.isActive ?? true,
    },
  });
  return { id: user.id, email, password, role, accessToken: '', refreshToken: '' };
}

/** Logs a fixture user in through the real HTTP endpoint. */
export async function login(app: NestExpressApplication, user: TestUser): Promise<TestUser> {
  const response = await api(app)
    .post('/api/v1/auth/login')
    .send({ identifier: user.email, password: user.password })
    .expect(200);
  const tokens = response.body.data as { accessToken: string; refreshToken: string };
  user.accessToken = tokens.accessToken;
  user.refreshToken = tokens.refreshToken;
  return user;
}

/** A company with an owner and a driver whose login account is properly linked. */
export async function createCompanyWithDriver(app: NestExpressApplication): Promise<{
  company: TestCompany;
  owner: TestUser;
  driverUser: TestUser;
  driverId: string;
  vehicleId: string;
}> {
  const company = await createCompany();
  const owner = await login(app, company.owner);
  const driverUser = await createUser(company.id, 'DRIVER', {
    phone: `+9989${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
  });
  await login(app, driverUser);

  const driverResponse = await api(app)
    .post('/api/v1/drivers')
    .set(auth(owner.accessToken))
    .send({ fullName: 'Test Driver', userId: driverUser.id })
    .expect(201);

  const vehicleResponse = await api(app)
    .post('/api/v1/vehicles')
    .set(auth(owner.accessToken))
    .send({ plateNumber: `01A${uniqueSuffix().slice(-5).toUpperCase()}` })
    .expect(201);

  return {
    company,
    owner,
    driverUser,
    driverId: driverResponse.body.data.id as string,
    vehicleId: vehicleResponse.body.data.id as string,
  };
}
