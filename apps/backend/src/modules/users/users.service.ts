import { HttpStatus, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { normalizePhone } from '../../common/phone';
import { TokenVersionService } from '../../common/auth/token-version.service';

export type SafeUser = Omit<User, 'passwordHash'>;

function stripHash(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokenVersions: TokenVersionService,
  ) {}

  /**
   * Ends every stored session for this user.
   *
   * Bumping the token version stops the access tokens; the refresh tokens are
   * a separate store and used to survive a deactivation entirely, so a
   * switched-off account could mint itself a fresh access token (M-2).
   */
  private async revokeRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ---------- Pre-auth lookups (login happens before the tenant is known) ----------

  findByIdentifier(identifier: string): Promise<User | null> {
    // The login form takes whatever the person types. Without normalising it
    // here, somebody who registered as +998901234567 could not sign in by
    // typing 901234567 — the lookup is an exact match on a unique column.
    const where = identifier.includes('@')
      ? { email: identifier }
      : { phone: normalizePhone(identifier) };
    return this.prisma.user.findUnique({ where });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  // ---------- Tenant-scoped CRUD ----------

  async list(
    actor: CurrentUserPayload,
    pagination: PaginationDto,
  ): Promise<{ data: SafeUser[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const [data, total] = await Promise.all([
      db.user.findMany({
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      db.user.count(),
    ]);
    return { data: data.map(stripHash), total };
  }

  async create(actor: CurrentUserPayload, dto: CreateUserDto): Promise<SafeUser> {
    const passwordHash = await argon2.hash(dto.password);
    try {
      const user = await this.prisma.forCompany(actor.companyId).user.create({
        data: {
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          passwordHash,
          role: dto.role,
        },
      });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'User',
        entityId: user.id,
        after: { fullName: user.fullName, role: user.role },
      });
      return stripHash(user);
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async getById(actor: CurrentUserPayload, id: string): Promise<SafeUser> {
    const user = await this.prisma.forCompany(actor.companyId).user.findUnique({ where: { id } });
    if (!user) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return stripHash(user);
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateUserDto): Promise<SafeUser> {
    const { password, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (password) data.passwordHash = await argon2.hash(password);

    // A demotion, a switch-off or a new password all mean the tokens this user
    // is carrying no longer describe what they may do. Without this the old
    // rights lasted another 15 minutes (M-2).
    const revokes = password !== undefined || rest.role !== undefined || rest.isActive === false;
    if (revokes) data.tokenVersion = { increment: 1 };

    try {
      const user = await this.prisma.forCompany(actor.companyId).user.update({
        where: { id },
        data,
      });
      if (revokes) {
        this.tokenVersions.invalidate(id);
        await this.revokeRefreshTokens(id);
      }
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'UPDATE',
        entityType: 'User',
        entityId: id,
        after: { ...rest, passwordChanged: Boolean(password) },
      });
      return stripHash(user);
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /** Soft delete: users are deactivated, never removed (history must survive). */
  async deactivate(actor: CurrentUserPayload, id: string): Promise<SafeUser> {
    if (id === actor.userId) {
      throw new AppException('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
    }
    try {
      const user = await this.prisma.forCompany(actor.companyId).user.update({
        where: { id },
        data: { isActive: false, tokenVersion: { increment: 1 } },
      });
      this.tokenVersions.invalidate(id);
      await this.revokeRefreshTokens(id);
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'DEACTIVATE',
        entityType: 'User',
        entityId: id,
      });
      return stripHash(user);
    } catch (error) {
      rethrowPrismaError(error);
    }
  }
}
