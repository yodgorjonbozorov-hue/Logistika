import {
  digestHour,
  isQuietDay,
  localDayBounds,
  localHour,
  type DigestFacts,
} from './digest.facts';

const BUSY: DigestFacts = {
  date: '2026-08-16',
  vehiclesOnRoad: 7,
  vehiclesTotal: 9,
  tripsFinished: 3,
  tripsStarted: 2,
  revenueToday: 4_200_000_000n,
  expensesToday: 2_600_000_000n,
  profitToday: 1_600_000_000n,
  attention: [{ title: '01 A 456 BB', detail: "yoqilg'i normadan 12% oshdi" }],
  loadingsTomorrow: 2,
  documentsExpiringSoon: 1,
};

const QUIET: DigestFacts = {
  ...BUSY,
  vehiclesOnRoad: 0,
  tripsFinished: 0,
  tripsStarted: 0,
  attention: [],
  loadingsTomorrow: 0,
  documentsExpiringSoon: 0,
};

describe('localDayBounds', () => {
  it('gives the local calendar day as UTC instants', () => {
    // 17:34 UTC is already 22:34 of the same day in Tashkent (UTC+5).
    const day = localDayBounds(new Date('2026-08-16T17:34:00Z'), 'Asia/Tashkent');
    expect(day.date).toBe('2026-08-16');
    expect(day.from.toISOString()).toBe('2026-08-15T19:00:00.000Z');
    expect(day.to.toISOString()).toBe('2026-08-16T19:00:00.000Z');
  });

  it('rolls the date over when the local day is already the next one', () => {
    // 20:00 UTC on the 16th is 01:00 on the 17th in Tashkent.
    const day = localDayBounds(new Date('2026-08-16T20:00:00Z'), 'Asia/Tashkent');
    expect(day.date).toBe('2026-08-17');
  });

  it('handles a zone behind UTC', () => {
    const day = localDayBounds(new Date('2026-08-16T02:00:00Z'), 'America/New_York');
    expect(day.date).toBe('2026-08-15');
    expect(day.from.toISOString()).toBe('2026-08-15T04:00:00.000Z');
  });

  it('falls back to UTC for a zone it does not know', () => {
    const day = localDayBounds(new Date('2026-08-16T02:00:00Z'), 'Mars/Olympus');
    expect(day.date).toBe('2026-08-16');
    expect(day.from.toISOString()).toBe('2026-08-16T00:00:00.000Z');
  });
});

describe('localHour', () => {
  it('reads the hour in the company zone, which is what "20:00" means', () => {
    expect(localHour(new Date('2026-08-16T15:00:00Z'), 'Asia/Tashkent')).toBe(20);
    expect(localHour(new Date('2026-08-16T15:00:00Z'), 'UTC')).toBe(15);
  });
});

describe('digestHour', () => {
  it('reads the configured time and falls back to the TZ default of 20:00', () => {
    expect(digestHour('20:00')).toBe(20);
    expect(digestHour('7:30')).toBe(7);
    expect(digestHour('00:00')).toBe(0);
    expect(digestHour('kechqurun')).toBe(20);
    expect(digestHour('99:00')).toBe(20);
  });
});

describe('isQuietDay', () => {
  it('sends on a day with movement or something to look at', () => {
    expect(isQuietDay(BUSY)).toBe(false);
    expect(isQuietDay({ ...QUIET, attention: BUSY.attention })).toBe(false);
    expect(isQuietDay({ ...QUIET, tripsFinished: 1 })).toBe(false);
  });

  it('stays silent on a day where nothing happened', () => {
    expect(isQuietDay(QUIET)).toBe(true);
  });
});
