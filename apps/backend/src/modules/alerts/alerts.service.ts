import { HttpStatus, Injectable } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import type { AlertType, CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';

export interface RaiseAlertInput {
  type: AlertType;
  /** i18n interpolation values; stored as JSON, rendered by the client. */
  params: Record<string, string | number>;
  relatedType?: string;
  relatedId?: string;
}

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a company-wide alert. While an unread alert of the same type for
   * the same related entity exists, repeated raises are swallowed — a nightly
   * cron must not spam the owner with duplicates.
   *
   * Called from crons where no request tenant context exists, so companyId is
   * explicit here (still always scoped — CLAUDE.md rule).
   */
  async raise(companyId: string, input: RaiseAlertInput): Promise<Notification | null> {
    const db = this.prisma.forCompany(companyId);
    const existing = await db.notification.findFirst({
      where: {
        type: input.type,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        isRead: false,
      },
    });
    if (existing) return null;
    return db.notification.create({
      data: {
        companyId,
        type: input.type,
        // No hardcoded user text (CLAUDE.md): title mirrors the type key,
        // message carries the i18n params as JSON.
        title: input.type,
        message: JSON.stringify(input.params),
        relatedType: input.relatedType,
        relatedId: input.relatedId,
      },
    });
  }

  async list(
    actor: CurrentUserPayload,
    pagination: PaginationDto,
    onlyUnread: boolean,
  ): Promise<{ data: Notification[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where = onlyUnread ? { isRead: false } : {};
    const [data, total] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      db.notification.count({ where }),
    ]);
    return { data, total };
  }

  async unreadCount(actor: CurrentUserPayload): Promise<{ count: number }> {
    const count = await this.prisma
      .forCompany(actor.companyId)
      .notification.count({ where: { isRead: false } });
    return { count };
  }

  async ack(actor: CurrentUserPayload, id: string): Promise<Notification> {
    const db = this.prisma.forCompany(actor.companyId);
    const existing = await db.notification.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return db.notification.update({ where: { id }, data: { isRead: true } });
  }

  async ackAll(actor: CurrentUserPayload): Promise<{ acknowledged: number }> {
    const result = await this.prisma
      .forCompany(actor.companyId)
      .notification.updateMany({ where: { isRead: false }, data: { isRead: true } });
    return { acknowledged: result.count };
  }
}
