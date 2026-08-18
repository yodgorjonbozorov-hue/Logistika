import { Transform } from 'class-transformer';
import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * One canonical form for every phone number (TASK-3.12, M-3).
 *
 * `+998901234567`, `998901234567`, `90 123 45 67` and `(90) 123-45-67` are the
 * same number and were four different accounts: the login lookup is an exact
 * string match on a unique column, so a driver who registered one way could not
 * log in the other, and a second account could be created for a person who
 * already had one.
 *
 * Uzbekistan is +998 with a nine-digit national number. A number written
 * without the country code is assumed to be Uzbek, because that is who uses
 * this product; anything already carrying a `+` is kept as it is, so a foreign
 * driver's number is not mangled into a wrong Uzbek one.
 */

const UZ_COUNTRY_CODE = '998';
const UZ_NATIONAL_DIGITS = 9;

/** E.164 (`+998901234567`), or the input unchanged when it is not a phone. */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  const explicitlyInternational = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;

  // Already international: trust the country code the caller wrote.
  if (explicitlyInternational) return `+${digits}`;

  // 998XXXXXXXXX — country code without the plus.
  if (
    digits.length === UZ_COUNTRY_CODE.length + UZ_NATIONAL_DIGITS &&
    digits.startsWith(UZ_COUNTRY_CODE)
  ) {
    return `+${digits}`;
  }
  // XXXXXXXXX — the national number on its own.
  if (digits.length === UZ_NATIONAL_DIGITS) return `+${UZ_COUNTRY_CODE}${digits}`;
  // 8XXXXXXXXX — the old trunk prefix, still typed out of habit.
  if (digits.length === UZ_NATIONAL_DIGITS + 1 && digits.startsWith('8')) {
    return `+${UZ_COUNTRY_CODE}${digits.slice(1)}`;
  }

  // Not a shape we recognise. Returned as digits so it is at least consistent;
  // the validator below is what refuses it.
  return `+${digits}`;
}

/** Normalises the value on the way in, so the DTO never carries a raw form. */
export function NormalizePhone() {
  return Transform(({ value }) => (typeof value === 'string' ? normalizePhone(value) : value));
}

/** E.164: a plus and 8–15 digits, which is the whole of the standard's range. */
export function IsPhone(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPhone',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && /^\+\d{8,15}$/.test(value),
        defaultMessage: () => 'phone must be a valid number, e.g. +998901234567',
      },
    });
  };
}
