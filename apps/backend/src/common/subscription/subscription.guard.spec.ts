import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { UserRole, type CurrentUserPayload } from 'shared';
import { SubscriptionGuard } from './subscription.guard';
import type { SubscriptionService, SubscriptionState } from './subscription.service';

const LIVE: SubscriptionState = { isActive: true, until: null, expired: false };
const EXPIRED: SubscriptionState = {
  isActive: true,
  until: new Date('2026-07-31T00:00:00Z'),
  expired: true,
};
const SWITCHED_OFF: SubscriptionState = { isActive: false, until: null, expired: false };

const OWNER = { userId: 'u1', companyId: 'company-a', role: UserRole.OWNER } as CurrentUserPayload;

function setup(state: SubscriptionState, options: { isPublic?: boolean } = {}) {
  const stateOf = jest.fn().mockResolvedValue(state);
  const subscriptions = { stateOf } as unknown as SubscriptionService;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(options.isPublic ?? false),
  } as unknown as Reflector;
  return { guard: new SubscriptionGuard(subscriptions, reflector), stateOf };
}

function request(method: string, user?: CurrentUserPayload) {
  const req: Record<string, unknown> = { method, user };
  const context = {
    getType: () => 'http',
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('SubscriptionGuard', () => {
  it('lets a paid company write', async () => {
    const { guard } = setup(LIVE);
    const { context } = request('POST', OWNER);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('lets an expired company keep reading its own data', async () => {
    const { guard } = setup(EXPIRED);
    const { context } = request('GET', OWNER);

    // Locking a late payer out of their own trips and invoices is punishment,
    // not collection — and it takes their records away with it.
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each(['POST', 'PATCH', 'DELETE', 'PUT'])('refuses %s while expired', async (method) => {
    const { guard } = setup(EXPIRED);
    const { context } = request(method, OWNER);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_EXPIRED',
      httpStatus: 402,
      params: { until: '2026-07-31' },
    });
  });

  it('refuses a switched-off company entirely, reads included', async () => {
    const { guard } = setup(SWITCHED_OFF);
    const { context } = request('GET', OWNER);

    // Being switched off is an administrative decision, not a billing state.
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'COMPANY_INACTIVE',
      httpStatus: 403,
    });
  });

  it('leaves the state on the request so the response can warn', async () => {
    const { guard } = setup(EXPIRED);
    const { context, req } = request('GET', OWNER);

    await guard.canActivate(context);

    expect(req.subscription).toBe(EXPIRED);
  });

  it('never checks a public route', async () => {
    const { guard, stateOf } = setup(SWITCHED_OFF, { isPublic: true });
    const { context } = request('POST');

    // Login is public: an expired company that could not log in would never
    // find out why it is expired.
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(stateOf).not.toHaveBeenCalled();
  });

  it('never checks SUPERADMIN', async () => {
    const { guard, stateOf } = setup(SWITCHED_OFF);
    const superadmin = {
      userId: 'root',
      companyId: 'company-a',
      role: UserRole.SUPERADMIN,
    } as CurrentUserPayload;

    // That is the account that fixes the subscription.
    await expect(guard.canActivate(request('PATCH', superadmin).context)).resolves.toBe(true);
    expect(stateOf).not.toHaveBeenCalled();
  });

  it('ignores anything that is not an HTTP request', async () => {
    const { guard, stateOf } = setup(SWITCHED_OFF);
    // Scheduled jobs and future transports have no request to read a tenant
    // from; refusing them here would break work nobody is being billed for.
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(stateOf).not.toHaveBeenCalled();
  });

  it('has nothing to check without a tenant', async () => {
    const { guard, stateOf } = setup(SWITCHED_OFF);
    const { context } = request('POST', { ...OWNER, companyId: null } as CurrentUserPayload);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(stateOf).not.toHaveBeenCalled();
  });
});
