import type { TenantScopedClient } from '../../prisma/prisma.service';
import { formatTripNumber, nextTripNumber } from './trip-numbering';

describe('formatTripNumber', () => {
  it('pads the sequence so numbers sort as text', () => {
    // "10" sorting before "9" is how a trip list ends up in an order nobody
    // can explain.
    expect(formatTripNumber(2026, 9)).toBe('TR-2026-0009');
    expect(formatTripNumber(2026, 10)).toBe('TR-2026-0010');
    expect([formatTripNumber(2026, 10), formatTripNumber(2026, 9)].sort()).toEqual([
      'TR-2026-0009',
      'TR-2026-0010',
    ]);
  });

  it('keeps going past the padding rather than truncating', () => {
    expect(formatTripNumber(2026, 12_345)).toBe('TR-2026-12345');
  });

  it('carries the year, so January starts again at one', () => {
    expect(formatTripNumber(2027, 1)).toBe('TR-2027-0001');
  });
});

describe('nextTripNumber', () => {
  function setup(lastNumber: number) {
    const upsert = jest.fn().mockResolvedValue({ lastNumber });
    const tx = { tripCounter: { upsert } } as unknown as TenantScopedClient;
    return { tx, upsert };
  }

  it('increments the counter rather than counting the trips', async () => {
    const { tx, upsert } = setup(43);

    const number = await nextTripNumber(tx, 'company-a', new Date('2026-08-18T00:00:00Z'));

    expect(number).toBe('TR-2026-0043');
    // count() + 1 repeats a number as soon as a trip is removed; an increment
    // cannot hand out the same value twice.
    expect(upsert).toHaveBeenCalledWith({
      where: { companyId_year: { companyId: 'company-a', year: 2026 } },
      update: { lastNumber: { increment: 1 } },
      create: { companyId: 'company-a', year: 2026, lastNumber: 1 },
    });
  });

  it('starts a company that has never had a trip at one', async () => {
    const { tx, upsert } = setup(1);

    const number = await nextTripNumber(tx, 'company-b', new Date('2026-01-01T00:00:00Z'));

    expect(number).toBe('TR-2026-0001');
    expect((upsert.mock.calls[0][0] as { create: { lastNumber: number } }).create.lastNumber).toBe(
      1,
    );
  });

  it('takes the year in UTC, not from the server timezone', async () => {
    const { tx, upsert } = setup(1);

    // 1 January 2027, 00:30 UTC — still 31 December in a UTC−5 timezone. The
    // stored year has to match the stored timestamps, which are all UTC.
    await nextTripNumber(tx, 'company-a', new Date('2027-01-01T00:30:00Z'));

    const where = upsert.mock.calls[0][0] as { where: { companyId_year: { year: number } } };
    expect(where.where.companyId_year.year).toBe(2027);
  });
});
