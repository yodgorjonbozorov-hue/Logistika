import { zoneOffsetMs, zonedDayRange, zonedDaysAgo, zonedMonthKey } from './time';

describe('time helpers', () => {
  const TASHKENT = 'Asia/Tashkent'; // UTC+5, no DST

  it('resolves the zone offset', () => {
    expect(zoneOffsetMs(new Date('2026-08-18T09:00:00Z'), TASHKENT)).toBe(5 * 3600 * 1000);
    expect(zoneOffsetMs(new Date('2026-08-18T09:00:00Z'), 'UTC')).toBe(0);
  });

  it('maps a local day onto its UTC window', () => {
    // 02:00 Tashkent on the 18th is 21:00 UTC on the 17th — still "today" locally.
    const { from, to } = zonedDayRange(new Date('2026-08-17T21:00:00Z'), TASHKENT);
    expect(from.toISOString()).toBe('2026-08-17T19:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-18T19:00:00.000Z');
  });

  it('handles a DST zone without drifting the day boundary', () => {
    const { from, to } = zonedDayRange(new Date('2026-07-15T12:00:00Z'), 'Europe/Berlin');
    expect(from.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(to.getTime() - from.getTime()).toBe(24 * 3600 * 1000);
  });

  it('walks back whole local days', () => {
    const from = zonedDaysAgo(new Date('2026-08-17T21:00:00Z'), TASHKENT, 7);
    expect(from.toISOString()).toBe('2026-08-10T19:00:00.000Z');
  });

  it('buckets instants by local month', () => {
    // 03:00 Tashkent on 1 September is still August in UTC.
    expect(zonedMonthKey(new Date('2026-08-31T22:00:00Z'), TASHKENT)).toBe('2026-09');
    expect(zonedMonthKey(new Date('2026-08-31T22:00:00Z'), 'UTC')).toBe('2026-08');
  });
});
