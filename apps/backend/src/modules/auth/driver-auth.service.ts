import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

@Injectable()
export class DriverAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Always answers success (no phone-number enumeration); a code is generated
   * and sent only when an active driver account exists for the phone.
   * In development the code is returned in the response for manual testing.
   */
  async requestCode(phone: string): Promise<{ sent: boolean; devCode?: string }> {
    const user = await this.usersService.findByIdentifier(phone);
    if (!user || !user.isActive || user.role !== 'DRIVER') {
      return { sent: true };
    }

    const code = randomInt(100_000, 1_000_000).toString();
    await this.prisma.$transaction([
      this.prisma.smsCode.deleteMany({ where: { phone } }),
      this.prisma.smsCode.create({
        data: {
          phone,
          codeHash: this.hashCode(phone, code),
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      }),
    ]);
    await this.sms.send(phone, this.i18n.translate('SMS_LOGIN_CODE', 'uz-latn', { code }));

    // M-4: POSITIVE check. The old `!== 'production'` meant any typo or unset
    // NODE_ENV (staging, PRODUCTION, empty) leaked the login code in the HTTP
    // response. Only an explicit development build ever sees it.
    const isDevelopment = this.config.get<string>('NODE_ENV') === 'development';
    return isDevelopment ? { sent: true, devCode: code } : { sent: true };
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

    await this.prisma.smsCode.deleteMany({ where: { phone } });

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
