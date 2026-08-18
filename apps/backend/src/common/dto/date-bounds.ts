import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

export interface DateWindow {
  /** How far ahead of now the date may be. */
  maxAheadMs: number;
  /** How far behind now the date may be. Omit for no lower bound. */
  maxBehindMs?: number;
}

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Keeps a client-supplied date inside a believable window.
 *
 * Dates arrive from a phone whose clock the server does not control. A wrong
 * clock is not rare — it is the normal state of a device that has been off for
 * a week — and an event stamped 1970 or 2049 does not look like an error
 * anywhere downstream: it silently reorders the trip's history, lands in the
 * wrong reporting month, and drags every chart's axis with it.
 *
 * The bounds are deliberately generous. They are there to catch a clock that is
 * obviously wrong, not to second-guess a driver who is filing yesterday's
 * receipt today.
 */
export function IsWithinDateWindow(window: DateWindow, options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isWithinDateWindow',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null) return true;
          const time = new Date(value as string).getTime();
          if (Number.isNaN(time)) return false;

          const now = Date.now();
          if (time > now + window.maxAheadMs) return false;
          return window.maxBehindMs === undefined || time >= now - window.maxBehindMs;
        },
        defaultMessage(args: ValidationArguments) {
          const ahead = Math.round(window.maxAheadMs / MINUTE_MS);
          const behind =
            window.maxBehindMs === undefined
              ? 'any time in the past'
              : `at most ${Math.round(window.maxBehindMs / DAY_MS)} days in the past`;
          return `${args.property} must be no more than ${ahead} minutes in the future and ${behind}`;
        },
      },
    });
  };
}

/**
 * A date a person typed. Tomorrow is allowed because the office and the driver
 * may be on different sides of midnight; next year is not.
 */
export const RECORDED_DATE_WINDOW: DateWindow = { maxAheadMs: DAY_MS };

/**
 * A moment a device stamped. Five minutes of clock drift is ordinary; a month
 * is the outer edge of what an offline queue can plausibly still be holding.
 */
export const DEVICE_EVENT_WINDOW: DateWindow = {
  maxAheadMs: 5 * MINUTE_MS,
  maxBehindMs: 30 * DAY_MS,
};
