import { TOKEN_VERSION_CACHE_MS, TokenVersionService } from './token-version.service';
import type { PrismaService } from '../../prisma/prisma.service';

function setup(user: { tokenVersion: number; isActive: boolean } | null) {
  const findUnique = jest.fn().mockResolvedValue(user);
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  return { service: new TokenVersionService(prisma), findUnique };
}

const NOW = 1_000_000;

describe('TokenVersionService', () => {
  it('reports the version a valid token must carry', async () => {
    const { service } = setup({ tokenVersion: 3, isActive: true });
    expect(await service.currentFor('u1', NOW)).toBe(3);
  });

  it('gives a deactivated user no valid version at all', async () => {
    // Otherwise a switched-off account keeps full access until its token
    // expires, which is the whole bug (M-2).
    const { service } = setup({ tokenVersion: 0, isActive: false });
    expect(await service.currentFor('u1', NOW)).toBeNull();
  });

  it('gives a user who no longer exists no version', async () => {
    const { service } = setup(null);
    expect(await service.currentFor('gone', NOW)).toBeNull();
  });

  it('reads once per window, not once per request', async () => {
    const { service, findUnique } = setup({ tokenVersion: 0, isActive: true });

    await service.currentFor('u1', NOW);
    await service.currentFor('u1', NOW + 1000);

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('reads again once the window has passed', async () => {
    const { service, findUnique } = setup({ tokenVersion: 0, isActive: true });

    await service.currentFor('u1', NOW);
    await service.currentFor('u1', NOW + TOKEN_VERSION_CACHE_MS + 1);

    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('re-reads at once after a revocation', async () => {
    const { service, findUnique } = setup({ tokenVersion: 0, isActive: true });

    await service.currentFor('u1', NOW);
    service.invalidate('u1');
    await service.currentFor('u1', NOW);

    // A revocation that took 30 seconds to apply would not be a revocation.
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('drops every user when the cache is cleared', async () => {
    const { service, findUnique } = setup({ tokenVersion: 0, isActive: true });

    await service.currentFor('u1', NOW);
    await service.currentFor('u2', NOW);
    service.clear();
    await service.currentFor('u1', NOW);

    expect(findUnique).toHaveBeenCalledTimes(3);
  });

  it('never caches a user it refused', async () => {
    const { service, findUnique } = setup(null);

    await service.currentFor('u1', NOW);
    await service.currentFor('u1', NOW);

    // Caching "no" would keep refusing a user who was switched back on.
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
