import { assertTenantRefs } from './tenant-refs';

/**
 * Foreign keys in this schema are global, so nothing at the database level
 * stops company B from attaching an expense to company A's trip. This check is
 * what stops it, and it has to run through the tenant-scoped client.
 */
describe('assertTenantRefs', () => {
  function db(found: Record<string, boolean>) {
    const model = (key: string) => ({
      findUnique: jest.fn(() => Promise.resolve(found[key] ? { id: 'x' } : null)),
    });
    return {
      trip: model('trip'),
      vehicle: model('vehicle'),
      driver: model('driver'),
      client: model('client'),
    };
  }

  it('passes when every referenced record exists in the tenant', async () => {
    const client = db({ trip: true, vehicle: true, driver: true, client: true });
    await expect(
      assertTenantRefs(client, {
        tripId: 't1',
        vehicleId: 'v1',
        driverId: 'd1',
        clientId: 'c1',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a reference that belongs to another tenant', async () => {
    // The scoped client cannot see it, which is indistinguishable from missing.
    const client = db({ trip: false });
    await expect(assertTenantRefs(client, { tripId: 'other-company-trip' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: { id: 'other-company-trip' },
    });
  });

  it('checks nothing when no references are supplied', async () => {
    const client = db({});
    await assertTenantRefs(client, {});
    expect(client.trip.findUnique).not.toHaveBeenCalled();
    expect(client.client.findUnique).not.toHaveBeenCalled();
  });

  it('skips undefined and null references but still checks the rest', async () => {
    const client = db({ client: true });
    await assertTenantRefs(client, { tripId: undefined, driverId: null, clientId: 'c1' });

    expect(client.trip.findUnique).not.toHaveBeenCalled();
    expect(client.driver.findUnique).not.toHaveBeenCalled();
    expect(client.client.findUnique).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('looks the references up in parallel', async () => {
    const client = db({ trip: true, vehicle: true, driver: true, client: true });
    await assertTenantRefs(client, { tripId: 't', vehicleId: 'v', driverId: 'd', clientId: 'c' });

    // Four sequential round trips per money row would be a needless cost.
    for (const model of [client.trip, client.vehicle, client.driver, client.client]) {
      expect(model.findUnique).toHaveBeenCalledTimes(1);
    }
  });

  it('resolves a trailer through the vehicle model', async () => {
    const client = db({ vehicle: false });
    await expect(assertTenantRefs(client, { trailerId: 'foreign-trailer' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(client.vehicle.findUnique).toHaveBeenCalledWith({ where: { id: 'foreign-trailer' } });
  });
});
