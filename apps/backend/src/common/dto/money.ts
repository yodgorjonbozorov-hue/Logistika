import { applyDecorators } from '@nestjs/common';
import { Matches } from 'class-validator';

/**
 * Money travels through the API as a decimal string of TIYIN (1 so'm = 100 tiyin)
 * and is stored as BigInt — floats are forbidden (CLAUDE.md).
 *
 * 18 digits is the widest value that always fits PostgreSQL's signed int8
 * (max 9_223_372_036_854_775_807), so the regex is also the overflow guard.
 */
export const IsTiyin = () =>
  applyDecorators(Matches(/^\d{1,18}$/, { message: 'must be a tiyin amount (digits only)' }));

/**
 * Same, but rejects zero. A 0 so'm expense or income is never a real business
 * fact — it is a bug or a probe, and it silently pollutes the P&L.
 */
export const IsPositiveTiyin = () =>
  applyDecorators(
    Matches(/^(?!0+$)\d{1,18}$/, { message: 'must be a positive tiyin amount (digits only)' }),
  );

export const toBigInt = (value: string): bigint => BigInt(value);
