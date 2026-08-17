import { HttpStatus } from '@nestjs/common';
import type { TripStatus } from '@prisma/client';
import { AppException } from './exceptions/app.exception';

/**
 * Allowed lifecycle transitions (TZ §5 trips.status).
 *
 * Shared on purpose: the logist moves a trip through the REST API and the
 * driver moves the same trip through the event batch, and both paths have to
 * agree on what is legal.
 */
export const TRIP_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  DRAFT: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'DRAFT', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return TRIP_TRANSITIONS[from].includes(to);
}

export function assertTripTransition(from: TripStatus, to: TripStatus, allowNoop = false): void {
  if (allowNoop && from === to) return;
  if (!canTransition(from, to)) {
    throw new AppException('TRIP_INVALID_STATUS', HttpStatus.CONFLICT, undefined, { from, to });
  }
}
