import { Prisma, type Trip } from '@prisma/client';
import {
  assertNothingElseInProgress,
  busyIndexError,
  inProgressElsewhere,
} from './trip-availability';

const trip = (over: Partial<Trip> = {}) =>
  ({
    id: 't1',
    driverId: 'd1',
    vehicleId: 'v1',
    trailerId: null,
    ...over,
  }) as Trip;

function setup(busy: { id: string; tripNumber: string } | null) {
  const findFirst = jest.fn().mockResolvedValue(busy);
  return { db: { trip: { findFirst } }, findFirst };
}

describe('inProgressElsewhere', () => {
  it('finds nothing when the driver and truck are free', async () => {
    const { db } = setup(null);
    expect(await inProgressElsewhere(db, trip())).toBeNull();
  });

  it('names the trip the driver is already on', async () => {
    const { db } = setup({ id: 't9', tripNumber: 'TR-2026-0041' });

    expect(await inProgressElsewhere(db, trip())).toEqual({
      code: 'DRIVER_BUSY',
      tripNumber: 'TR-2026-0041',
      tripId: 't9',
      conflictOn: 'driverId',
    });
  });

  it('excludes the trip being started from its own check', async () => {
    const { db, findFirst } = setup(null);
    await inProgressElsewhere(db, trip());

    // Restarting a trip that is already IN_PROGRESS must not report itself as
    // the thing blocking it.
    expect(findFirst.mock.calls[0][0].where).toEqual({
      driverId: 'd1',
      status: 'IN_PROGRESS',
      id: { not: 't1' },
    });
  });

  it('skips a resource the trip does not use', async () => {
    const { db, findFirst } = setup(null);
    await inProgressElsewhere(db, trip({ driverId: null, trailerId: null }));

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ vehicleId: 'v1' });
  });

  it('checks the trailer too — it cannot be in two places either', async () => {
    const { db, findFirst } = setup(null);
    await inProgressElsewhere(db, trip({ trailerId: 'tr1' }));

    const fields = findFirst.mock.calls.map(
      (call: [{ where: Record<string, unknown> }]) => Object.keys(call[0].where)[0],
    );
    expect(fields).toEqual(['driverId', 'vehicleId', 'trailerId']);
  });

  it('reports a busy trailer as a vehicle conflict', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 't9', tripNumber: 'TR-2026-0007' });

    const busy = await inProgressElsewhere({ trip: { findFirst } }, trip({ trailerId: 'tr1' }));
    expect(busy).toMatchObject({ code: 'VEHICLE_BUSY', conflictOn: 'trailerId' });
  });
});

describe('assertNothingElseInProgress', () => {
  it('says nothing when everything is free', async () => {
    const { db } = setup(null);
    await expect(assertNothingElseInProgress(db, trip())).resolves.toBeUndefined();
  });

  it('throws with the blocking trip number in the message', async () => {
    const { db } = setup({ id: 't9', tripNumber: 'TR-2026-0041' });

    // "Truck is on trip TR-2026-0041" is actionable; "conflict" is not.
    await expect(assertNothingElseInProgress(db, trip())).rejects.toMatchObject({
      code: 'DRIVER_BUSY',
      httpStatus: 409,
      params: { tripNumber: 'TR-2026-0041' },
    });
  });
});

describe('busyIndexError', () => {
  // Prisma reports the columns, not the index name: these partial indexes are
  // not in the schema for it to know about. Verified against a real insert.
  const p2002 = (target: string[] | string | undefined) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: target === undefined ? undefined : { target },
    });

  it('translates the driver index into DRIVER_BUSY', () => {
    expect(busyIndexError(p2002(['company_id', 'driver_id']))?.code).toBe('DRIVER_BUSY');
  });

  it('translates the vehicle and trailer indexes into VEHICLE_BUSY', () => {
    expect(busyIndexError(p2002(['company_id', 'vehicle_id']))?.code).toBe('VEHICLE_BUSY');
    expect(busyIndexError(p2002(['company_id', 'trailer_id']))?.code).toBe('VEHICLE_BUSY');
  });

  it('leaves every other unique violation alone', () => {
    // Reading an unrelated constraint as "busy" would hide a real bug.
    expect(busyIndexError(p2002(['company_id', 'trip_number']))).toBeNull();
    expect(busyIndexError(p2002(['company_id', 'client_event_id']))).toBeNull();
    expect(busyIndexError(p2002(['company_id']))).toBeNull();
    expect(busyIndexError(p2002('driver_id'))).toBeNull();
    expect(busyIndexError(p2002(undefined))).toBeNull();
    expect(busyIndexError(new Error('connection reset'))).toBeNull();
  });
});
