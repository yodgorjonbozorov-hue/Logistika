import { HttpStatus, Injectable } from '@nestjs/common';
import { ChatMessageKind, Prisma, type ChatMessage } from '@prisma/client';
import { UserRole, type CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { PostMessageDto } from './dto/chat.dto';

/** Enough for a trip's whole conversation; older ones page back by cursor. */
const PAGE_SIZE = 100;

export interface ChatMessageView {
  id: string;
  tripId: string;
  senderId: string | null;
  senderName: string | null;
  /** True for the person reading it — the panel aligns the bubble by this. */
  mine: boolean;
  kind: ChatMessageKind;
  body: string | null;
  fileId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Logist ↔ driver conversation about one trip (TZ §3.2 E-4).
 *
 * A thread belongs to a trip, which is what makes access decidable: office
 * roles see any trip of their company, a driver sees the trips they are on and
 * nothing else. Photos and voice notes are ordinary uploads referenced by id,
 * so a voice note in a chat expires on the same 30-day clock as any other.
 */
@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The trip, if this user may talk about it.
   *
   * A driver asking about someone else's trip gets NOT_FOUND, not FORBIDDEN:
   * the answer must not confirm that the trip exists.
   */
  private async requireTripAccess(actor: CurrentUserPayload, tripId: string): Promise<string> {
    const db = this.prisma.forCompany(actor.companyId);
    const trip = await db.trip.findFirst({ where: { id: tripId }, select: { driverId: true } });
    if (!trip) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    if (actor.role === UserRole.DRIVER) {
      const driver = await db.driver.findFirst({
        where: { userId: actor.userId },
        select: { id: true },
      });
      if (!driver || trip.driverId !== driver.id) {
        throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
      }
    }
    return tripId;
  }

  async list(actor: CurrentUserPayload, tripId: string, before?: Date): Promise<ChatMessageView[]> {
    await this.requireTripAccess(actor, tripId);
    const messages = await this.prisma.forCompany(actor.companyId).chatMessage.findMany({
      where: { tripId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
    });

    const senderIds = [...new Set(messages.map((m) => m.senderId).filter(Boolean))] as string[];
    const senders = await this.prisma.forCompany(actor.companyId).user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, fullName: true },
    });
    const nameById = new Map(senders.map((user) => [user.id, user.fullName]));

    // Oldest first: a conversation reads down the screen.
    return messages.reverse().map((message) => ({
      id: message.id,
      tripId: message.tripId,
      senderId: message.senderId,
      senderName: message.senderId ? (nameById.get(message.senderId) ?? null) : null,
      mine: message.senderId === actor.userId,
      kind: message.kind,
      body: message.body,
      fileId: message.fileId,
      readAt: message.readAt,
      createdAt: message.createdAt,
    }));
  }

  async post(
    actor: CurrentUserPayload,
    tripId: string,
    dto: PostMessageDto,
  ): Promise<ChatMessageView> {
    await this.requireTripAccess(actor, tripId);

    const kind = dto.kind ?? ChatMessageKind.TEXT;
    // A text message needs words and an attachment needs a file; neither can
    // stand in for the other, so an empty bubble is impossible.
    if (kind === ChatMessageKind.TEXT ? !dto.body?.trim() : !dto.fileId) {
      throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, {
        field: kind === ChatMessageKind.TEXT ? 'body' : 'fileId',
      });
    }
    if (dto.fileId) await this.requireOwnFile(actor, dto.fileId);

    const created = await this.prisma.forCompany(actor.companyId).chatMessage.create({
      // companyId is stamped by the tenant extension, never taken from input.
      data: {
        tripId,
        senderId: actor.userId,
        kind,
        body: dto.body?.trim() || null,
        fileId: dto.fileId ?? null,
      } as Prisma.ChatMessageUncheckedCreateInput,
    });

    return this.toView(created, actor.userId);
  }

  /** An attachment has to be a file of this company, not a guessed id. */
  private async requireOwnFile(actor: CurrentUserPayload, fileId: string): Promise<void> {
    const file = await this.prisma
      .forCompany(actor.companyId)
      .storedFile.findFirst({ where: { id: fileId }, select: { id: true } });
    if (!file) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  /** Marks the other side's messages read; returns how many were still unread. */
  async markRead(actor: CurrentUserPayload, tripId: string): Promise<{ read: number }> {
    await this.requireTripAccess(actor, tripId);
    const { count } = await this.prisma.forCompany(actor.companyId).chatMessage.updateMany({
      where: { tripId, readAt: null, NOT: { senderId: actor.userId } },
      data: { readAt: new Date() },
    });
    return { read: count };
  }

  /** Unread count for one trip — the badge on the trip card. */
  async unreadCount(actor: CurrentUserPayload, tripId: string): Promise<{ unread: number }> {
    await this.requireTripAccess(actor, tripId);
    const unread = await this.prisma.forCompany(actor.companyId).chatMessage.count({
      where: { tripId, readAt: null, NOT: { senderId: actor.userId } },
    });
    return { unread };
  }

  private toView(message: ChatMessage, actorUserId: string): ChatMessageView {
    return {
      id: message.id,
      tripId: message.tripId,
      senderId: message.senderId,
      senderName: null,
      mine: message.senderId === actorUserId,
      kind: message.kind,
      body: message.body,
      fileId: message.fileId,
      readAt: message.readAt,
      createdAt: message.createdAt,
    };
  }
}
