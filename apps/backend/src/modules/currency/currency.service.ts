import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Currency } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';

export interface Converted {
  /** UZS tiyin. */
  amountBase: bigint;
  /** The rate actually used, kept on the row so a report stays reproducible. */
  rateUsed: Prisma.Decimal | null;
  rateDate: Date | null;
}

/** The base currency needs no rate and never fails to convert. */
const BASE: Currency = 'UZS';

/**
 * Converts money to UZS tiyin at a dated rate.
 *
 * Every currency in the enum uses 100 minor units, so converting minor units is
 * a plain multiply — tiyin = amount_minor × rateToUzs — with no division that
 * could lose a unit.
 *
 * There is deliberately no "approximate" path: a report built on a guessed rate
 * is worse than a report that refuses to be built, because nobody can tell
 * afterwards which numbers were guessed.
 */
@Injectable()
export class CurrencyService {
  constructor(private readonly prisma: PrismaService) {}

  async toBase(amount: bigint, currency: Currency, on: Date = new Date()): Promise<Converted> {
    if (currency === BASE) {
      // No conversion happened; rateUsed stays null rather than a fake 1.
      return { amountBase: amount, rateUsed: null, rateDate: null };
    }

    const rate = await this.rateFor(currency, on);
    return {
      amountBase: multiplyToTiyin(amount, rate.rateToUzs),
      rateUsed: rate.rateToUzs,
      rateDate: rate.date,
    };
  }

  /**
   * The rate for that day, or the most recent one before it — a rate published
   * on Friday still applies over the weekend. A currency with no rate at all
   * fails loudly.
   */
  private async rateFor(currency: Currency, on: Date) {
    const rate = await this.prisma.exchangeRate.findFirst({
      where: { currency, date: { lte: endOfDay(on) } },
      orderBy: { date: 'desc' },
    });
    if (!rate) {
      throw new AppException('EXCHANGE_RATE_MISSING', HttpStatus.UNPROCESSABLE_ENTITY, undefined, {
        currency,
        date: on.toISOString().slice(0, 10),
      });
    }
    return rate;
  }

  /** SUPERADMIN entry point; a CBU.uz importer will call the same method. */
  async upsertRate(
    currency: Currency,
    date: Date,
    rateToUzs: string,
    source = 'manual',
  ): Promise<{ currency: Currency; date: Date; rateToUzs: Prisma.Decimal }> {
    const value = new Prisma.Decimal(rateToUzs);
    if (value.lessThanOrEqualTo(0)) {
      throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
        'rateToUzs must be greater than zero',
      ]);
    }
    const day = startOfDay(date);
    return this.prisma.exchangeRate.upsert({
      where: { currency_date: { currency, date: day } },
      update: { rateToUzs: value, source },
      create: { currency, date: day, rateToUzs: value, source },
    });
  }

  listRates(currency?: Currency, limit = 90) {
    return this.prisma.exchangeRate.findMany({
      where: { currency },
      orderBy: [{ date: 'desc' }, { currency: 'asc' }],
      take: limit,
    });
  }
}

/**
 * amount_minor × rate, rounded half-up to a whole tiyin.
 *
 * Decimal all the way through: doing this in JS numbers is how money picks up
 * a rounding error that nobody can explain three months later.
 */
export function multiplyToTiyin(amount: bigint, rate: Prisma.Decimal): bigint {
  const product = new Prisma.Decimal(amount.toString()).times(rate);
  return BigInt(product.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));
}

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

function endOfDay(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(23, 59, 59, 999);
  return day;
}
