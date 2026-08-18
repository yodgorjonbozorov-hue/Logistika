/**
 * The six-step rail on the trip detail screen, derived from the trip's status
 * and its own timestamps. Pure so the ordering rules stay testable.
 */
import { TripStatus } from 'shared';
import type { Trip } from '../../shared/api/entities';

export type LifecycleState = 'done' | 'current' | 'pending';

export interface LifecycleStep {
  key: 'created' | 'assigned' | 'departed' | 'enRoute' | 'arrived' | 'finished';
  state: LifecycleState;
  at: string | null;
}

/** How far along each status is — the index of the step it is *currently* at. */
const REACHED: Record<TripStatus, number> = {
  [TripStatus.DRAFT]: 0,
  [TripStatus.ASSIGNED]: 1,
  [TripStatus.IN_PROGRESS]: 3,
  [TripStatus.COMPLETED]: 5,
  [TripStatus.CANCELLED]: 0,
};

export function tripLifecycle(trip: Trip): LifecycleStep[] {
  const reached = REACHED[trip.status];
  const assignedAt = trip.vehicleId && trip.driverId ? trip.createdAt : null;

  const stamps: Array<[LifecycleStep['key'], string | null]> = [
    ['created', trip.createdAt],
    ['assigned', assignedAt],
    ['departed', trip.startedAt],
    ['enRoute', trip.startedAt],
    ['arrived', trip.finishedAt],
    ['finished', trip.finishedAt],
  ];

  return stamps.map(([key, at], index) => ({
    key,
    at: index <= reached ? at : null,
    state: index < reached ? 'done' : index === reached ? 'current' : 'pending',
  }));
}
