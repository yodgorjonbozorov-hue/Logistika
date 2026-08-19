import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthTokens, UserRole } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';

interface RefreshTokenPayload {
  sub: string;
  jti: string;
  fid: string;
}

const TTL_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * A real argon2 hash of a random throwaway secret, verified against when no
 * user matches. Skipping the verify would return "unknown account" measurably
 * faster than "wrong password", which is a free account-enumeration oracle
 * (L-3). Computed once, lazily, with the same parameters as a real hash.
 */
let timingEqualiserHash: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  timingEqualiserHash ??= argon2.hash(randomUUID());
  return timingEqualiserHash;
}

export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(ttl);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);
  return Number(match[1]) * TTL_UNIT_SECONDS[match[2] as string]!;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(identifier: string, password: string): Promise<AuthTokens> {
    const user = await this.usersService.findByIdentifier(identifier);

    // Always run a verify, even with no user: skipping it returns "unknown
    // account" measurably faster than "wrong password", which is a free user
    // enumeration oracle (L-3).
    const passwordValid = await argon2
      .verify(user?.passwordHash ?? (await decoyHash()), password)
      .catch(() => false);

    if (!user || !passwordValid) {
      throw new AppException('AUTH_INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    }
    if (!user.isActive) {
      throw new AppException('AUTH_USER_INACTIVE', HttpStatus.FORBIDDEN);
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    this.audit.log({
      companyId: user.companyId,
      userId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
    });
    return this.issueTokens(user);
  }

  /**
   * Rotating refresh with reuse detection (M-5).
   *
   * Every token carries a family id that survives rotation. Presenting a token
   * that was already rotated (or explicitly revoked) can only mean one of two
   * things — a stolen token being replayed, or the legitimate client replaying
   * an old one — and neither is safe to serve. The whole family is revoked, so
   * the thief and the victim are both logged out and the theft becomes visible.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashJti(payload.jti) },
    });

    if (!stored) {
      throw new AppException('AUTH_REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }
    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      // Deliberately not phrased as "theft detected": an administrator
      // deactivating an account or resetting a password also revokes tokens,
      // and the client then presents one. Both mean the session is over; only
      // the pattern of occurrences tells them apart.
      this.logger.warn(
        `Revoked refresh token presented for user ${stored.userId}; ` +
          `family ${stored.familyId} revoked (rotation replay or an administrative revocation)`,
      );
      this.audit.log({
        userId: stored.userId,
        action: 'REFRESH_REUSE_DETECTED',
        entityType: 'RefreshToken',
        entityId: stored.id,
        after: { familyId: stored.familyId },
      });
      throw new AppException('AUTH_REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }
    if (stored.expiresAt < new Date()) {
      throw new AppException('AUTH_REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      await this.revokeFamily(stored.familyId);
      throw new AppException('AUTH_USER_INACTIVE', HttpStatus.FORBIDDEN);
    }

    // Rotation is atomic: only the request that actually flips revoked_at from
    // NULL wins, so two parallel refreshes cannot both mint a new pair.
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count === 0) {
      throw new AppException('AUTH_REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }

    return this.issueTokens(user, stored.familyId);
  }

  async logout(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken);
    // Log out means log out everywhere this session chain reached. Tokens
    // issued before families existed carry no `fid`; those revoke by hash.
    if (payload.fid) {
      await this.revokeFamily(payload.fid);
      return;
    }
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashJti(payload.jti), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  }

  async issueTokens(user: User, familyId?: string): Promise<AuthTokens> {
    const accessTtl = this.config.getOrThrow<string>('JWT_ACCESS_TTL');
    const refreshTtl = this.config.getOrThrow<string>('JWT_REFRESH_TTL');
    const jti = randomUUID();
    const family = familyId ?? randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: user.id, companyId: user.companyId, role: user.role as UserRole },
        { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: accessTtl },
      ),
      this.jwtService.signAsync(
        { sub: user.id, jti, fid: family },
        { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), expiresIn: refreshTtl },
      ),
    ]);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashJti(jti),
        familyId: family,
        expiresAt: new Date(Date.now() + ttlToSeconds(refreshTtl) * 1000),
      },
    });
    return { accessToken, refreshToken };
  }

  /** Kills every still-live token in a rotation chain. */
  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new AppException('AUTH_REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }
  }

  private hashJti(jti: string): string {
    return createHash('sha256').update(jti).digest('hex');
  }
}
