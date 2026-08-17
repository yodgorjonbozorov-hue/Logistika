import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { I18nService } from '../../i18n/i18n.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { SmsService } from './sms.service';
import type { ChangePasswordDto, ResetPasswordDto } from './dto/password.dto';

const RESET_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly audit: AuditService,
    private readonly sms: SmsService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Changing your own password ends every other session: if the reason for the
   * change is "someone else knows it", leaving their sessions alive defeats it.
   * The caller's current refresh token is not spared either — the client simply
   * signs in again, which is the safest outcome to get wrong.
   */
  async changePassword(actor: CurrentUserPayload, dto: ChangePasswordDto): Promise<{ ok: true }> {
    const user = await this.usersService.findById(actor.userId);
    if (!user) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    const valid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!valid) throw new AppException('AUTH_INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(dto.newPassword) },
    });
    await this.revokeAllSessions(user.id);

    this.audit.log({
      companyId: user.companyId,
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
      // Never the password itself, not even its length.
      after: { passwordChanged: true },
    });
    return { ok: true };
  }

  /**
   * Always answers the same way, whether or not the identifier exists — an
   * endpoint that says "no such user" is a free account-enumeration oracle
   * (same reasoning as driver code requests).
   */
  async forgotPassword(identifier: string): Promise<{ sent: true }> {
    const user = await this.usersService.findByIdentifier(identifier);
    if (!user || !user.isActive) return { sent: true };

    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });

    await this.deliver(user.email, user.phone, token);
    this.audit.log({
      companyId: user.companyId,
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'User',
      entityId: user.id,
    });
    return { sent: true };
  }

  /** Single use: the token is spent whether or not the caller keeps the tab open. */
  async resetPassword(dto: ResetPasswordDto): Promise<{ ok: true }> {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hash(dto.token) },
    });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new AppException('AUTH_RESET_TOKEN_INVALID', HttpStatus.BAD_REQUEST);
    }

    // Compare-and-set, so two parallel submissions cannot both spend it.
    const { count } = await this.prisma.passwordResetToken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) {
      throw new AppException('AUTH_RESET_TOKEN_INVALID', HttpStatus.BAD_REQUEST);
    }

    const user = await this.prisma.user.update({
      where: { id: stored.userId },
      data: {
        passwordHash: await argon2.hash(dto.newPassword),
        // A successful reset also lifts a lockout: the person proved control of
        // the account, and leaving them locked out helps nobody.
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await this.revokeAllSessions(user.id);
    // Any other outstanding reset link dies with it.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    this.audit.log({
      companyId: user.companyId,
      userId: user.id,
      action: 'PASSWORD_RESET',
      entityType: 'User',
      entityId: user.id,
      after: { passwordChanged: true },
    });
    return { ok: true };
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * SMS works today; email does not — there is no provider configured and none
   * was specified, so the link is logged rather than silently dropped.
   * Replacing this log with a real mailer is the whole integration.
   */
  private async deliver(
    email: string | null,
    phone: string | null,
    token: string,
  ): Promise<void> {
    if (phone) {
      await this.sms.send(phone, this.i18n.translate('SMS_PASSWORD_RESET', 'uz-latn', { token }));
      return;
    }
    if (email) {
      this.logger.log(`[DEV EMAIL] password reset for ${email}: token ${token}`);
      return;
    }
    this.logger.warn('Password reset requested for an account with no phone or email');
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
