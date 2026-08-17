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
    if (!stored || stored.expiresAt < new Date()) {
      throw new AppException('AUTH_REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }
    if (stored.revokedAt) {
      // A token that was already rotated is being presented again. Either it
      // was stolen or a copy of it was; there is no way to tell which side is
      // the thief, so every session of that user ends and the attempt is
      // recorded. Losing a session is cheap; leaving a stolen one alive is not.
      await this.revokeAllFor(stored.userId, 'REFRESH_REUSE');
      throw new AppException('AUTH_REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new AppException('AUTH_USER_INACTIVE', HttpStatus.FORBIDDEN);
    }

    // Rotation: the old token dies the moment a new pair is issued.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(user);
  }

  /** Ends every session of one user, and says in the audit log why. */
  private async revokeAllFor(userId: string, reason: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.audit.log({
      companyId: user?.companyId ?? null,
      userId,
      action: reason,
      entityType: 'User',
      entityId: userId,
    });
  }

  async logout(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken);
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
