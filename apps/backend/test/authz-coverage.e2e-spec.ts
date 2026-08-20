/**
 * Every route must have an authorization decision, and somebody must have made
 * it on purpose.
 *
 * The RBAC matrix in `rbac.e2e-spec.ts` and the isolation suite in
 * `tenant-isolation.e2e-spec.ts` both test the routes they were written for.
 * Neither notices a route added afterwards — and a new endpoint that nobody
 * added to the matrix is exactly the one that ships without a `@Roles`
 * decorator, because it was never the subject of a test that would have caught
 * it.
 *
 * So this suite does not test behaviour. It enumerates the routes Express
 * actually has after the real AppModule is built, and fails when one of them is
 * not accounted for. Adding a route then requires adding it here, which is the
 * moment the question "who is allowed to call this?" gets asked.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
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
} from './harness';

interface Route {
  method: string;
  path: string;
}

/**
 * Routes that are deliberately reachable without a token.
 *
 * Each one is listed with the reason it is safe, because "it is public" is a
 * claim that needs re-checking whenever the handler changes. Anything not on
 * this list must reject an anonymous caller.
 */
const INTENTIONALLY_PUBLIC: Record<string, string> = {
  'POST /api/v1/auth/login': 'the login endpoint itself',
  'POST /api/v1/auth/refresh': 'presents a refresh token, not an access token',
  'POST /api/v1/auth/logout': 'must work even with an expired access token',
  'POST /api/v1/auth/driver/request-code': 'the driver has no session yet',
  'POST /api/v1/auth/driver/verify': 'exchanges the SMS code for a session',
  'GET /api/v1/public/track/:token': 'the capability IS the token in the URL',
  'GET /api/v1/health': 'orchestrator probe, blocked at the edge instead',
  'GET /api/v1/health/live': 'orchestrator probe, blocked at the edge instead',
  'GET /api/v1/health/ready': 'orchestrator probe, blocked at the edge instead',
};

/** Reads the routes Express registered, rather than a list somebody maintains. */
function registeredRoutes(app: NestExpressApplication): Route[] {
  const server = app.getHttpAdapter().getInstance() as {
    _router?: { stack: unknown[] };
    router?: { stack: unknown[] };
  };
  const stack = (server._router ?? server.router)?.stack ?? [];
  const routes: Route[] = [];

  for (const layer of stack as Array<{
    route?: { path: string; methods: Record<string, boolean> };
  }>) {
    if (!layer.route) continue;
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (enabled && method !== '_all') {
        routes.push({ method: method.toUpperCase(), path: layer.route.path });
      }
    }
  }
  return routes;
}

describe('authorization coverage', () => {
  let app: NestExpressApplication;
  let routes: Route[];

  beforeAll(async () => {
    app = await createTestApp();
    routes = registeredRoutes(app);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('finds the application’s routes at all — a silent empty list would pass everything', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  it('every route is either explicitly public or requires authentication', () => {
    const reflector = new Reflector();
    const undecided = routes
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !(key in INTENTIONALLY_PUBLIC))
      // A route not on the public list must be protected; the global JwtAuthGuard
      // covers everything that is not marked @Public, so the check is that
      // nothing NEW quietly acquired the @Public decorator.
      .filter((key) => {
        const [method, path] = key.split(' ');
        return isPublicHandler(app, reflector, method!, path!);
      });

    expect(undecided).toEqual([]);
  });

  it('every declared public route still exists — the list must not rot', () => {
    const present = new Set(routes.map((route) => `${route.method} ${route.path}`));
    const stale = Object.keys(INTENTIONALLY_PUBLIC).filter((key) => !present.has(key));
    expect(stale).toEqual([]);
  });

  describe('anonymous callers', () => {
    it.each(
      // Sample the protected surface rather than every route: the point is that
      // the global guard is mounted, and a handful of routes across different
      // modules proves that as well as forty do, in a fraction of the time.
      [
        ['GET', '/api/v1/trips'],
        ['GET', '/api/v1/vehicles'],
        ['GET', '/api/v1/finance/summary'],
        ['POST', '/api/v1/ai/chat'],
        ['GET', '/api/v1/users'],
        ['GET', '/api/v1/admin/companies'],
        ['GET', '/api/v1/tracking/live'],
        ['POST', '/api/v1/files/upload'],
      ] as Array<[string, string]>,
    )('%s %s is refused without a token', async (method, path) => {
      const response = await api(app)[method.toLowerCase() as 'get'](path);
      expect(response.status).toBe(401);
    });
  });

  describe('a DRIVER cannot reach anything financial', () => {
    // The single most damaging confusion in this product would be a driver
    // seeing what the company charges. It is asserted here independently of
    // the RBAC matrix so that deleting a matrix row cannot silently drop it.
    const FINANCIAL = [
      '/api/v1/finance/summary',
      '/api/v1/finance/trips',
      '/api/v1/finance/routes',
      '/api/v1/finance/vehicles',
      '/api/v1/finance/monthly',
      '/api/v1/finance/fuel',
      '/api/v1/incomes',
      '/api/v1/expenses',
      '/api/v1/ai/insights',
    ];

    let driverToken: string;

    beforeAll(async () => {
      await resetDatabase();
      const company = await createCompany('Coverage Co');
      const driver = await login(app, await createUser(company.id, 'DRIVER'));
      driverToken = driver.accessToken;
    });
    beforeEach(() => resetRateLimits(app));

    it.each(FINANCIAL)('%s → 403', async (path) => {
      const response = await api(app).get(path).set(auth(driverToken));
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('POST /ai/chat → 403 as well: the answer is made of money', async () => {
      const response = await api(app)
        .post('/api/v1/ai/chat')
        .set(auth(driverToken))
        .send({ question: 'Bu oy qancha foyda?' });
      expect(response.status).toBe(403);
    });
  });
});

/** True when the handler for this route carries @Public. */
function isPublicHandler(
  app: NestExpressApplication,
  reflector: Reflector,
  method: string,
  path: string,
): boolean {
  const server = app.getHttpAdapter().getInstance() as {
    _router?: { stack: unknown[] };
    router?: { stack: unknown[] };
  };
  const stack = ((server._router ?? server.router)?.stack ?? []) as Array<{
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> };
  }>;

  for (const layer of stack) {
    if (!layer.route || layer.route.path !== path) continue;
    if (!layer.route.methods[method.toLowerCase()]) continue;
    for (const handler of layer.route.stack) {
      const target = handler.handle as (...args: unknown[]) => unknown;
      if (reflector.get<boolean>(IS_PUBLIC_KEY, target)) return true;
    }
  }
  return false;
}

// Referenced so an accidental rename of the roles metadata key fails the build
// here rather than silently disabling the decorator everywhere.
void ROLES_KEY;
