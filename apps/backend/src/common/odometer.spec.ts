import { assertOdometerOrder, isOdometerOrderValid, odometerDistanceKm } from './odometer';

describe('isOdometerOrderValid', () => {
  it('accepts a reading that moved forward', () => {
    expect(isOdometerOrderValid(411_500, 411_818)).toBe(true);
  });

  it('accepts an unchanged reading (a trip inside one yard covers no km)', () => {
    expect(isOdometerOrderValid(411_500, 411_500)).toBe(true);
  });

  it('rejects a reading that went backwards', () => {
    // 411 518 typed as 411 158: a plausible slip, and a −342 km trip.
    expect(isOdometerOrderValid(411_500, 411_158)).toBe(false);
  });

  it('treats an unknown reading as not-yet-wrong', () => {
    // A trip may legitimately finish without anybody writing the number down;
    // refusing those would block the finish over missing data, not bad data.
    expect(isOdometerOrderValid(null, 100)).toBe(true);
    expect(isOdometerOrderValid(100, null)).toBe(true);
    expect(isOdometerOrderValid(undefined, undefined)).toBe(true);
  });
});

describe('odometerDistanceKm', () => {
  it('subtracts the readings', () => {
    expect(String(odometerDistanceKm(411_500, 411_818))).toBe('318');
  });

  it('gives zero for an unchanged reading, not undefined', () => {
    // 0 km is a fact; undefined would drop the trip out of per-km reports.
    expect(String(odometerDistanceKm(500, 500))).toBe('0');
  });

  it('returns undefined rather than a negative number', () => {
    // The guard belongs to the caller, but a caller that forgets it still must
    // not be able to write −342 into actual_distance_km.
    expect(odometerDistanceKm(411_500, 411_158)).toBeUndefined();
  });

  it('returns undefined when either reading is missing', () => {
    expect(odometerDistanceKm(null, 100)).toBeUndefined();
    expect(odometerDistanceKm(100, undefined)).toBeUndefined();
  });

  it('stays exact across a large reading', () => {
    expect(String(odometerDistanceKm(1_000_000, 9_999_999))).toBe('8999999');
  });
});

describe('assertOdometerOrder', () => {
  it('says nothing when the readings are in order', () => {
    expect(() => assertOdometerOrder(100, 200)).not.toThrow();
    expect(() => assertOdometerOrder(null, 200)).not.toThrow();
  });

  it('throws ODOMETER_INVALID with both readings in the message', () => {
    // The driver has to be told which two numbers disagree; "invalid input"
    // sends them back to the office to guess.
    expect(() => assertOdometerOrder(411_500, 411_158)).toThrow(
      expect.objectContaining({
        code: 'ODOMETER_INVALID',
        httpStatus: 400,
        params: { start: '411500', end: '411158' },
      }) as unknown as Error,
    );
  });
});
