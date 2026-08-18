import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SubscriptionState {
  /** The company itself is switched off; nothing at all is allowed. */
  isActive: boolean;
  /** null means no expiry was ever set — a trial or a legacy tenant. */
  until: Date | null;
  /** Paid period is over: reads still work, writes do not. */
  expired: boolean;
}

/** How long a looked-up company is trusted before it is read again. */
export const SUBSCRIPTION_CACHE_MS = 60_000;

interface CacheEntry {
  state: SubscriptionState;
  readAt: number;
}

/**
 * Answers "may this company still use the system" (TASK-3.9).
 *
 * `Company.isActive` and `subscriptionUntil` existed from the beginning and
 * were set by SUPERADMIN, but nothing ever read them: a company that stopped
 * paying, or was switched off, kept full access to every endpoint.
 *
 * The answer is cached for a minute because it is needed on every single
 * request, and a company's billing state does not change between two clicks.
 * A SUPERADMIN edit clears the entry immediately, so switching a company off
 * takes effect at once rather than up to a minute later.
 */
@Injectable()
export class SubscriptionService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async stateOf(companyId: string, now: Date = new Date()): Promise<SubscriptionState> {
    const cached = this.cache.get(companyId);
    if (cached && now.getTime() - cached.readAt < SUBSCRIPTION_CACHE_MS) {
      // `expired` is recomputed: the cached row may have been read before the
      // subscription ran out.
      return { ...cached.state, expired: isExpired(cached.state.until, now) };
    }

    // Deliberately unscoped: this asks *about* a tenant rather than reading
    // tenant data, and the id comes from the verified token, never from input.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { isActive: true, subscriptionUntil: true },
    });

    const state: SubscriptionState = {
      // A company that no longer exists is not active. Failing open here would
      // make a deleted tenant the most privileged one.
      isActive: company?.isActive ?? false,
      until: company?.subscriptionUntil ?? null,
      expired: isExpired(company?.subscriptionUntil ?? null, now),
    };
    this.cache.set(companyId, { state, readAt: now.getTime() });
    return state;
  }

  /** Called when SUPERADMIN changes a company, so the change is not delayed. */
  invalidate(companyId: string): void {
    this.cache.delete(companyId);
  }

  /** Test seam; also used when the whole cache should be dropped. */
  clear(): void {
    this.cache.clear();
  }
}

function isExpired(until: Date | null, now: Date): boolean {
  // No date set is not an expired date: trials and legacy tenants have none,
  // and locking them out would be the opposite of what the field means.
  return until !== null && until.getTime() < now.getTime();
}
