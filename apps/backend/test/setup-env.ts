/**
 * Runs BEFORE any module is imported.
 *
 * `AppModule` validates the environment at import time (ConfigModule.forRoot
 * evaluates inside the @Module decorator), so setting these from inside a test
 * body would already be too late.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ??
  'postgresql://truckcontrol:change-me@127.0.0.1:5432/truckcontrol_test?schema=public';
process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-at-least-32-characters-long';
process.env.WEB_URL ??= 'http://localhost:5173';
process.env.API_PORT ??= '3999';
// Generous global default so ordinary flows never trip the limiter; the
// rate-limit suite exercises the tight per-route budgets instead.
process.env.RATE_LIMIT_MAX ??= '100000';
// Object storage: the e2e suite talks to a REAL MinIO so upload, MIME sniffing
// and signed-URL behaviour are exercised end to end rather than mocked.
process.env.MINIO_ENDPOINT ??= '127.0.0.1';
process.env.MINIO_PORT ??= '9000';
process.env.MINIO_ROOT_USER ??= 'truckcontrol';
process.env.MINIO_ROOT_PASSWORD ??= 'change-me-minio';
process.env.MINIO_BUCKET ??= 'truckcontrol-test';
process.env.MINIO_USE_SSL ??= 'false';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
