import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import type { AuthTokens } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { I18nService } from '../../i18n/i18n.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { SmsService } from './sms.service';

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/**
 * Per-phone codes allowed in a rolling 24h window. MAX_ATTEMPTS only guards a
 * single SmsCode row, and requesting a new code used to delete the old one and
 * reset the counter — so without this cap the verify limit could be reset
 * forever. Counting rows in the database closes that loop for good.
 */
const MAX_CODES_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DriverAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly sms: SmsService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Always answers success (no phone-number enumeration); a code is generated
   * and sent only when an active driver account exists for the phone. The code
   * itself never travels in the response — in development it is visible in the
   * SmsService log ("[DEV SMS] …").
   */
  async requestCode(phone: string): Promise<{ sent: boolean }> {
    const user = await this.usersService.findByIdentifier(phone);
    if (!user || !user.isActive || user.role !== 'DRIVER') {
      return { sent: true };
    }

    const issuedToday = await this.prisma.smsCode.count({
      where: { phone, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
    if (issuedToday >= MAX_CODES_PER_DAY) {
      throw new AppException('SMS_DAILY_LIMIT', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = randomInt(100_000, 1_000_000).toString();
    await this.prisma.$transaction([
      // Older codes stop being valid, but the rows stay for the daily count.
      this.prisma.smsCode.updateMany({
        where: { phone, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date() },
      }),
      this.prisma.smsCode.create({
        data: {
          phone,
          codeHash: this.hashCode(phone, code),
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      }),
    ]);
    await this.sms.send(phone, this.i18n.translate('SMS_LOGIN_CODE', 'uz-latn', { code }));

    return { sent: true };
  }

  async verify(phone: string, code: string): Promise<AuthTokens> {
    const record = await this.prisma.smsCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.expiresAt < new Date() || record.attempts >= MAX_ATTEMPTS) {
      throw new AppException('SMS_CODE_INVALID', HttpStatus.UNAUTHORIZED);
    }

    if (record.codeHash !== this.hashCode(phone, code)) {
      await this.prisma.smsCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppException('SMS_CODE_INVALID', HttpStatus.UNAUTHORIZED);
    }

    // Invalidated rather than deleted: the rows are what the daily cap counts.
    await this.prisma.smsCode.updateMany({
      where: { phone, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date(), attempts: MAX_ATTEMPTS },
    });

    const user = await this.usersService.findByIdentifier(phone);
    if (!user || !user.isActive || user.role !== 'DRIVER') {
      throw new AppException('AUTH_INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    return this.authService.issueTokens(user);
  }

  private hashCode(phone: string, code: string): string {
    return createHash('sha256').update(`${phone}:${code}`).digest('hex');
  }
}
