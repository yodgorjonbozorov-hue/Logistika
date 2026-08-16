import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * Validators for model output.
 *
 * CLAUDE.md: "AI'dan kelgan JSON ham xuddi tashqi kirish kabi validatsiya
 * qilinadi." A forced tool call makes the shape *likely*, not guaranteed — so
 * every field a service reads goes through one of these, and anything unexpected
 * becomes AI_INVALID_RESPONSE instead of leaking into a business record.
 */
function invalid(field: string): never {
  throw new AppException('AI_INVALID_RESPONSE', HttpStatus.BAD_GATEWAY, undefined, { field });
}

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('root');
  return value as Record<string, unknown>;
}

/** Model "no value" answers arrive as null, "" or the literal "null". */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '' || value === 'null';
}

export function optionalString(
  source: Record<string, unknown>,
  field: string,
  maxLength = 500,
): string | null {
  const value = source[field];
  if (isBlank(value)) return null;
  if (typeof value !== 'string') invalid(field);
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : null;
}

export function requiredString(
  source: Record<string, unknown>,
  field: string,
  maxLength = 500,
): string {
  return optionalString(source, field, maxLength) ?? invalid(field);
}

/**
 * A finite, non-negative number. Models sometimes answer with a numeric string
 * ("300") or a spaced one ("4 200 000") — both are accepted, anything else is not.
 */
export function optionalNumber(
  source: Record<string, unknown>,
  field: string,
  max = Number.MAX_SAFE_INTEGER,
): number | null {
  const value = source[field];
  if (isBlank(value)) return null;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/\s/g, ''))
        : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) invalid(field);
  return parsed;
}

export function optionalEnum<T extends string>(
  source: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T | null {
  const value = optionalString(source, field, 64);
  if (value === null) return null;
  const match = allowed.find((option) => option.toLowerCase() === value.toLowerCase());
  return match ?? invalid(field);
}

export function requiredEnum<T extends string>(
  source: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  return optionalEnum(source, field, allowed) ?? invalid(field);
}

/**
 * Confidence 0.0–1.0 as basis points (10000 = 1.0). Kept as an integer so the
 * `< 0.7` rule of TZ §8.2 is an exact comparison, never a float one.
 */
export function confidenceBp(source: Record<string, unknown>, field = 'confidence'): number | null {
  const value = optionalNumber(source, field, 1);
  return value === null ? null : Math.round(value * 10_000);
}

/** An ISO date the model read off a document; time-of-day is optional. */
export function optionalDate(source: Record<string, unknown>, field: string): Date | null {
  const value = optionalString(source, field, 40);
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) invalid(field);
  return parsed;
}
