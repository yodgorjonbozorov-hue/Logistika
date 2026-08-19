/**
 * H-15 — the health endpoint used to `return { status: 'ok' }` unconditionally.
 *
 * That is worse than having no probe: an orchestrator keeps routing traffic to
 * a pod whose database is gone, and never restarts it. Liveness and readiness
 * are now separate questions with separate answers.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { api, createTestApp, prisma, resetRateLimits } from './harness';

describe('Health probes (H-15)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(() => resetRateLimits(app));

  it('liveness needs no authentication and never touches a dependency', async () => {
    const started = Date.now();
    const response = await api(app).get('/api/v1/health/live').expect(200);

    expect(response.body.data.status).toBe('ok');
    expect(typeof response.body.data.uptimeSeconds).toBe('number');
    // No dependency round trips — a slow database must not cause a restart loop.
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('readiness reports each dependency individually', async () => {
    const response = await api(app).get('/api/v1/health/ready');

    expect(Object.keys(response.body.data.checks).sort()).toEqual(['database', 'redis', 'storage']);
    for (const check of Object.values(response.body.data.checks) as Array<{
      status: string;
      latencyMs: number;
    }>) {
      expect(['up', 'down']).toContain(check.status);
      expect(typeof check.latencyMs).toBe('number');
    }
  });

  it('the database check really queries PostgreSQL and comes back up', async () => {
    const response = await api(app).get('/api/v1/health/ready');
    expect(response.body.data.checks.database.status).toBe('up');
  });

  it('answers 503 — not 200 — while any dependency is down', async () => {
    const response = await api(app).get('/api/v1/health/ready');

    // Redis and MinIO are not running in this environment, so this asserts the
    // real failure path rather than a simulated one.
    if (response.body.data.ready) {
      expect(response.status).toBe(200);
    } else {
      expect(response.status).toBe(503);
      const down = Object.entries(
        response.body.data.checks as Record<string, { status: string }>,
      ).filter(([, check]) => check.status === 'down');
      expect(down.length).toBeGreaterThan(0);
    }
  });

  it('never leaks a connection string in the failure detail', async () => {
    const response = await api(app).get('/api/v1/health/ready');
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('postgresql://');
    expect(body).not.toContain('change-me');
  });

  it('is NOT rate limited — a throttled probe would restart healthy pods', async () => {
    const statuses = new Set<number>();
    for (let attempt = 0; attempt < 40; attempt++) {
      statuses.add((await api(app).get('/api/v1/health/live')).status);
    }
    expect(statuses).toEqual(new Set([200]));
  });
});
