import i18n from '../i18n';

/**
 * Client-side checks that mirror the backend DTOs (TASK-5.3).
 *
 * Not a second source of truth: the server still decides, and its refusal is
 * still shown. These exist so an obviously wrong form says so before a round
 * trip — an amount of zero or a date two years out is worth catching where the
 * user is still looking at the field, rather than after a spinner.
 *
 * Each rule names the DTO rule it mirrors, so a change on one side is easy to
 * find on the other.
 */
export type Errors = Record<string, string>;

const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(key, params ?? {}) as string;

/** Mirrors `@IsTiyin()` — digits only — plus "money must be more than nothing". */
export function checkAmount(digits: string, { required = true } = {}): string | undefined {
  if (digits === '') return required ? t('validation.required') : undefined;
  if (!/^\d+$/.test(digits)) return t('validation.digitsOnly');
  if (BigInt(digits) === 0n) return t('validation.amountPositive');
  return undefined;
}

/**
 * Mirrors `RECORDED_DATE_WINDOW` (`maxAheadMs: 1 day`).
 *
 * The lower bound is the client's own: the server accepts any past date, but a
 * receipt dated ten years ago is far more likely to be a typo in the year than
 * a real filing, and saying so costs nothing.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const FAR_PAST_MS = 5 * 365 * DAY_MS;

export function checkRecordedDate(value: string, { required = true } = {}): string | undefined {
  if (!value) return required ? t('validation.required') : undefined;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return t('validation.dateInvalid');
  if (time > Date.now() + DAY_MS) return t('validation.dateFuture');
  if (time < Date.now() - FAR_PAST_MS) return t('validation.dateTooOld');
  return undefined;
}

/** Mirrors `@MaxLength(n)`. */
export function checkText(
  value: string,
  { required = false, max }: { required?: boolean; max?: number } = {},
): string | undefined {
  if (!value.trim()) return required ? t('validation.required') : undefined;
  if (max !== undefined && value.length > max) return t('validation.tooLong', { max });
  return undefined;
}

/** Drops the keys that came back clean, so `Object.keys` means "problems". */
export const problems = (errors: Record<string, string | undefined>): Errors =>
  Object.fromEntries(Object.entries(errors).filter(([, value]) => value !== undefined)) as Errors;
