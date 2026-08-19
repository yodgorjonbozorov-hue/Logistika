/**
 * RBAC matrix — endpoint × role, enforced by the BACKEND guard.
 *
 * The web app also hides menu items per role, but that is UX only: this suite
 * exists so the claim "the security is in the backend" is a fact rather than an
 * intention. Every DENY case here is a request that the UI would never make.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { UserRole } from '@prisma/client';
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
  type TestCompany,
  type TestUser,
} from './harness';

type Method = 'get' | 'post' | 'patch' | 'delete';

interface Case {
  name: string;
  method: Method;
  path: string;
  body?: Record<string, unknown>;
  allow: UserRole[];
}

/** Roles that exist inside a tenant. SUPERADMIN is covered separately. */
const TENANT_ROLES: UserRole[] = ['OWNER', 'LOGIST', 'ACCOUNTANT', 'DRIVER'];

const CASES: Case[] = [
  { name: 'list trips', method: 'get', path: '/trips', allow: ['OWNER', 'LOGIST', 'ACCOUNTANT'] },
  {
    name: 'create trip',
    method: 'post',
    path: '/trips',
    body: { cargoName: 'x' },
    allow: ['OWNER', 'LOGIST'],
  },
  { name: 'my trips', method: 'get', path: '/trips/my', allow: ['DRIVER'] },
  {
    name: 'list drivers',
    method: 'get',
    path: '/drivers',
    allow: ['OWNER', 'LOGIST', 'ACCOUNTANT'],
  },
  {
    name: 'create driver',
    method: 'post',
    path: '/drivers',
    body: { fullName: 'x' },
    allow: ['OWNER', 'LOGIST'],
  },
  {
    name: 'create vehicle',
    method: 'post',
    path: '/vehicles',
    body: { plateNumber: 'RBAC001' },
    allow: ['OWNER', 'LOGIST'],
  },
  {
    name: 'list clients',
    method: 'get',
    path: '/clients',
    allow: ['OWNER', 'LOGIST', 'ACCOUNTANT'],
  },
  {
    name: 'list expenses',
    method: 'get',
    path: '/expenses',
    allow: ['OWNER', 'LOGIST', 'ACCOUNTANT'],
  },
  {
    name: 'list incomes',
    method: 'get',
    path: '/incomes',
    allow: ['OWNER', 'LOGIST', 'ACCOUNTANT'],
  },
  {
    name: 'live map',
    method: 'get',
    path: '/tracking/live',
    allow: ['OWNER', 'LOGIST', 'ACCOUNTANT'],
  },
  { name: 'list users', method: 'get', path: '/users', allow: ['OWNER', 'LOGIST'] },
  {
    name: 'create user',
    method: 'post',
    path: '/users',
    body: { fullName: 'x', email: 'rbac@example.test', password: 'password-1234', role: 'LOGIST' },
    allow: ['OWNER'],
  },
  {
    name: 'update company',
    method: 'patch',
    path: '/company',
    body: { name: 'x' },
    allow: ['OWNER'],
  },
  { name: 'admin companies', method: 'get', path: '/admin/companies', allow: [] },
];

describe('RBAC matrix', () => {
  let app: NestExpressApplication;
  let company: TestCompany;
  const users = new Map<UserRole, TestUser>();

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase();
    company = await createCompany('RBAC Co');
    users.set('OWNER', await login(app, company.owner));
    for (const role of ['LOGIST', 'ACCOUNTANT', 'DRIVER'] as UserRole[]) {
      resetRateLimits(app);
      users.set(role, await login(app, await createUser(company.id, role)));
    }
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(() => resetRateLimits(app));

  describe.each(CASES)('$method $path ($name)', (testCase) => {
    it.each(TENANT_ROLES)(`%s → ${'expected verdict'}`, async (role) => {
      const user = users.get(role)!;
      const requestBuilder = api(app)
        [testCase.method](`/api/v1${testCase.path}`)
        .set(auth(user.accessToken));
      const response = await (testCase.body
        ? requestBuilder.send({ ...testCase.body, plateNumber: `RB${uniqueSuffix().slice(-6)}` })
        : requestBuilder);

      if (testCase.allow.includes(role)) {
        // Allowed roles must not be turned away by the ROLES guard. Anything
        // else (400 validation, 404, or DRIVER_PROFILE_MISSING for a driver
        // account with no profile linked yet) is business logic, not authz.
        expect(response.body.error?.code).not.toBe('AUTH_FORBIDDEN');
      } else {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
      }
    });
  });

  describe('SUPERADMIN', () => {
    it('reaches the platform endpoints that every tenant role is denied', async () => {
      const superadmin = await login(app, await createUser(null, 'SUPERADMIN'));
      const response = await api(app)
        .get('/api/v1/admin/companies')
        .set(auth(superadmin.accessToken))
        .expect(200);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('cannot be created through the tenant user endpoint (privilege escalation)', async () => {
      const owner = users.get('OWNER')!;
      const response = await api(app)
        .post('/api/v1/users')
        .set(auth(owner.accessToken))
        .send({
          fullName: 'Sneaky',
          email: `escalate-${uniqueSuffix()}@example.test`,
          password: 'password-1234',
          role: 'SUPERADMIN',
        })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await prisma.user.count({ where: { role: 'SUPERADMIN' } })).toBe(1);
    });
  });

  describe('unauthenticated', () => {
    it.each([
      ['/trips', 'get'],
      ['/drivers', 'get'],
      ['/expenses', 'get'],
      ['/tracking/live', 'get'],
      ['/company', 'get'],
    ] as Array<[string, Method]>)('%s requires a token', async (path, method) => {
      const response = await api(app)[method](`/api/v1${path}`);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('rejects a token signed with the wrong secret (JWT manipulation)', async () => {
      const { JwtService } = await import('@nestjs/jwt');
      const forged = new JwtService({}).sign(
        { sub: users.get('OWNER')!.id, companyId: company.id, role: 'OWNER' },
        { secret: 'an-attacker-chosen-secret-of-the-right-length', expiresIn: '15m' },
      );
      const response = await api(app).get('/api/v1/trips').set(auth(forged));
      expect(response.status).toBe(401);
    });

    it('rejects an unsigned "alg: none" token', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: users.get('OWNER')!.id, companyId: company.id, role: 'OWNER' }),
      ).toString('base64url');
      const response = await api(app)
        .get('/api/v1/trips')
        .set(auth(`${header}.${payload}.`));
      expect(response.status).toBe(401);
    });
  });
});
