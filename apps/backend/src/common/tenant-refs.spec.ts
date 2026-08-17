import { createTenantDbMock } from '../test-utils/tenant-db.mock';
import { AppException } from './exceptions/app.exception';
import { assertRefsInCompany, type TenantClient } from './tenant-refs';

const MODELS = ['trip', 'vehicle', 'driver', 'client'];

function setup() {
  const { db } = createTenantDbMock(MODELS);
  // Everything the tenant client can see resolves; anything foreign is null,
  // which is exactly how the tenant extension makes another company look.
  for (const model of MODELS) db[model]!.findUnique!.mockResolvedValue({ id: 'own' });
  return { db, client: db as unknown as TenantClient };
}

describe('assertRefsInCompany', () => {
  it('accepts ids the tenant client can see', async () => {
    const { client } = setup();
    await expect(
      assertRefsInCompany(client, {
        tripId: 'trip-1',
        vehicleId: 'vehicle-1',
        trailerId: 'trailer-1',
        driverId: 'driver-1',
        clientId: 'client-1',
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['tripId', 'trip'],
    ['vehicleId', 'vehicle'],
    ['trailerId', 'vehicle'],
    ['driverId', 'driver'],
    ['clientId', 'client'],
  ])('refuses a %s belonging to another company', async (field, model) => {
    const { db, client } = setup();
    db[model]!.findUnique!.mockResolvedValue(null);

    await expect(assertRefsInCompany(client, { [field]: 'foreign' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('answers the same way for a foreign id as for one that never existed', async () => {
    const { db, client } = setup();
    db.trip!.findUnique!.mockResolvedValue(null);

    // 404 either way: the reply must not tell a caller which of the two it is.
    const error = await assertRefsInCompany(client, { tripId: 'x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).httpStatus).toBe(404);
  });

  it('looks nothing up when the body carries no ids', async () => {
    const { db, client } = setup();
    await assertRefsInCompany(client, {});
    for (const model of MODELS) expect(db[model]!.findUnique).not.toHaveBeenCalled();
  });
});
