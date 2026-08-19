/**
 * How a tenant's subscription reads on the platform screen. The thresholds are
 * the product decision here, so they are pinned rather than left to the eye.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Company } from '../../shared/api/entities';
import { daysLeft, standing } from './CompaniesPage';

const NOW = new Date('2026-08-19T12:00:00.000Z');

/** An ISO date `days` from the frozen clock. */
function inDays(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString();
}

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 'c1',
    name: 'Yo‘l Logistika',
    inn: null,
    address: null,
    phone: null,
    logo: null,
    tariffPlan: 'TRIAL',
    subscriptionUntil: inDays(14),
    isActive: true,
    createdAt: inDays(-30),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('daysLeft', () => {
  it('counts whole days ahead, and nothing when no date is set', () => {
    expect(daysLeft(inDays(14))).toBe(14);
    expect(daysLeft(inDays(0.5))).toBe(1); // part of a day still counts as one
    expect(daysLeft(null)).toBeNull();
  });

  it('goes negative once the subscription is behind us', () => {
    expect(daysLeft(inDays(-3))).toBe(-3);
  });
});

describe('standing', () => {
  it('reads a healthy subscription as active', () => {
    expect(standing(company())).toMatchObject({ key: 'active', tone: 'positive', days: 14 });
  });

  it('warns from a week out', () => {
    expect(standing(company({ subscriptionUntil: inDays(8) })).key).toBe('active');
    expect(standing(company({ subscriptionUntil: inDays(7) })).key).toBe('expiring');
    expect(standing(company({ subscriptionUntil: inDays(1) })).key).toBe('expiring');
  });

  it('marks a lapsed subscription as expired', () => {
    expect(standing(company({ subscriptionUntil: inDays(-1) }))).toMatchObject({
      key: 'expired',
      tone: 'danger',
    });
  });

  it('separates "no subscription" from "expired"', () => {
    expect(standing(company({ subscriptionUntil: null }))).toMatchObject({
      key: 'noSubscription',
      days: null,
    });
  });

  it('suspension outranks whatever the subscription says', () => {
    expect(standing(company({ isActive: false, subscriptionUntil: inDays(300) })).key).toBe(
      'suspended',
    );
    expect(standing(company({ isActive: false, subscriptionUntil: null })).key).toBe('suspended');
  });
});
