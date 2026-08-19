/**
 * Authentication and session security, end to end.
 *
 * Covers C-5 (rate limiting), M-4 (dev code leak), M-5 (refresh reuse
 * detection), M-17 (live authorisation) and the token-revocation story.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  api,
  auth,
  createCompany,
  createTestApp,
  createUser,
  login,
  prisma,
  resetDatabase,
  resetRateLimits,
  uniqueSuffix,
  type TestUser,
} from './harness';

const uniquePhone = (): string => `+9989${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

describe('Auth security', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    resetRateLimits(app);
  });

  describe('C-5 rate limiting', () => {
    it('locks out password brute force after 5 attempts a minute', async () => {
      const company = await createCompany();
      const identifier = company.owner.email;

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 8; attempt++) {
        const response = await api(app)
          .post('/api/v1/auth/login')
          .send({ identifier, password: 'definitely-wrong' });
        statuses.push(response.status);
      }

      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses.slice(5)).toEqual([429, 429, 429]);
    });

    it('the 429 carries the machine-readable RATE_LIMITED code and a retry hint', async () => {
      const company = await createCompany();
      let last;
      for (let attempt = 0; attempt < 7; attempt++) {
        last = await api(app)
          .post('/api/v1/auth/login')
          .send({ identifier: company.owner.email, password: 'wrong' });
      }
      expect(last!.status).toBe(429);
      expect(last!.body.error.code).toBe('RATE_LIMITED');
      expect(last!.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(last!.body.success).toBe(false);
    });

    it('caps SMS codes per phone number, so one victim cannot be bombed', async () => {
      const company = await createCompany();
      const phone = uniquePhone();
      await createUser(company.id, 'DRIVER', { phone });

      const first = await api(app).post('/api/v1/auth/driver/request-code').send({ phone });
      const second = await api(app).post('/api/v1/auth/driver/request-code').send({ phone });

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
      // Exactly one code was generated, so exactly one SMS was paid for.
      expect(await prisma.smsCode.count({ where: { phone } })).toBe(1);
    });

    it('one phone being limited does not lock out a different phone', async () => {
      const company = await createCompany();
      const victim = uniquePhone();
      const bystander = uniquePhone();
      await createUser(company.id, 'DRIVER', { phone: victim });
      await createUser(company.id, 'DRIVER', { phone: bystander });

      await api(app).post('/api/v1/auth/driver/request-code').send({ phone: victim }).expect(200);
      await api(app).post('/api/v1/auth/driver/request-code').send({ phone: victim }).expect(429);
      await api(app)
        .post('/api/v1/auth/driver/request-code')
        .send({ phone: bystander })
        .expect(200);
    });

    it('bounds the unauthenticated public tracking endpoint', async () => {
      const statuses = new Set<number>();
      for (let attempt = 0; attempt < 65; attempt++) {
        const response = await api(app).get('/api/v1/public/track/nonexistent-token');
        statuses.add(response.status);
      }
      expect(statuses.has(429)).toBe(true);
    });
  });

  describe('M-4 the SMS code never leaks in a non-development build', () => {
    it('omits devCode when NODE_ENV is not exactly "development"', async () => {
      const company = await createCompany();
      const phone = uniquePhone();
      await createUser(company.id, 'DRIVER', { phone });

      // The suite runs with NODE_ENV=test — which the old `!== 'production'`
      // check treated as "safe to leak".
      const response = await api(app)
        .post('/api/v1/auth/driver/request-code')
        .send({ phone })
        .expect(200);

      expect(response.body.data).toEqual({ sent: true });
      expect(JSON.stringify(response.body)).not.toMatch(/\d{6}/);
    });

    it('answers identically for an unknown phone (no enumeration)', async () => {
      const known = uniquePhone();
      const unknown = uniquePhone();
      const company = await createCompany();
      await createUser(company.id, 'DRIVER', { phone: known });

      const a = await api(app).post('/api/v1/auth/driver/request-code').send({ phone: known });
      const b = await api(app).post('/api/v1/auth/driver/request-code').send({ phone: unknown });

      expect(a.body).toEqual(b.body);
      expect(a.status).toBe(b.status);
    });
  });

  describe('M-5 refresh token rotation and reuse detection', () => {
    async function loggedIn(): Promise<TestUser> {
      const company = await createCompany();
      return login(app, company.owner);
    }

    it('rotates: the old refresh token stops working immediately', async () => {
      const user = await loggedIn();

      const rotated = await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(200);
      expect(rotated.body.data.refreshToken).not.toBe(user.refreshToken);

      await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
    });

    it('replaying a rotated token kills the WHOLE family (theft containment)', async () => {
      const user = await loggedIn();
      const stolen = user.refreshToken;

      const legit = await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: stolen })
        .expect(200);
      const currentToken = legit.body.data.refreshToken as string;

      // The thief replays the old token…
      await api(app).post('/api/v1/auth/refresh').send({ refreshToken: stolen }).expect(401);

      // …and the victim's current token is dead too, so the theft surfaces.
      await api(app).post('/api/v1/auth/refresh').send({ refreshToken: currentToken }).expect(401);

      const live = await prisma.refreshToken.count({ where: { revokedAt: null } });
      expect(live).toBe(0);
    });

    it('parallel refreshes never mint two live tokens (H-10 server side)', async () => {
      const user = await loggedIn();

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          api(app).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }),
        ),
      );

      expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
      expect(responses.filter((r) => r.status === 401)).toHaveLength(4);
    });

    it('logout revokes the whole chain', async () => {
      const user = await loggedIn();
      const rotated = await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(200);

      await api(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: rotated.body.data.refreshToken })
        .expect(200);

      await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.body.data.refreshToken })
        .expect(401);
      expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    });

    it('refresh tokens are stored hashed, never in the clear', async () => {
      const user = await loggedIn();
      const rows = await prisma.refreshToken.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(user.refreshToken).not.toContain(rows[0]!.tokenHash);
    });
  });

  describe('M-17 live authorisation', () => {
    it('a deactivated user cannot keep using an already-issued access token', async () => {
      const company = await createCompany();
      const logist = await login(app, await createUser(company.id, 'LOGIST'));
      await api(app).get('/api/v1/trips').set(auth(logist.accessToken)).expect(200);

      await prisma.user.update({ where: { id: logist.id }, data: { isActive: false } });
      // Clear the short-lived verdict cache the guard keeps.
      app
        .get((await import('../src/common/guards/session-state.service')).SessionStateService)
        .invalidate(logist.id);

      const response = await api(app).get('/api/v1/trips').set(auth(logist.accessToken));
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_USER_INACTIVE');
    });

    it('a suspended company locks out its users', async () => {
      const company = await createCompany();
      const owner = await login(app, company.owner);
      await api(app).get('/api/v1/trips').set(auth(owner.accessToken)).expect(200);

      await prisma.company.update({ where: { id: company.id }, data: { isActive: false } });
      app
        .get((await import('../src/common/guards/session-state.service')).SessionStateService)
        .invalidate(owner.id);

      await api(app).get('/api/v1/trips').set(auth(owner.accessToken)).expect(403);
    });

    it('a lapsed subscription blocks the API with 402', async () => {
      const company = await createCompany();
      const owner = await login(app, company.owner);
      await prisma.company.update({
        where: { id: company.id },
        data: { subscriptionUntil: new Date(Date.now() - 86_400_000) },
      });
      app
        .get((await import('../src/common/guards/session-state.service')).SessionStateService)
        .invalidate(owner.id);

      const response = await api(app).get('/api/v1/trips').set(auth(owner.accessToken));
      expect(response.status).toBe(402);
    });

    it('a deactivated user cannot refresh either', async () => {
      const company = await createCompany();
      const owner = await login(app, company.owner);
      await prisma.user.update({ where: { id: owner.id }, data: { isActive: false } });

      await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: owner.refreshToken })
        .expect(403);
    });
  });

  describe('credentials handling', () => {
    it('never returns a password hash from /auth/me', async () => {
      const company = await createCompany();
      const owner = await login(app, company.owner);
      const response = await api(app)
        .get('/api/v1/auth/me')
        .set(auth(owner.accessToken))
        .expect(200);

      expect(response.body.data).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(response.body)).not.toContain('$argon2');
    });

    it('never returns a password hash from the user list', async () => {
      const company = await createCompany();
      const owner = await login(app, company.owner);
      await createUser(company.id, 'LOGIST');

      const response = await api(app).get('/api/v1/users').set(auth(owner.accessToken)).expect(200);
      expect(JSON.stringify(response.body)).not.toContain('$argon2');
    });

    it('stores new passwords with argon2id, never in the clear', async () => {
      const company = await createCompany();
      const owner = await login(app, company.owner);
      const email = `hashcheck-${uniqueSuffix()}@example.test`;

      await api(app)
        .post('/api/v1/users')
        .set(auth(owner.accessToken))
        .send({ fullName: 'Hash Check', email, password: 'a-real-password-1234', role: 'LOGIST' })
        .expect(201);

      const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(stored.passwordHash).not.toContain('a-real-password-1234');
    });

    it('rejects an unknown identifier and a wrong password with the same code', async () => {
      const company = await createCompany();
      const wrongPassword = await api(app)
        .post('/api/v1/auth/login')
        .send({ identifier: company.owner.email, password: 'nope' });
      resetRateLimits(app);
      const unknownUser = await api(app)
        .post('/api/v1/auth/login')
        .send({ identifier: 'ghost@example.test', password: 'nope' });

      expect(wrongPassword.status).toBe(401);
      expect(unknownUser.status).toBe(401);
      expect(unknownUser.body.error.code).toBe(wrongPassword.body.error.code);
      expect(unknownUser.body.error.message).toBe(wrongPassword.body.error.message);
    });
  });

  describe('error responses leak nothing', () => {
    it('a 500 never carries a stack trace or a connection string', async () => {
      const company = await createCompany();
      const owner = await login(app, company.owner);
      // A malformed UUID hits the ParseUUIDPipe, not the database.
      const response = await api(app).get('/api/v1/trips/not-a-uuid').set(auth(owner.accessToken));

      const body = JSON.stringify(response.body);
      expect(body).not.toMatch(/at \w+ \(/); // stack frames
      expect(body).not.toContain('postgresql://');
      expect(body).not.toContain('prisma');
    });

    it('an unknown body field is refused rather than silently dropped', async () => {
      const company = await createCompany();
      const owner = await login(app, company.owner);
      const response = await api(app)
        .post('/api/v1/clients')
        .set(auth(owner.accessToken))
        .send({ name: 'X', isAdmin: true })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });
});
