/**
 * Rate limiting (TASK-1.5). Without it, /auth/login is a free password oracle
 * and /auth/driver/request-code is an SMS-bombing endpoint that costs the
 * company real money and locks the driver out.
 *
 * Each test uses its own X-Forwarded-For value so the per-IP counters do not
 * leak between tests (the store is Redis and outlives the process).
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Rate limiting (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const fromFreshIp = (path: string) =>
    request(app.getHttpServer()).post(path).set('x-forwarded-for', `10.0.0.${randomUUID()}`);

  it('caps login attempts and answers in the standard envelope', async () => {
    const ip = `10.1.${Date.now() % 250}.${Math.floor(Math.random() * 250)}`;
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('x-forwarded-for', ip)
        .send({ identifier: `nobody-${randomUUID()}@example.test`, password: 'wrong-password' });

    const statuses: number[] = [];
    let limited: request.Response | undefined;
    for (let i = 0; i < 8; i++) {
      const res = await attempt();
      statuses.push(res.status);
      if (res.status === 429) {
        limited ??= res;
        break;
      }
    }

    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(limited?.body).toMatchObject({
      success: false,
      data: null,
      error: { code: 'RATE_LIMIT_EXCEEDED' },
    });
    // The message reaches the client already translated.
    expect(typeof limited?.body.error.message).toBe('string');
    expect(limited?.body.error.message).not.toBe('RATE_LIMIT_EXCEEDED');
  });

  it('caps SMS code requests per phone number', async () => {
    const phone = `+9989${String(Date.now()).slice(-8)}`;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await fromFreshIp('/api/v1/auth/driver/request-code').send({ phone });
      statuses.push(res.status);
      if (res.status === 429) break;
    }

    // The per-phone limit is 3/hour; a rotating IP does not get around it.
    expect(statuses).toContain(429);
  });

  it('never returns the SMS code in the response body', async () => {
    const res = await fromFreshIp('/api/v1/auth/driver/request-code').send({
      phone: `+9989${String(Date.now() + 1).slice(-8)}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true });
    expect(JSON.stringify(res.body)).not.toMatch(/\d{6}/);
  });

  it('serves security headers on every response', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
