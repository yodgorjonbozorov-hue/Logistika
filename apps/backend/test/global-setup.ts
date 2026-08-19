/**
 * E2E bootstrap — brings up a REAL PostgreSQL schema for the suite.
 *
 * These tests deliberately do not mock Prisma: tenant isolation, unique
 * indexes, partial indexes and concurrent updates are database behaviour, and
 * a mock cannot tell you whether they hold.
 *
 * The schema is created with `prisma migrate deploy`, i.e. the exact same path
 * production uses — so a broken migration fails the test run, not the deploy.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const DEFAULT_TEST_DB =
  'postgresql://truckcontrol:change-me@127.0.0.1:5432/truckcontrol_test?schema=public';

export default function globalSetup(): void {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB;
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = 'test';

  const backendRoot = resolve(__dirname, '..');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}
