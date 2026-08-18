import { describe, expect, it } from 'vitest';
import { TripStatus } from 'shared';
import type { Trip } from '../../shared/api/entities';
import { tripLifecycle } from './lifecycle';

function trip(overrides: Partial<Trip>): Trip {
  return {
    id: 'trip-1',
    tripNumber: 'TR-2026-0042',
    clientId: null,
    vehicleId: null,
    trailerId: null,
    driverId: null,
    cargoName: null,
    cargoWeight: null,
    cargoVolume: null,
    loadingAddress: null,
    loadingDate: null,
    unloadingAddress: null,
    unloadingDate: null,
    plannedDistanceKm: null,
    actualDistanceKm: null,
    agreedPrice: '0',
    currency: 'UZS' as Trip['currency'],
    driverAdvance: '0',
    status: TripStatus.DRAFT,
    startOdometer: null,
    endOdometer: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-08-16T18:22:00.000Z',
    ...overrides,
  };
}

describe('tripLifecycle', () => {
  it('always returns the six rail steps in order', () => {
    expect(tripLifecycle(trip({})).map((step) => step.key)).toEqual([
      'created',
      'assigned',
      'departed',
      'enRoute',
      'arrived',
      'finished',
    ]);
  });

  it('marks a draft as current at creation, everything after pending', () => {
    const steps = tripLifecycle(trip({ status: TripStatus.DRAFT }));
    expect(steps[0]?.state).toBe('current');
    expect(steps.slice(1).every((step) => step.state === 'pending')).toBe(true);
  });

  it('advances an assigned trip to the second step', () => {
    const steps = tripLifecycle(
      trip({ status: TripStatus.ASSIGNED, vehicleId: 'v1', driverId: 'd1' }),
    );
    expect(steps[0]?.state).toBe('done');
    expect(steps[1]?.state).toBe('current');
    expect(steps[2]?.state).toBe('pending');
  });

  it('puts an in-progress trip on the en-route step with its departure stamped', () => {
    const startedAt = '2026-08-17T06:40:00.000Z';
    const steps = tripLifecycle(trip({ status: TripStatus.IN_PROGRESS, startedAt }));
    expect(steps[2]?.state).toBe('done');
    expect(steps[2]?.at).toBe(startedAt);
    expect(steps[3]?.state).toBe('current');
    expect(steps[4]?.state).toBe('pending');
  });

  it('completes the whole rail once the trip is finished', () => {
    const steps = tripLifecycle(
      trip({
        status: TripStatus.COMPLETED,
        startedAt: '2026-08-17T06:40:00.000Z',
        finishedAt: '2026-08-18T14:00:00.000Z',
      }),
    );
    expect(steps.slice(0, 5).every((step) => step.state === 'done')).toBe(true);
    expect(steps[5]?.state).toBe('current');
    expect(steps[5]?.at).toBe('2026-08-18T14:00:00.000Z');
  });

  it('hides future timestamps so a pending step never shows a date', () => {
    const steps = tripLifecycle(
      trip({ status: TripStatus.DRAFT, finishedAt: '2026-08-18T14:00:00.000Z' }),
    );
    expect(steps[5]?.at).toBeNull();
  });

  it('keeps a cancelled trip at its first step', () => {
    const steps = tripLifecycle(trip({ status: TripStatus.CANCELLED }));
    expect(steps[0]?.state).toBe('current');
    expect(steps[1]?.state).toBe('pending');
  });
});
