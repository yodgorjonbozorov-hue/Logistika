/**
 * Health checks (TASK-1.8). `/health` used to return a hardcoded {status:'ok'},
 * so an instance with a dead database still told the load balancer it was fine.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2EApp } from './setup-e2e';

jest.setTimeout(60_000);

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('liveness answers without touching any dependency', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('readiness actually probes the database, redis and object storage', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');

    // Terminus answers 200 when everything is up and 503 when something is not;
    // either way the individual dependencies have to be named in the payload.
    expect([200, 503]).toContain(res.status);
    const payload = res.body.data ?? res.body.error?.details ?? res.body;
    const info = JSON.stringify(payload);
    for (const dependency of ['database', 'redis', 'storage']) {
      expect(info).toContain(dependency);
    }
  });

  it('readiness reports the database as up against the real test database', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    const payload = JSON.stringify(res.body);
    expect(payload).toMatch(/"database":\{"status":"up"\}/);
  });
});
