import {
  checkAmount,
  checkConfidence,
  checkDate,
  checkLocation,
  duplicateCheck,
  tripWindow,
} from './ocr.checks';

const NOW = new Date('2026-08-16T12:00:00Z');

describe('checkAmount', () => {
  // 300.00 l at 12 000.00 so'm = 3 600 000 so'm, all in tiyin/centilitres.
  const LITRES_CL = 30_000n;
  const PRICE = 1_200_000n;
  const EXPECTED = 360_000_000n;

  it('passes when the receipt adds up', () => {
    expect(checkAmount(LITRES_CL, PRICE, EXPECTED)).toBeNull();
  });

  it('tolerates the ±1% the till rounds by', () => {
    expect(checkAmount(LITRES_CL, PRICE, EXPECTED + 3_600_000n)).toBeNull();
    expect(checkAmount(LITRES_CL, PRICE, EXPECTED - 3_600_000n)).toBeNull();
  });

  it('flags a sum that is more than 1% off', () => {
    const check = checkAmount(LITRES_CL, PRICE, EXPECTED + 4_000_000n);
    expect(check?.code).toBe('AMOUNT_MISMATCH');
    expect(check?.severity).toBe('WARNING');
    expect(check?.params.expected).toBe('360000000');
  });

  it('says nothing when a field is missing — it cannot be checked', () => {
    expect(checkAmount(null, PRICE, EXPECTED)).toBeNull();
    expect(checkAmount(LITRES_CL, null, EXPECTED)).toBeNull();
    expect(checkAmount(LITRES_CL, PRICE, null)).toBeNull();
    expect(checkAmount(0n, PRICE, EXPECTED)).toBeNull();
  });

  it('stays exact on values a float would round', () => {
    // 33.33 l at 12 345.67 so'm = 411 481.1811 so'm; the till printed 411 481.18.
    expect(checkAmount(3333n, 1_234_567n, 41_148_118n)).toBeNull();
  });

  it('checks nothing when the numbers are too small to have a 1% band', () => {
    expect(checkAmount(7n, 1n, 1n)).toBeNull();
  });
});

describe('tripWindow / checkDate', () => {
  const TRIP = {
    startedAt: new Date('2026-08-10T06:00:00Z'),
    finishedAt: new Date('2026-08-14T18:00:00Z'),
    loadingDate: null,
    unloadingDate: null,
  };

  it('accepts a receipt from inside the trip', () => {
    expect(checkDate(new Date('2026-08-12T09:00:00Z'), TRIP, NOW)).toBeNull();
  });

  it('allows a day of grace on both ends', () => {
    expect(checkDate(new Date('2026-08-09T08:00:00Z'), TRIP, NOW)).toBeNull();
    expect(checkDate(new Date('2026-08-15T17:00:00Z'), TRIP, NOW)).toBeNull();
  });

  it('flags a receipt from well outside the trip', () => {
    const check = checkDate(new Date('2026-07-01T09:00:00Z'), TRIP, NOW);
    expect(check?.code).toBe('DATE_OUT_OF_TRIP');
  });

  it('falls back to the planned dates and to "now" for a running trip', () => {
    const running = {
      startedAt: null,
      finishedAt: null,
      loadingDate: new Date('2026-08-10T06:00:00Z'),
      unloadingDate: null,
    };
    expect(tripWindow(running, NOW)?.to.getTime()).toBe(NOW.getTime() + 24 * 3_600_000);
    expect(checkDate(new Date('2026-08-16T09:00:00Z'), running, NOW)).toBeNull();
  });

  it('checks nothing without a trip or without a date', () => {
    expect(checkDate(new Date(), null, NOW)).toBeNull();
    expect(checkDate(null, TRIP, NOW)).toBeNull();
    const undated = { startedAt: null, finishedAt: null, loadingDate: null, unloadingDate: null };
    expect(checkDate(new Date(), undated, NOW)).toBeNull();
  });
});

describe('checkLocation', () => {
  const TASHKENT = { lat: 41.3111, lng: 69.2797 };
  const RECEIPT_TIME = new Date('2026-08-12T10:00:00Z');
  const track = (lat: number, lng: number, minutesOff: number) => [
    { lat, lng, recordedAt: new Date(RECEIPT_TIME.getTime() + minutesOff * 60_000) },
  ];

  it('passes when the vehicle was where the photo was taken', () => {
    expect(checkLocation(TASHKENT, RECEIPT_TIME, track(41.32, 69.28, 10), 20)).toBeNull();
  });

  it('flags a photo taken far from the vehicle', () => {
    // Samarkand is ~270 km from Tashkent.
    const check = checkLocation(TASHKENT, RECEIPT_TIME, track(39.627, 66.975, 5), 20);
    expect(check?.code).toBe('LOCATION_MISMATCH');
    expect(check?.severity).toBe('ERROR');
  });

  it('reports "unverified" rather than a mismatch when no fix is near in time', () => {
    const check = checkLocation(TASHKENT, RECEIPT_TIME, track(41.32, 69.28, 240), 20);
    expect(check?.code).toBe('LOCATION_UNVERIFIED');
    expect(checkLocation(TASHKENT, RECEIPT_TIME, [], 20)?.code).toBe('LOCATION_UNVERIFIED');
  });

  it('picks the fix closest in time, not the first one', () => {
    const points = [
      ...track(39.627, 66.975, 100), // far away, long before
      ...track(41.32, 69.28, 2), // right next to the station, at the time
    ];
    expect(checkLocation(TASHKENT, RECEIPT_TIME, points, 20)).toBeNull();
  });

  it('checks nothing when the phone reported no position', () => {
    expect(checkLocation(null, RECEIPT_TIME, track(39.6, 66.9, 0), 20)).toBeNull();
    expect(checkLocation(TASHKENT, null, track(39.6, 66.9, 0), 20)).toBeNull();
  });
});

describe('checkConfidence', () => {
  it('flags a reading below 0.7 (TZ §8.2)', () => {
    expect(checkConfidence(6999)?.code).toBe('LOW_CONFIDENCE');
    expect(checkConfidence(7000)).toBeNull();
    expect(checkConfidence(null)).toBeNull();
  });
});

describe('duplicateCheck', () => {
  it('points at the earlier reading of the same photo', () => {
    expect(duplicateCheck('req-old')).toEqual({
      code: 'DUPLICATE_RECEIPT',
      severity: 'ERROR',
      params: { requestId: 'req-old' },
    });
  });
});
