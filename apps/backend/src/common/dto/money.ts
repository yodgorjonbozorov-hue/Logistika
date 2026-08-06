import { applyDecorators } from '@nestjs/common';
import { Matches } from 'class-validator';

/**
 * Money travels through the API as a decimal string of TIYIN (1 so'm = 100 tiyin)
 * and is stored as BigInt — floats are forbidden (CLAUDE.md).
 */
export const IsTiyin = () =>
  applyDecorators(Matches(/^\d{1,18}$/, { message: 'must be a tiyin amount (digits only)' }));

export const toBigInt = (value: string): bigint => BigInt(value);
