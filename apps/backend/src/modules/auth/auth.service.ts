import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
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
}

const TTL_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Failed passwords in a row before the account is locked, and for how long. */
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

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
    if (!user) {
      throw new AppException('AUTH_INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppException('AUTH_ACCOUNT_LOCKED', HttpStatus.FORBIDDEN, undefined, {
        lockedUntil: user.lockedUntil.toISOString(),
      });
    }

    // M-1: an inactive account is refused BEFORE the password is checked.
    // Verifying first told an attacker whether the password was right for an
    // account that has been deactivated — free credential confirmation.
    if (!user.isActive) {
      throw new AppException('AUTH_USER_INACTIVE', HttpStatus.FORBIDDEN);
    }

    const passwordValid = await argon2.verify(user.passwordHash, password);
    if (!passwordValid) {
      await this.registerFailedLogin(user);
      throw new AppException('AUTH_INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    });
    this.audit.log({
      companyId: user.companyId,
      userId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
    });
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashJti(payload.jti) },
    });
    if (!stored || stored.expiresAt < new Date()) {
      throw new AppException('AUTH_REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }

    // A revoked token coming back means it was rotated already: either a race
    // between two tabs, or a stolen copy being replayed. Either way the family
    // can no longer be trusted (OWASP reuse detection).
    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId, stored.userId);
      throw new AppException('AUTH_REFRESH_REUSED', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new AppException('AUTH_USER_INACTIVE', HttpStatus.FORBIDDEN);
    }

    // Rotation is a compare-and-set: two parallel refreshes both read an
    // unrevoked row, and only the one whose UPDATE matches gets a new pair.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      throw new AppException('AUTH_REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }

    const tokens = await this.issueTokens(user, stored.familyId, stored.id);
    return tokens;
  }

  /**
   * Kills every live token descended from the same login. The user has to sign
   * in again — which is the point: if a token was stolen, the thief's copies
   * die with it.
   */
  private async revokeFamily(familyId: string, userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.warn(`Refresh token reuse detected for user ${userId}; family ${familyId} revoked`);
    this.audit.log({
      companyId: null,
      userId,
      action: 'REFRESH_REUSE_DETECTED',
      entityType: 'RefreshToken',
      entityId: familyId,
    });
  }

  /**
   * Expired rows serve no purpose and the table only grows. Daily is often
   * enough; TASK-4.4 moves every cron onto a distributed lock so this does not
   * run once per instance.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpiredRefreshTokens(): Promise<void> {
    try {
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) this.logger.log(`Purged ${count} expired refresh tokens`);
    } catch (error) {
      this.logger.error(
        `Refresh token purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async logout(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashJti(payload.jti) },
    });
    if (!stored) return;

    // The whole rotation chain of this session ends, not just the token in
    // hand: one login is one family, so signing out here leaves other devices
    // (each with their own family) alone.
    await this.prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
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

  /**
   * Counts a wrong password and locks the account once the run gets long
   * enough. The window is short on purpose: it stops online guessing without
   * handing anyone a way to lock a colleague out for the day.
   */
  private async registerFailedLogin(user: User): Promise<void> {
    const attempts = user.failedLoginAttempts + 1;
    const locked = attempts >= MAX_FAILED_LOGINS;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: locked ? 0 : attempts,
        lockedUntil: locked ? new Date(Date.now() + LOCKOUT_MS) : user.lockedUntil,
      },
    });
    if (locked) {
      this.logger.warn(`Account ${user.id} locked after ${MAX_FAILED_LOGINS} failed logins`);
      this.audit.log({
        companyId: user.companyId,
        userId: user.id,
        action: 'ACCOUNT_LOCKED',
        entityType: 'User',
        entityId: user.id,
        after: { minutes: LOCKOUT_MS / 60_000 },
      });
    }
  }

  /**
   * @param familyId  continues an existing rotation chain (refresh); a fresh
   *                  login starts a new family.
   * @param replacedId the token this pair replaces, recorded on that row.
   */
  async issueTokens(user: User, familyId?: string, replacedId?: string): Promise<AuthTokens> {
    const accessTtl = this.config.getOrThrow<string>('JWT_ACCESS_TTL');
    const refreshTtl = this.config.getOrThrow<string>('JWT_REFRESH_TTL');
    const jti = randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: user.id, companyId: user.companyId, role: user.role as UserRole },
        { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: accessTtl },
      ),
      this.jwtService.signAsync(
        { sub: user.id, jti },
        { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), expiresIn: refreshTtl },
      ),
    ]);

    const created = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashJti(jti),
        expiresAt: new Date(Date.now() + ttlToSeconds(refreshTtl) * 1000),
        // A login without a family starts one, rooted at its own id.
        familyId: familyId ?? randomUUID(),
      },
    });
    if (replacedId) {
      await this.prisma.refreshToken.update({
        where: { id: replacedId },
        data: { replacedById: created.id },
      });
    }
    return { accessToken, refreshToken };
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
