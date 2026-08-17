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
  // A trip that breaks down or is refused mid-route used to have nowhere to go
  // but COMPLETED, which put work that never happened into the revenue.
  IN_PROGRESS: ['COMPLETED', 'PARTIALLY_DELIVERED', 'RETURNED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  PARTIALLY_DELIVERED: [],
  RETURNED: [],
  FAILED: [],
  CANCELLED: [],
};

/** Outcomes that need an explanation before they are accepted. */
export const REASON_REQUIRED_STATUSES: TripStatus[] = [
  'PARTIALLY_DELIVERED',
  'RETURNED',
  'FAILED',
  'CANCELLED',
];

export function isTerminal(status: TripStatus): boolean {
  return TRIP_TRANSITIONS[status].length === 0;
}

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return TRIP_TRANSITIONS[from].includes(to);
}

export function assertTripTransition(from: TripStatus, to: TripStatus, allowNoop = false): void {
  if (allowNoop && from === to) return;
  if (!canTransition(from, to)) {
    throw new AppException('TRIP_INVALID_STATUS', HttpStatus.CONFLICT, undefined, { from, to });
  }
}
