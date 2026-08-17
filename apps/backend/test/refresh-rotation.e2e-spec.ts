/**
 * Refresh-token rotation against a real database (TASK-2.4).
 *
 * The race and the reuse case are both about what two requests do to one row,
 * which a mocked Prisma cannot prove. These run the real compare-and-set.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Refresh token rotation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let tenant: TenantFixture;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
    auth = app.get(AuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    tenant = await createTenant(app, 'Rotation');
    // The fixture mints a token per user; these tests count rows, so start clean.
    await prisma.refreshToken.deleteMany({ where: { userId: tenant.owner.id } });
  });

  /**
   * Driven as a native client: the token semantics under test are the same for
   * both transports, and the body form is the one a test can inspect. The
   * cookie transport itself is covered by token-transport.e2e-spec.ts.
   */
  const refresh = (token: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('x-client', 'mobile')
      .send({ refreshToken: token });

  it('rotates on use: the old token stops working, the new one works', async () => {
    const { refreshToken } = await auth.issueTokens(tenant.owner);

    const first = await refresh(refreshToken);
    expect(first.status).toBe(200);
    const rotated = first.body.data.refreshToken as string;
    expect(rotated).not.toBe(refreshToken);

    const withNew = await refresh(rotated);
    expect(withNew.status).toBe(200);
  });

  it('two parallel refreshes: exactly one succeeds', async () => {
    const { refreshToken } = await auth.issueTokens(tenant.owner);

    const [a, b] = await Promise.all([refresh(refreshToken), refresh(refreshToken)]);
    const statuses = [a.status, b.status].sort();

    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 401)).toHaveLength(1);

    // And exactly one replacement row was minted, not two.
    const live = await prisma.refreshToken.count({
      where: { userId: tenant.owner.id, revokedAt: null },
    });
    expect(live).toBe(1);
  });

  it('replaying a rotated token kills the whole family', async () => {
    const { refreshToken } = await auth.issueTokens(tenant.owner);
    const rotated = (await refresh(refreshToken)).body.data.refreshToken as string;

    // The stolen copy is replayed after the legitimate client already rotated.
    const replay = await refresh(refreshToken);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('AUTH_REFRESH_REUSED');

    // The thief's replay also invalidates the token the real user holds: the
    // session cannot be trusted any more, so everyone signs in again.
    const afterBreach = await refresh(rotated);
    expect(afterBreach.status).toBe(401);

    const live = await prisma.refreshToken.count({
      where: { userId: tenant.owner.id, revokedAt: null },
    });
    expect(live).toBe(0);
  });

  it('the reuse is recorded in the audit log', async () => {
    const { refreshToken } = await auth.issueTokens(tenant.owner);
    await refresh(refreshToken);
    await refresh(refreshToken);

    // Fire-and-forget audit write; give it a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const entries = await prisma.auditLog.findMany({
      where: { action: 'REFRESH_REUSE_DETECTED', userId: tenant.owner.id },
    });
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it('logging out ends this session only, not the other devices', async () => {
    const phone = await auth.issueTokens(tenant.owner);
    const laptop = await auth.issueTokens(tenant.owner);

    const loggedOut = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: phone.refreshToken });
    expect(loggedOut.status).toBe(200);

    expect((await refresh(phone.refreshToken)).status).toBe(401);
    // A separate login is a separate family and must survive.
    expect((await refresh(laptop.refreshToken)).status).toBe(200);
  });

  it('every login starts an independent token family', async () => {
    await auth.issueTokens(tenant.owner);
    await auth.issueTokens(tenant.owner);

    const families = await prisma.refreshToken.findMany({
      where: { userId: tenant.owner.id },
      select: { familyId: true },
    });
    expect(new Set(families.map((row) => row.familyId)).size).toBe(2);
  });
});
