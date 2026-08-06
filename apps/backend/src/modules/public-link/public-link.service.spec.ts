import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { PublicLinkService } from './public-link.service';

const config = { get: () => 'https://app.truckcontrol.uz' } as unknown as ConfigService;

describe('PublicLinkService', () => {
  function setup() {
    const { prisma, db } = createTenantDbMock(['trip']);
    const bare = prisma as unknown as Record<string, unknown>;
    bare.trackingLink = {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'l1', ...data }),
        ),
      findUnique: jest.fn(),
    };
    bare.tripEvent = { findFirst: jest.fn().mockResolvedValue(null) };
    bare.gpsTrack = { findFirst: jest.fn().mockResolvedValue(null) };
    const service = new PublicLinkService(prisma as unknown as PrismaService, config);
    return { service, db, bare };
  }

  it('creates a tokenized URL only for trips inside the tenant', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue({ id: 'trip-1', unloadingDate: null });

    const link = await service.createLink(ACTOR, 'trip-1');

    expect(link.url).toMatch(/^https:\/\/app\.truckcontrol\.uz\/track\/[0-9a-f]{48}$/);
    expect(link.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a foreign/unknown trip', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue(null);
    await expect(service.createLink(ACTOR, 'foreign')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('public view is sanitized: no prices, driver phone or company ids', async () => {
    const { service, bare } = setup();
    (bare.trackingLink as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
      companyId: 'company-a',
      expiresAt: new Date(Date.now() + 86_400_000),
      trip: {
        id: 'trip-1',
        tripNumber: '42',
        status: 'IN_PROGRESS',
        cargoName: 'Paxta',
        loadingAddress: 'Toshkent',
        loadingDate: new Date(),
        unloadingAddress: 'Samarqand',
        unloadingDate: null,
        agreedPrice: 125000000n,
        driverId: 'd1',
        companyId: 'company-a',
      },
    });

    const view = await service.publicView('token-x');

    expect(view.tripNumber).toBe('42');
    expect(view).not.toHaveProperty('agreedPrice');
    expect(view).not.toHaveProperty('driverId');
    expect(view).not.toHaveProperty('companyId');
    expect(JSON.stringify(view)).not.toContain('company-a');
  });

  it('expired or unknown tokens → NOT_FOUND', async () => {
    const { service, bare } = setup();
    (bare.trackingLink as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
      companyId: 'company-a',
      expiresAt: new Date(Date.now() - 1000),
      trip: { tripNumber: '1' },
    });
    await expect(service.publicView('stale')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    (bare.trackingLink as { findUnique: jest.Mock }).findUnique.mockResolvedValue(null);
    await expect(service.publicView('ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
