import { HttpStatus, Injectable } from '@nestjs/common';
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
}

const TTL_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(ttl);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);
  return Number(match[1]) * TTL_UNIT_SECONDS[match[2] as string]!;
}

@Injectable()
export class AuthService {
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
    const passwordValid = await argon2.verify(user.passwordHash, password);
    if (!passwordValid) {
      throw new AppException('AUTH_INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    }
    if (!user.isActive) {
      throw new AppException('AUTH_USER_INACTIVE', HttpStatus.FORBIDDEN);
    }
    await this.assertCompanyActive(user);

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

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashJti(payload.jti) },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppException('AUTH_REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new AppException('AUTH_USER_INACTIVE', HttpStatus.FORBIDDEN);
    }
    // Checked here as well as at login, so suspending a tenant ends its live
    // sessions at the next refresh rather than whenever people happen to sign
    // out. An access token stays valid for its own short lifetime.
    await this.assertCompanyActive(user);

    // Rotation: the old token dies the moment a new pair is issued.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashJti(payload.jti), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Any signed-in account can change its own password — including the platform
   * admin, which belongs to no company and so has no other way to.
   *
   * The current password is required (a stolen access token must not be enough
   * to take an account over), and every other session is revoked so a password
   * change actually ends whoever else was signed in.
   */
  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    if (!(await argon2.verify(user.passwordHash, current))) {
      throw new AppException('AUTH_INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    }
    if (current === next) {
      throw new AppException('AUTH_PASSWORD_UNCHANGED', HttpStatus.BAD_REQUEST);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await argon2.hash(next) },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.audit.log({
      companyId: user.companyId,
      userId: user.id,
      action: 'UPDATE',
      entityType: 'User',
      entityId: user.id,
      after: { passwordChanged: true },
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
   * A tenant has to be in good standing for its staff to sign in: not
   * suspended, and inside its subscription. A company with no
   * `subscriptionUntil` is not blocked — that is an unset field, not a lapsed
   * subscription, and the platform screen shows it as such. Platform accounts
   * have no company and skip the check entirely.
   */
  private async assertCompanyActive(user: User): Promise<void> {
    if (!user.companyId) return;
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { isActive: true, subscriptionUntil: true },
    });
    if (!company?.isActive) {
      throw new AppException('AUTH_COMPANY_INACTIVE', HttpStatus.FORBIDDEN);
    }
    if (company.subscriptionUntil && company.subscriptionUntil < new Date()) {
      throw new AppException('AUTH_SUBSCRIPTION_EXPIRED', HttpStatus.FORBIDDEN);
    }
  }

  async issueTokens(user: User): Promise<AuthTokens> {
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

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashJti(jti),
        expiresAt: new Date(Date.now() + ttlToSeconds(refreshTtl) * 1000),
      },
    });
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
