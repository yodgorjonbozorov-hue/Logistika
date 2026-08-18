/**
 * E2E harness (TASK-1.3): a real Nest app against a real PostgreSQL database.
 *
 * The database is a separate one — DATABASE_URL_TEST, falling back to
 * DATABASE_URL with a `_test` suffix — so a test run can never truncate the
 * development data. Migrations are applied once per run; every test starts from
 * empty tables.
 */
import '../src/common/serialization';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

/** Tables truncated between tests, children first (FKs are not deferred). */
const TABLES = [
  'gps_tracks_archive',
  'gps_tracks',
  'ledger_entries',
  'tracking_links',
  'trip_events',
  'fuel_logs',
  'expenses',
  'incomes',
  'maintenance',
  'documents',
  'notifications',
  'stored_files',
  'audit_logs',
  'trips',
  'clients',
  'vehicles',
  'drivers',
  'refresh_tokens',
  'sms_codes',
  'sms_messages',
  'users',
  'companies',
];

export function testDatabaseUrl(): string {
  const explicit = process.env.DATABASE_URL_TEST;
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL_TEST or DATABASE_URL must be set to run e2e tests.');
  }
  // postgresql://user:pass@host:5432/truckcontrol?schema=public → …/truckcontrol_test?…
  // Idempotent: createE2EApp writes the derived url back into process.env, and
  // callers may ask for it again afterwards.
  const url = new URL(base);
  const database = url.pathname.replace(/\/$/, '');
  url.pathname = database.endsWith('_test') ? database : `${database}_test`;
  return url.toString();
}

let migrated = false;

/** Creates (if needed) and migrates the test database once per jest worker. */
export async function prepareTestDatabase(): Promise<string> {
  const url = testDatabaseUrl();
  if (migrated) return url;

  const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';

  // PostgreSQL has no `CREATE DATABASE IF NOT EXISTS`; on every run after the
  // first the duplicate error is the expected outcome.
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } catch (error) {
    if (!String(error).includes('already exists')) throw error;
  } finally {
    await admin.$disconnect();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  migrated = true;
  return url;
}

export interface E2EContext {
  app: INestApplication;
  prisma: PrismaService;
}

export async function createE2EApp(): Promise<E2EContext> {
  process.env.DATABASE_URL = await prepareTestDatabase();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // The same pipeline main.ts builds — helmet, body limits, validation.
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

export async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}
