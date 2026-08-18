import { describe, expect, it } from 'vitest';
import { PaymentStatus, TripStatus } from 'shared';
import {
  OPEN_TRIP_STATUSES,
  PAYMENT_STATUS_TONE,
  RESOURCE_STATE_TONE,
  TRIP_STATUS_TONE,
  driverState,
  vehicleState,
} from './status';

describe('chip tone maps', () => {
  it('covers every trip status', () => {
    for (const status of Object.values(TripStatus)) {
      expect(TRIP_STATUS_TONE[status]).toBeTruthy();
    }
  });

  it('covers every payment status', () => {
    for (const status of Object.values(PaymentStatus)) {
      expect(PAYMENT_STATUS_TONE[status]).toBeTruthy();
    }
  });

  it('paints overdue payments as danger and paid ones as positive', () => {
    expect(PAYMENT_STATUS_TONE[PaymentStatus.OVERDUE]).toBe('danger');
    expect(PAYMENT_STATUS_TONE[PaymentStatus.PAID]).toBe('positive');
  });
});

describe('OPEN_TRIP_STATUSES', () => {
  it('is exactly the pre-completion lifecycle', () => {
    expect([...OPEN_TRIP_STATUSES]).toEqual([
      TripStatus.DRAFT,
      TripStatus.ASSIGNED,
      TripStatus.IN_PROGRESS,
    ]);
  });
});

describe('vehicleState', () => {
  it('reports an inactive vehicle regardless of its trips', () => {
    expect(vehicleState({ isActive: false, hasOpenTrip: true })).toBe('INACTIVE');
  });

  it('prefers the open trip over maintenance', () => {
    expect(vehicleState({ isActive: true, hasOpenTrip: true, inMaintenance: true })).toBe(
      'ON_TRIP',
    );
  });

  it('falls back to maintenance, then availability', () => {
    expect(vehicleState({ isActive: true, hasOpenTrip: false, inMaintenance: true })).toBe(
      'MAINTENANCE',
    );
    expect(vehicleState({ isActive: true, hasOpenTrip: false })).toBe('AVAILABLE');
  });

  it('maps every state to a tone', () => {
    for (const state of ['ON_TRIP', 'AVAILABLE', 'MAINTENANCE', 'INACTIVE'] as const) {
      expect(RESOURCE_STATE_TONE[state]).toBeTruthy();
    }
  });
});

describe('driverState', () => {
  it('is on-trip while holding an open trip, otherwise available', () => {
    expect(driverState({ isActive: true, hasOpenTrip: true })).toBe('ON_TRIP');
    expect(driverState({ isActive: true, hasOpenTrip: false })).toBe('AVAILABLE');
    expect(driverState({ isActive: false, hasOpenTrip: false })).toBe('INACTIVE');
  });
});
