import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from './exceptions/app.exception';

/**
 * The one place that turns two odometer readings into a distance (TASK-3.6).
 *
 * An odometer only counts up. When the end reading is below the start one,
 * somebody typed a digit wrong — and the subtraction produces a negative
 * distance that quietly poisons everything built on it: the fuel norm
 * (litres per 100 km), cost per kilometre, and the per-trip profit report.
 * Nobody notices, because a report never shows the reading that produced it.
 *
 * Both the logist path (trips.service) and the driver path (events.service)
 * come through here, so the two cannot disagree about what a valid reading is.
 */

/** The largest reading a truck odometer plausibly shows (9 999 999 km). */
export const MAX_ODOMETER_KM = 9_999_999;

export function isOdometerOrderValid(
  start: number | null | undefined,
  end: number | null | undefined,
): boolean {
  // An unknown reading is not a wrong one: a trip may legitimately finish
  // without anybody writing the number down.
  if (start == null || end == null) return true;
  return end >= start;
}

/**
 * Distance between two readings, or undefined when it cannot be computed.
 *
 * Callers are expected to have rejected an out-of-order pair first; this
 * returns undefined rather than a negative number so a caller that forgets
 * still cannot write one.
 */
export function odometerDistanceKm(
  start: number | null | undefined,
  end: number | null | undefined,
): Prisma.Decimal | undefined {
  if (start == null || end == null || end < start) return undefined;
  return new Prisma.Decimal(end - start);
}

/** Throws ODOMETER_INVALID (400) when the end reading is below the start one. */
export function assertOdometerOrder(
  start: number | null | undefined,
  end: number | null | undefined,
): void {
  if (isOdometerOrderValid(start, end)) return;
  throw new AppException('ODOMETER_INVALID', HttpStatus.BAD_REQUEST, {
    start: String(start),
    end: String(end),
  });
}
