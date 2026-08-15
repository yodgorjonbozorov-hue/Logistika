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
  userId?: string | null;
  /**
   * Name of a param that makes an alert a NEW one rather than a repeat: a
   * document reminder at 7 days left is not the 15-day reminder again. When the
   * value differs from the unread alert on the same subject, that stale alert is
   * marked read and the fresh one takes its place.
   */
  dedupeParam?: string;
}

/** Notification.message payload — an i18n key with its params. */
export interface AlertMessage {
  key: string;
  params: Record<string, string | number>;
}

export function parseAlertMessage(message: string): AlertMessage {
  try {
    const parsed = JSON.parse(message) as Partial<AlertMessage>;
    if (typeof parsed?.key === 'string') return { key: parsed.key, params: parsed.params ?? {} };
  } catch {
    // Pre-JSON rows (or anything hand-written) are treated as a bare key.
  }
  return { key: message, params: {} };
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
      select: { id: true, message: true },
    });
    if (duplicate) {
      if (!alert.dedupeParam) return null;
      const previous = parseAlertMessage(duplicate.message).params[alert.dedupeParam];
      const current = alert.params?.[alert.dedupeParam];
      if (String(previous) === String(current)) return null;
      // Superseded: the older, less urgent alert stops competing for attention.
      await db.notification.update({ where: { id: duplicate.id }, data: { isRead: true } });
    }

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
