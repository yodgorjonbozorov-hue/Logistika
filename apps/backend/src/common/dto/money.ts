import { applyDecorators } from '@nestjs/common';
import { Matches } from 'class-validator';

/**
 * Money travels through the API as a decimal string of TIYIN (1 so'm = 100 tiyin)
 * and is stored as BigInt — floats are forbidden (CLAUDE.md).
 */
export const IsTiyin = () =>
  applyDecorators(Matches(/^\d{1,18}$/, { message: 'must be a tiyin amount (digits only)' }));

/**
 * A tiyin amount that must actually be an amount (TASK-5.3).
 *
 * `IsTiyin` accepted `0`, so a zero-so'm expense or a zero-so'm invoice was a
 * valid request — a row that means nothing, costs nothing and quietly widens
 * every average. The ledger already refuses non-positive entries; this makes
 * the DTO agree with it, and lets the web form say so at the field instead of
 * being stricter than the API it talks to.
 */
export const IsPositiveTiyin = () =>
  applyDecorators(
    Matches(/^\d{1,18}$/, { message: 'must be a tiyin amount (digits only)' }),
    Matches(/[1-9]/, { message: 'must be greater than zero' }),
  );

export const toBigInt = (value: string): bigint => BigInt(value);
