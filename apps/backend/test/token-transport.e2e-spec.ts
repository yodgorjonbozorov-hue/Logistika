/**
 * Token transport (TASK-2.6).
 *
 * The refresh token used to travel in the login response body and live in
 * localStorage, so one XSS was worth a 30-day credential. Browsers now receive
 * it as an httpOnly, SameSite=Strict cookie they cannot read; native clients,
 * which have no cookie jar, still get it in the body.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

const PASSWORD = 'E2ePassw0rd!';
const COOKIE = 'tc_rt';

describe('Token transport (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TenantFixture;
  let clientIp: string;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    tenant = await createTenant(app, 'Transport');
    clientIp = `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  });

  const login = (headers: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-forwarded-for', clientIp)
      .set(headers)
      .send({ identifier: tenant.owner.email, password: PASSWORD });

  const cookieOf = (res: request.Response): string => {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    const cookie = (raw ?? []).find((value) => value.startsWith(`${COOKIE}=`));
    expect(cookie).toBeDefined();
    return cookie!;
  };

  describe('browser clients', () => {
    it('receives the refresh token as an httpOnly cookie, not in the body', async () => {
      const res = await login();
      expect(res.status).toBe(200);

      expect(res.body.data.accessToken).toBeTruthy();
      // The whole point: script on the page can never read this.
      expect(res.body.data.refreshToken).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('refreshToken');

      const cookie = cookieOf(res);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/api/v1/auth');
    });

    it('refreshes using only the cookie, with nothing in the body', async () => {
      const cookie = cookieOf(await login());

      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('x-forwarded-for', clientIp)
        .set('cookie', cookie)
        .send({});

      expect(refreshed.status).toBe(200);
      expect(refreshed.body.data.accessToken).toBeTruthy();
      expect(refreshed.body.data.refreshToken).toBeUndefined();
      // Rotation still happens: a new cookie replaces the old one.
      expect(cookieOf(refreshed)).not.toBe(cookie);
    });

    it('refuses to refresh with neither a cookie nor a body token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('x-forwarded-for', clientIp)
        .send({});
      expect(res.status).toBe(401);
    });

    it('clears the cookie on logout', async () => {
      const cookie = cookieOf(await login());

      const out = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('cookie', cookie)
        .send({});
      expect(out.status).toBe(200);

      const cleared = (out.headers['set-cookie'] as unknown as string[]).find((v) =>
        v.startsWith(`${COOKIE}=`),
      );
      expect(cleared).toContain(`${COOKIE}=;`);

      // And the session really is over, not just visually cleared.
      const afterLogout = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('x-forwarded-for', clientIp)
        .set('cookie', cookie)
        .send({});
      expect(afterLogout.status).toBe(401);
    });

    it('clears the cookie when the presented one is dead', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('x-forwarded-for', clientIp)
        .set('cookie', `${COOKIE}=not-a-real-token`)
        .send({});

      expect(res.status).toBe(401);
      // Otherwise the browser would keep retrying with a token that can never work.
      const cleared = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
      expect(cleared.some((v) => v.startsWith(`${COOKIE}=;`))).toBe(true);
    });
  });

  describe('native clients', () => {
    it('still receives the refresh token in the body and no cookie', async () => {
      const res = await login({ 'x-client': 'mobile' });

      expect(res.status).toBe(200);
      expect(res.body.data.refreshToken).toBeTruthy();
      const cookies = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
      expect(cookies.some((v) => v.startsWith(`${COOKIE}=`))).toBe(false);
    });

    it('refreshes with the token in the body', async () => {
      const { refreshToken } = (await login({ 'x-client': 'mobile' })).body.data as {
        refreshToken: string;
      };

      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('x-forwarded-for', clientIp)
        .set('x-client', 'mobile')
        .send({ refreshToken });

      expect(refreshed.status).toBe(200);
      expect(refreshed.body.data.refreshToken).toBeTruthy();
    });
  });
});
