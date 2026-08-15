import { Injectable } from '@nestjs/common';
import type { Notification, Prisma } from '@prisma/client';
import { AlertType, type CurrentUserPayload } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAlertsDto } from './dto/alert.dto';

/**
 * A single alert to raise. `title`/`message` are i18n KEYS with params — the
 * client renders the text, nothing user-facing is hardcoded here (CLAUDE.md).
 */
export interface AlertInput {
  type: AlertType;
  titleKey: string;
  messageKey: string;
  params?: Record<string, string | number>;
  relatedType?: string;
  relatedId?: string;
  /** Alert stays deduplicated while an unread copy of the same subject exists. */
  userId?: string | null;
}

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Raises an alert unless the same (type, related entity) is already waiting
   * unread — cron jobs run daily and must not pile up copies.
   * Returns the created notification, or null when it was deduplicated.
   */
  async raise(companyId: string, alert: AlertInput): Promise<Notification | null> {
    const db = this.prisma.forCompany(companyId);
    const duplicate = await db.notification.findFirst({
      where: {
        type: alert.type,
        relatedType: alert.relatedType ?? null,
        relatedId: alert.relatedId ?? null,
        isRead: false,
      },
      select: { id: true },
    });
    if (duplicate) return null;

    return db.notification.create({
      data: {
        userId: alert.userId ?? null,
        type: alert.type,
        title: alert.titleKey,
        // Params travel with the key so the client can interpolate in any locale.
        message: JSON.stringify({ key: alert.messageKey, params: alert.params ?? {} }),
        relatedType: alert.relatedType ?? null,
        relatedId: alert.relatedId ?? null,
      } as Prisma.NotificationUncheckedCreateInput,
    });
  }

  /** Raises many alerts, reporting how many were new. */
  async raiseMany(companyId: string, alerts: AlertInput[]): Promise<number> {
    let created = 0;
    for (const alert of alerts) {
      if (await this.raise(companyId, alert)) created += 1;
    }
    return created;
  }

  /** W-10 alert centre. */
  async list(
    actor: CurrentUserPayload,
    filter: ListAlertsDto,
  ): Promise<{ data: Notification[]; total: number; unread: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.NotificationWhereInput = {
      type: filter.type,
      ...(filter.unreadOnly ? { isRead: false } : {}),
      // Company-wide alerts (userId null) plus anything addressed to this user.
      OR: [{ userId: null }, { userId: actor.userId }],
    };
    const [data, total, unread] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.limit,
      }),
      db.notification.count({ where }),
      db.notification.count({
        where: { isRead: false, OR: [{ userId: null }, { userId: actor.userId }] },
      }),
    ]);
    return { data, total, unread };
  }

  async markRead(actor: CurrentUserPayload, id: string): Promise<{ updated: number }> {
    const { count } = await this.prisma
      .forCompany(actor.companyId)
      .notification.updateMany({ where: { id, isRead: false }, data: { isRead: true } });
    return { updated: count };
  }

  async markAllRead(actor: CurrentUserPayload): Promise<{ updated: number }> {
    const { count } = await this.prisma.forCompany(actor.companyId).notification.updateMany({
      where: { isRead: false, OR: [{ userId: null }, { userId: actor.userId }] },
      data: { isRead: true },
    });
    return { updated: count };
  }
}
