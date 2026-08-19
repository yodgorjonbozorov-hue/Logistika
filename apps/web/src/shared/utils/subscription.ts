import type { ChipTone } from '../ui';

/** Warn a tenant this many days before its subscription runs out. */
export const EXPIRY_WARNING_DAYS = 7;

/** Days left on a subscription, or null when no end date is set. */
export function daysLeft(until: string | null): number | null {
  if (!until) return null;
  return Math.ceil((new Date(until).getTime() - Date.now()) / 86_400_000);
}

export type StandingKey = 'active' | 'expiring' | 'expired' | 'suspended' | 'noSubscription';

/**
 * How a tenant's standing reads at a glance — the platform screen shows it as a
 * chip, the tenant's own shell as a banner. Suspension outranks the dates: it
 * is a decision, not a deadline.
 */
export function standing(company: { isActive: boolean; subscriptionUntil: string | null }): {
  tone: ChipTone;
  key: StandingKey;
  days: number | null;
} {
  const days = daysLeft(company.subscriptionUntil);
  if (!company.isActive) return { tone: 'muted', key: 'suspended', days };
  if (days === null) return { tone: 'neutral', key: 'noSubscription', days };
  if (days < 0) return { tone: 'danger', key: 'expired', days };
  if (days <= EXPIRY_WARNING_DAYS) return { tone: 'warning', key: 'expiring', days };
  return { tone: 'positive', key: 'active', days };
}
