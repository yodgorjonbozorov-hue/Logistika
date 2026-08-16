import { HttpStatus, Injectable } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramService } from './telegram.service';

export interface TelegramLinkState {
  linked: boolean;
  /** False when the platform has no bot token at all — the UI hides the setting. */
  available: boolean;
}

/**
 * Where a user gets told things (TZ §7). Today that is Telegram for owners;
 * FCM for drivers follows the same shape.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  async state(actor: CurrentUserPayload): Promise<TelegramLinkState> {
    const user = await this.prisma
      .forCompany(actor.companyId)
      .user.findFirst({ where: { id: actor.userId }, select: { telegramChatId: true } });
    return { linked: Boolean(user?.telegramChatId), available: this.telegram.configured };
  }

  /**
   * Links the chat the bot reported to this user. The chat id is unique across
   * the platform, so a clash is left to the database rather than looked up —
   * checking it here would mean reading another company's row to find out.
   */
  async linkTelegram(actor: CurrentUserPayload, chatId: string): Promise<TelegramLinkState> {
    if (!this.telegram.configured) {
      throw new AppException('NOT_FOUND', HttpStatus.SERVICE_UNAVAILABLE);
    }
    await this.prisma
      .forCompany(actor.companyId)
      .user.update({ where: { id: actor.userId }, data: { telegramChatId: chatId } })
      .catch(rethrowPrismaError);
    return { linked: true, available: true };
  }

  async unlinkTelegram(actor: CurrentUserPayload): Promise<TelegramLinkState> {
    await this.prisma
      .forCompany(actor.companyId)
      .user.update({ where: { id: actor.userId }, data: { telegramChatId: null } });
    return { linked: false, available: this.telegram.configured };
  }

  /** Chats the daily digest of one company goes to (TZ §8.9 — the owners). */
  async digestRecipients(companyId: string): Promise<string[]> {
    const users = await this.prisma.forCompany(companyId).user.findMany({
      where: { isActive: true, role: UserRole.OWNER, telegramChatId: { not: null } },
      select: { telegramChatId: true },
    });
    return users.map((user) => user.telegramChatId as string);
  }
}
