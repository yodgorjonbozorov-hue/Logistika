import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * How long a "this session is fine" answer may be reused (M-17).
 *
 * A signed access token alone says nothing about whether the account still
 * exists, is still enabled, or whether the tenant still pays — checking that
 * per request would mean a database round trip on every single call, so the
 * verdict is cached briefly. The window is the worst-case delay between an
 * admin disabling an account and its tokens going dead; refresh is checked
 * immediately and without caching, so a revoked session can survive at most
 * this long plus nothing else.
 */
const CACHE_TTL_MS = 15_000;

interface CachedVerdict {
  expiresAt: number;
  error: AppException | null;
}

@Injectable()
export class SessionStateService {
  private readonly cache = new Map<string, CachedVerdict>();

  constructor(private readonly prisma: PrismaService) {}

  async assertUsable(userId: string): Promise<void> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.error) throw cached.error;
      return;
    }

    const error = await this.evaluate(userId);
    this.remember(userId, error);
    if (error) throw error;
  }

  /** Drops the cached verdict so a change takes effect on the next request. */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  private async evaluate(userId: string): Promise<AppException | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isActive: true,
        company: { select: { isActive: true, subscriptionUntil: true } },
      },
    });

    if (!user || !user.isActive) {
      return new AppException('AUTH_USER_INACTIVE', HttpStatus.FORBIDDEN);
    }
    // SUPERADMIN has no company; every tenant user does.
    if (user.company) {
      if (!user.company.isActive) {
        return new AppException('AUTH_USER_INACTIVE', HttpStatus.FORBIDDEN);
      }
      if (user.company.subscriptionUntil && user.company.subscriptionUntil < new Date()) {
        return new AppException('AUTH_FORBIDDEN', HttpStatus.PAYMENT_REQUIRED);
      }
    }
    return null;
  }

  private remember(userId: string, error: AppException | null): void {
    // Bounded so a token-spraying attacker cannot grow the map without limit.
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(userId, { expiresAt: Date.now() + CACHE_TTL_MS, error });
  }
}
