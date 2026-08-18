import { SUBSCRIPTION_CACHE_MS, SubscriptionService } from './subscription.service';
import type { PrismaService } from '../../prisma/prisma.service';

function setup(company: { isActive: boolean; subscriptionUntil: Date | null } | null) {
  const findUnique = jest.fn().mockResolvedValue(company);
  const prisma = { company: { findUnique } } as unknown as PrismaService;
  return { service: new SubscriptionService(prisma), findUnique };
}

const NOW = new Date('2026-08-18T12:00:00Z');

describe('SubscriptionService.stateOf', () => {
  it('reports a paid company as usable', async () => {
    const { service } = setup({
      isActive: true,
      subscriptionUntil: new Date('2026-12-31T00:00:00Z'),
    });

    expect(await service.stateOf('company-a', NOW)).toEqual({
      isActive: true,
      until: new Date('2026-12-31T00:00:00Z'),
      expired: false,
    });
  });

  it('reports a lapsed subscription as expired', async () => {
    const { service } = setup({
      isActive: true,
      subscriptionUntil: new Date('2026-07-31T00:00:00Z'),
    });

    expect((await service.stateOf('company-a', NOW)).expired).toBe(true);
  });

  it('treats no expiry date as no expiry, not as expired', async () => {
    // Trials and tenants created before billing existed have none; locking
    // them out would be the opposite of what the field means.
    const { service } = setup({ isActive: true, subscriptionUntil: null });

    const state = await service.stateOf('company-a', NOW);
    expect(state.expired).toBe(false);
    expect(state.until).toBeNull();
  });

  it('treats a company that no longer exists as inactive', async () => {
    // Failing open here would make a deleted tenant the most privileged one.
    const { service } = setup(null);

    expect((await service.stateOf('gone', NOW)).isActive).toBe(false);
  });

  it('reads the company once per minute, not once per request', async () => {
    const { service, findUnique } = setup({ isActive: true, subscriptionUntil: null });

    await service.stateOf('company-a', NOW);
    await service.stateOf('company-a', new Date(NOW.getTime() + 1000));
    await service.stateOf('company-a', new Date(NOW.getTime() + 30_000));

    // This runs on every single request; a query per request is a real cost
    // and billing state does not change between two clicks.
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('reads again once the cached answer is stale', async () => {
    const { service, findUnique } = setup({ isActive: true, subscriptionUntil: null });

    await service.stateOf('company-a', NOW);
    await service.stateOf('company-a', new Date(NOW.getTime() + SUBSCRIPTION_CACHE_MS + 1));

    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('expires a cached company the moment its date passes', async () => {
    const until = new Date(NOW.getTime() + 1000);
    const { service, findUnique } = setup({ isActive: true, subscriptionUntil: until });

    expect((await service.stateOf('company-a', NOW)).expired).toBe(false);
    // Same cached row, one second later: the answer must change without a
    // re-read, or a subscription could outlive its date by up to a minute.
    expect((await service.stateOf('company-a', new Date(NOW.getTime() + 2000))).expired).toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('caches each company separately', async () => {
    const { service, findUnique } = setup({ isActive: true, subscriptionUntil: null });

    await service.stateOf('company-a', NOW);
    await service.stateOf('company-b', NOW);

    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('re-reads immediately after an invalidation', async () => {
    const { service, findUnique } = setup({ isActive: true, subscriptionUntil: null });

    await service.stateOf('company-a', NOW);
    service.invalidate('company-a');
    await service.stateOf('company-a', NOW);

    // Switching a company off must take effect now, not in a minute.
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('drops every cached company when the whole cache is cleared', async () => {
    const { service, findUnique } = setup({ isActive: true, subscriptionUntil: null });

    await service.stateOf('company-a', NOW);
    await service.stateOf('company-b', NOW);
    service.clear();
    await service.stateOf('company-a', NOW);
    await service.stateOf('company-b', NOW);

    expect(findUnique).toHaveBeenCalledTimes(4);
  });

  it('never asks for tenant data, only for the tenant row', async () => {
    const { service, findUnique } = setup({ isActive: true, subscriptionUntil: null });

    await service.stateOf('company-a', NOW);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'company-a' },
      select: { isActive: true, subscriptionUntil: true },
    });
  });
});
