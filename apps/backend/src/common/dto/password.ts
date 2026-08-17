import { applyDecorators } from '@nestjs/common';
import {
  MaxLength,
  MinLength,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

export const PASSWORD_MIN_LENGTH = 10;
/** argon2 handles long inputs, but an unbounded password is a free CPU sink. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * A short list of the passwords attackers try first. It is deliberately small
 * and inline: a full top-100k list belongs in a service, but "parol123" being
 * accepted for an OWNER account is the failure that actually happens here.
 * Comparison is case-insensitive and ignores trailing digits, so "Admin123"
 * and "admin" collapse to the same entry.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'passw0rd',
  'parol',
  'qwerty',
  'qwertyui',
  'asdfgh',
  'zxcvbn',
  'iloveyou',
  'welcome',
  'admin',
  'administrator',
  'superadmin',
  'root',
  'letmein',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'master',
  'shadow',
  'michael',
  'jennifer',
  'trustno',
  'freedom',
  'whatever',
  'starwars',
  'computer',
  'internet',
  'samsung',
  'google',
  'facebook',
  'telegram',
  'toshkent',
  'tashkent',
  'uzbekistan',
  'ozbekiston',
  'truckcontrol',
  'logistika',
  'haydovchi',
  'boshliq',
  'firma',
  'kamaz',
  'scania',
  'volvo',
  'mercedes',
  'secret',
  'test',
  'demo',
  'changeme',
  'qwerty123',
  'abc',
  'abcd',
]);

function normalise(value: string): string {
  return value.toLowerCase().replace(/[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]+$/, '');
}

/** Longest run of characters the password shares with a personal detail. */
function containsPersonalDetail(password: string, details: string[]): boolean {
  const lower = password.toLowerCase();
  return details.some((detail) => {
    const cleaned = detail.toLowerCase().split(/[@\s.]+/).filter((part) => part.length >= 4);
    return cleaned.some((part) => lower.includes(part));
  });
}

export interface StrongPasswordContext {
  /** Other fields whose value must not appear inside the password. */
  personalFields?: string[];
}

/**
 * Password policy (TASK-2.5): long enough, mixed, not a well-known password and
 * not simply the person's own name or email.
 */
export function IsStrongPassword(
  context: StrongPasswordContext = {},
  options?: ValidationOptions,
): PropertyDecorator {
  const personalFields = context.personalFields ?? ['fullName', 'email', 'phone'];

  return applyDecorators(
    MinLength(PASSWORD_MIN_LENGTH),
    MaxLength(PASSWORD_MAX_LENGTH),
    (target: object, propertyName: string | symbol) => {
      registerDecorator({
        name: 'isStrongPassword',
        target: target.constructor,
        propertyName: propertyName as string,
        options,
        validator: {
          validate(value: unknown, args: ValidationArguments) {
            if (typeof value !== 'string') return false;
            if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) return false;
            if (COMMON_PASSWORDS.has(normalise(value))) return false;

            const object = args.object as Record<string, unknown>;
            const details = personalFields
              .map((field) => object[field])
              .filter((detail): detail is string => typeof detail === 'string');
            return !containsPersonalDetail(value, details);
          },
          defaultMessage() {
            return (
              `password must be at least ${PASSWORD_MIN_LENGTH} characters, contain a letter ` +
              'and a digit, not be a commonly used password, and not contain your name or email'
            );
          },
        },
      });
    },
  );
}
