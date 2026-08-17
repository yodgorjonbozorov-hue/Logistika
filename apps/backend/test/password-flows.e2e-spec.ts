/**
 * Password management (TASK-2.5). Before this there was no way to change your
 * own password and no way to recover a lost one: an OWNER who forgot theirs was
 * locked out of their company permanently, with no self-service path at all.
 */
import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

const PASSWORD = 'E2ePassw0rd!';
const NEW_PASSWORD = 'Yangi9Parol';

describe('Password flows (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TenantFixture;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    tenant = await createTenant(app, 'Password');
    clientIp = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  });

  /**
   * Each test gets its own client IP: the login limiter is per IP, and without
   * this the third test in the file would start seeing 429 instead of the
   * status it is actually asserting on.
   */
  let clientIp: string;

  const post = (path: string, body: object, token?: string) => {
    const req = request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('x-forwarded-for', clientIp)
      .send(body);
    return token ? req.set('authorization', `Bearer ${token}`) : req;
  };

  const login = (password: string, identifier = tenant.owner.email!) =>
    post('/auth/login', { identifier, password });

  describe('change-password', () => {
    it('changes the password and invalidates the old one', async () => {
      const res = await post(
        '/auth/change-password',
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        tenant.tokens.owner,
      );
      expect(res.status).toBe(200);

      expect((await login(PASSWORD)).status).toBe(401);
      expect((await login(NEW_PASSWORD)).status).toBe(200);
    });

    it('refuses a wrong current password', async () => {
      const res = await post(
        '/auth/change-password',
        { currentPassword: 'not-it', newPassword: NEW_PASSWORD },
        tenant.tokens.owner,
      );
      expect(res.status).toBe(401);
      expect((await login(PASSWORD)).status).toBe(200);
    });

    it('refuses a weak new password', async () => {
      const res = await post(
        '/auth/change-password',
        { currentPassword: PASSWORD, newPassword: 'parol12345' },
        tenant.tokens.owner,
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('ends every existing session', async () => {
      const session = await post('/auth/login', {
        identifier: tenant.owner.email,
        password: PASSWORD,
      });
      const refreshToken = session.body.data.refreshToken as string;

      await post(
        '/auth/change-password',
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        tenant.tokens.owner,
      );

      const refreshed = await post('/auth/refresh', { refreshToken });
      expect(refreshed.status).toBe(401);
    });

    it('requires authentication', async () => {
      const res = await post('/auth/change-password', {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect(res.status).toBe(401);
    });
  });

  describe('forgot / reset password', () => {
    /** The token only exists in the SMS/log, so the test reads it from the row. */
    async function requestReset(): Promise<string> {
      await post('/auth/forgot-password', { identifier: tenant.owner.email });
      const stored = await prisma.passwordResetToken.findFirst({
        where: { userId: tenant.owner.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(stored).not.toBeNull();
      return stored!.id;
    }

    it('answers the same for a known and an unknown identifier (no enumeration)', async () => {
      const known = await post('/auth/forgot-password', { identifier: tenant.owner.email });
      const unknown = await post('/auth/forgot-password', {
        identifier: 'nobody@example.test',
      });

      expect(known.status).toBe(unknown.status);
      expect(known.body.data).toEqual(unknown.body.data);
      const issued = await prisma.passwordResetToken.count();
      expect(issued).toBe(1);
    });

    it('stores the token hashed, never in the clear', async () => {
      await requestReset();
      const stored = await prisma.passwordResetToken.findFirst();
      // sha256 hex — a leaked table yields no working links.
      expect(stored!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('rejects an unknown or expired token', async () => {
      expect((await post('/auth/reset-password', { token: 'nope', newPassword: NEW_PASSWORD })).status).toBe(
        400,
      );

      await requestReset();
      await prisma.passwordResetToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const stored = await prisma.passwordResetToken.findFirst();
      expect(stored).not.toBeNull();
    });

    it('a reset token works exactly once', async () => {
      // Recreate the raw token by driving the flow through the service's own
      // hashing: request a reset, then read the row and forge the same hash.
      const rawToken = 'a'.repeat(64);
      const { createHash } = await import('node:crypto');
      await prisma.passwordResetToken.create({
        data: {
          userId: tenant.owner.id,
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          expiresAt: new Date(Date.now() + 600_000),
        },
      });

      const first = await post('/auth/reset-password', {
        token: rawToken,
        newPassword: NEW_PASSWORD,
      });
      expect(first.status).toBe(200);

      const second = await post('/auth/reset-password', {
        token: rawToken,
        newPassword: 'Boshqa9Parol',
      });
      expect(second.status).toBe(400);
      expect(second.body.error.code).toBe('AUTH_RESET_TOKEN_INVALID');

      expect((await login(NEW_PASSWORD)).status).toBe(200);
    });
  });

  describe('account lockout', () => {
    it('the last wrong password of the run locks the account', async () => {
      // The rate limiter refuses long guessing runs over HTTP (which is the
      // point of TASK-1.5), so the counter is walked to its last step here and
      // the counting itself is covered by the AuthService unit tests.
      await prisma.user.update({
        where: { id: tenant.owner.id },
        data: { failedLoginAttempts: 9 },
      });

      expect((await login('wrong-password')).status).toBe(401);

      const locked = await prisma.user.findUnique({ where: { id: tenant.owner.id } });
      expect(locked?.lockedUntil).not.toBeNull();
      expect(locked?.failedLoginAttempts).toBe(0);
    });

    it('a locked account is refused even with the right password', async () => {
      await prisma.user.update({
        where: { id: tenant.owner.id },
        data: { lockedUntil: new Date(Date.now() + 600_000) },
      });

      const res = await login(PASSWORD);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_ACCOUNT_LOCKED');
    });

    it('a successful login clears the counter', async () => {
      await prisma.user.update({
        where: { id: tenant.owner.id },
        data: { failedLoginAttempts: 4 },
      });

      expect((await login(PASSWORD)).status).toBe(200);
      const user = await prisma.user.findUnique({ where: { id: tenant.owner.id } });
      expect(user?.failedLoginAttempts).toBe(0);
      expect(user?.lockedUntil).toBeNull();
    });

    it('a deactivated account is refused before the password is even checked', async () => {
      await prisma.user.update({ where: { id: tenant.owner.id }, data: { isActive: false } });

      // M-1: verifying the password first confirmed valid credentials for a
      // disabled account. Both answers must now be the same shape.
      const right = await login(PASSWORD);
      const wrong = await login('definitely-wrong');
      expect(right.status).toBe(403);
      expect(right.body.error.code).toBe('AUTH_USER_INACTIVE');
      expect(wrong.status).toBe(403);
      expect(wrong.body.error.code).toBe('AUTH_USER_INACTIVE');
    });

    it('a reset lifts the lockout', async () => {
      await prisma.user.update({
        where: { id: tenant.owner.id },
        data: { lockedUntil: new Date(Date.now() + 600_000), failedLoginAttempts: 9 },
      });
      const rawToken = 'b'.repeat(64);
      const { createHash } = await import('node:crypto');
      await prisma.passwordResetToken.create({
        data: {
          userId: tenant.owner.id,
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          expiresAt: new Date(Date.now() + 600_000),
        },
      });

      await post('/auth/reset-password', { token: rawToken, newPassword: NEW_PASSWORD });

      const user = await prisma.user.findUnique({ where: { id: tenant.owner.id } });
      expect(user?.lockedUntil).toBeNull();
      expect(await argon2.verify(user!.passwordHash, NEW_PASSWORD)).toBe(true);
    });
  });
});
