import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** How long a looked-up version is trusted before it is read again. */
export const TOKEN_VERSION_CACHE_MS = 30_000;

/**
 * The generation number every access token is minted against (M-2, L-2).
 *
 * An access token lives 15 minutes and used to survive every decision that
 * should have killed it: a demoted user kept their old rights, a deactivated
 * one kept full access, and "log out" on a shared phone left a quarter of an
 * hour in which the previous driver's token still worked.
 *
 * Bumping the user's version invalidates every token they hold — which is
 * exactly what those four events mean. Logout is included deliberately: ending
 * one device's session while another keeps a working token is not what anybody
 * pressing "log out" on a shared phone expects.
 *
 * Cached, because this is read on every authenticated request. The window is
 * shorter than the subscription cache: the whole point is that a revocation
 * takes effect quickly, and every path that bumps the version also clears the
 * entry, so the delay only applies to a change made outside the application.
 */
@Injectable()
export class TokenVersionService {
  private readonly cache = new Map<string, { version: number; readAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async currentFor(userId: string, now: number = Date.now()): Promise<number | null> {
    const cached = this.cache.get(userId);
    if (cached && now - cached.readAt < TOKEN_VERSION_CACHE_MS) return cached.version;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true, isActive: true },
    });
    // A user who no longer exists, or was switched off, holds no valid tokens.
    if (!user || !user.isActive) return null;

    this.cache.set(userId, { version: user.tokenVersion, readAt: now });
    return user.tokenVersion;
  }

  /** Called after any write that bumped the version, so it takes effect now. */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  clear(): void {
    this.cache.clear();
  }
}
