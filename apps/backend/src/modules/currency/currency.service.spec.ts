import { Prisma } from '@prisma/client';
import { CurrencyService, multiplyToTiyin } from './currency.service';
import type { PrismaService } from '../../prisma/prisma.service';

const decimal = (value: string) => new Prisma.Decimal(value);

describe('multiplyToTiyin', () => {
  it('converts minor units with a plain multiply', () => {
    // 100.00 USD in cents, at 12 500 UZS per USD → 1 250 000.00 UZS in tiyin.
    expect(multiplyToTiyin(10_000n, decimal('12500'))).toBe(125_000_000n);
  });

  it('rounds half away from zero, never truncating money away', () => {
    expect(multiplyToTiyin(1n, decimal('1.5'))).toBe(2n);
    expect(multiplyToTiyin(1n, decimal('1.4'))).toBe(1n);
    expect(multiplyToTiyin(3n, decimal('0.5'))).toBe(2n);
  });

  it('keeps precision far beyond a float', () => {
    // 9 007 199 254 740 993 is the first integer a double cannot represent.
    expect(multiplyToTiyin(9_007_199_254_740_993n, decimal('1'))).toBe(9_007_199_254_740_993n);
    expect(multiplyToTiyin(9_007_199_254_740_993n, decimal('2'))).toBe(18_014_398_509_481_986n);
  });

  it('handles a fractional rate without drifting', () => {
    // 1 RUB = 138.456789 UZS; 12 345 kopeck.
    expect(multiplyToTiyin(12_345n, decimal('138.456789'))).toBe(1_709_249n);
  });

  it('converts zero to zero', () => {
    expect(multiplyToTiyin(0n, decimal('12500'))).toBe(0n);
  });
});

describe('CurrencyService.toBase', () => {
  function setup(rate: { rateToUzs: Prisma.Decimal; date: Date } | null) {
    const findFirst = jest.fn().mockResolvedValue(rate);
    const prisma = { exchangeRate: { findFirst } } as unknown as PrismaService;
    return { service: new CurrencyService(prisma), findFirst };
  }

  it('passes UZS through without looking up any rate', async () => {
    const { service, findFirst } = setup(null);

    const result = await service.toBase(419_780_000n, 'UZS');

    expect(result.amountBase).toBe(419_780_000n);
    // A rate of 1 would be a lie: no conversion happened at all.
    expect(result.rateUsed).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('converts a foreign currency and records the rate it used', async () => {
    const date = new Date('2026-08-17T00:00:00Z');
    const { service } = setup({ rateToUzs: decimal('12500.500000'), date });

    const result = await service.toBase(10_000n, 'USD', date);

    expect(result.amountBase).toBe(125_005_000n);
    expect(String(result.rateUsed)).toBe('12500.5');
    expect(result.rateDate).toEqual(date);
  });

  it('refuses to invent a rate when none exists', async () => {
    const { service } = setup(null);

    // A report built on a guessed rate is worse than one that refuses to be
    // built: afterwards nobody can tell which numbers were guessed.
    await expect(service.toBase(10_000n, 'USD')).rejects.toMatchObject({
      code: 'EXCHANGE_RATE_MISSING',
      httpStatus: 422,
    });
  });

  it('uses the most recent rate on or before the date (weekends have no rate)', async () => {
    const friday = new Date('2026-08-14T00:00:00Z');
    const { service, findFirst } = setup({ rateToUzs: decimal('12500'), date: friday });

    await service.toBase(100n, 'USD', new Date('2026-08-16T12:00:00Z'));

    const where = findFirst.mock.calls[0][0].where as { date: { lte: Date } };
    expect(where.date.lte.toISOString()).toContain('2026-08-16T23:59:59');
    expect(findFirst.mock.calls[0][0].orderBy).toEqual({ date: 'desc' });
  });
});

describe('CurrencyService.upsertRate', () => {
  function setup() {
    const upsert = jest.fn().mockImplementation(({ create }: { create: unknown }) =>
      Promise.resolve(create),
    );
    const prisma = { exchangeRate: { upsert } } as unknown as PrismaService;
    return { service: new CurrencyService(prisma), upsert };
  }

  it('stores the rate against the start of the day, in UTC', async () => {
    const { service, upsert } = setup();

    await service.upsertRate('USD', new Date('2026-08-17T15:42:11Z'), '12500.25');

    const day = (upsert.mock.calls[0][0].create as { date: Date }).date;
    expect(day.toISOString()).toBe('2026-08-17T00:00:00.000Z');
    expect(String((upsert.mock.calls[0][0].create as { rateToUzs: Prisma.Decimal }).rateToUzs)).toBe(
      '12500.25',
    );
  });

  it('refuses a zero or negative rate', async () => {
    const { service } = setup();
    for (const rate of ['0', '-1']) {
      await expect(service.upsertRate('USD', new Date(), rate)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
  });

  it('records where the rate came from', async () => {
    const { service, upsert } = setup();
    await service.upsertRate('RUB', new Date(), '138.5', 'cbu.uz');
    expect((upsert.mock.calls[0][0].create as { source: string }).source).toBe('cbu.uz');
  });
});
