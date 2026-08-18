/**
 * Chip tones per domain enum — the palette mapping the design's `stMeta`,
 * `truckChip` and `payChip` helpers encode. Labels stay in i18n; only the tone
 * lives here.
 */
import { PaymentStatus, TripStatus, type LiveStatus } from 'shared';
import type { ChipTone } from '../ui';

export const TRIP_STATUS_TONE: Record<TripStatus, ChipTone> = {
  [TripStatus.DRAFT]: 'neutral',
  [TripStatus.ASSIGNED]: 'accentSoft',
  [TripStatus.IN_PROGRESS]: 'accent',
  [TripStatus.COMPLETED]: 'positive',
  [TripStatus.CANCELLED]: 'muted',
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, ChipTone> = {
  [PaymentStatus.PENDING]: 'warning',
  [PaymentStatus.PARTIAL]: 'accent',
  [PaymentStatus.PAID]: 'positive',
  [PaymentStatus.OVERDUE]: 'danger',
};

export const LIVE_STATUS_TONE: Record<LiveStatus, ChipTone> = {
  MOVING: 'accent',
  RESTING: 'warning',
  BREAKDOWN: 'danger',
  IDLE: 'muted',
};

/** Vehicle and driver availability, derived rather than stored (see below). */
export type ResourceState = 'ON_TRIP' | 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE';

export const RESOURCE_STATE_TONE: Record<ResourceState, ChipTone> = {
  ON_TRIP: 'accent',
  AVAILABLE: 'positive',
  MAINTENANCE: 'warning',
  INACTIVE: 'muted',
};

/** Statuses that still need work from the fleet — a trip's "open" window. */
export const OPEN_TRIP_STATUSES: readonly TripStatus[] = [
  TripStatus.DRAFT,
  TripStatus.ASSIGNED,
  TripStatus.IN_PROGRESS,
];

/**
 * A vehicle's board state. The schema stores no status column, so it is read
 * from the trips currently riding on the vehicle plus its own active flag.
 */
export function vehicleState(options: {
  isActive: boolean;
  hasOpenTrip: boolean;
  inMaintenance?: boolean;
}): ResourceState {
  if (!options.isActive) return 'INACTIVE';
  if (options.hasOpenTrip) return 'ON_TRIP';
  if (options.inMaintenance) return 'MAINTENANCE';
  return 'AVAILABLE';
}

export function driverState(options: { isActive: boolean; hasOpenTrip: boolean }): ResourceState {
  if (!options.isActive) return 'INACTIVE';
  return options.hasOpenTrip ? 'ON_TRIP' : 'AVAILABLE';
}
