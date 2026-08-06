import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_TTL_DAYS = 30;
const AFTER_UNLOADING_GRACE_DAYS = 7;

/** What the cargo owner may see — no driver phone, prices or company internals. */
export interface PublicTrackView {
  tripNumber: string;
  status: string;
  cargoName: string | null;
  loadingAddress: string | null;
  loadingDate: Date | null;
  unloadingAddress: string | null;
  unloadingDate: Date | null;
  stage: string | null;
  lastPosition: { lat: number; lng: number; recordedAt: Date } | null;
}

@Injectable()
export class PublicLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** TZ §4.2: logist creates a login-free tracking link for the client. */
  async createLink(
    actor: CurrentUserPayload,
    tripId: string,
  ): Promise<{ url: string; token: string; expiresAt: Date }> {
    const trip = await this.prisma
      .forCompany(actor.companyId)
      .trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

    const token = randomBytes(24).toString('hex');
    const base = trip.unloadingDate
      ? new Date(trip.unloadingDate.getTime() + AFTER_UNLOADING_GRACE_DAYS * 86_400_000)
      : new Date(Date.now() + DEFAULT_TTL_DAYS * 86_400_000);

    const link = await this.prisma.trackingLink.create({
      data: {
        companyId: actor.companyId as string,
        tripId: trip.id,
        token,
        expiresAt: base,
      },
    });
    const webUrl = this.config.get<string>('WEB_URL') ?? '';
    return { url: `${webUrl}/track/${token}`, token, expiresAt: link.expiresAt };
  }

  /** Unauthenticated view — token IS the credential, response is sanitized. */
  async publicView(token: string): Promise<PublicTrackView> {
    const link = await this.prisma.trackingLink.findUnique({
      where: { token },
      include: { trip: true },
    });
    if (!link || link.expiresAt < new Date()) {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const trip = link.trip;

    const [lastEvent, lastPosition] = await Promise.all([
      this.prisma.tripEvent.findFirst({
        where: { tripId: trip.id, companyId: link.companyId },
        orderBy: { eventTime: 'desc' },
      }),
      this.prisma.gpsTrack.findFirst({
        where: { tripId: trip.id, companyId: link.companyId },
        orderBy: { recordedAt: 'desc' },
      }),
    ]);

    return {
      tripNumber: trip.tripNumber,
      status: trip.status,
      cargoName: trip.cargoName,
      loadingAddress: trip.loadingAddress,
      loadingDate: trip.loadingDate,
      unloadingAddress: trip.unloadingAddress,
      unloadingDate: trip.unloadingDate,
      stage: lastEvent?.eventType ?? null,
      lastPosition: lastPosition
        ? { lat: lastPosition.lat, lng: lastPosition.lng, recordedAt: lastPosition.recordedAt }
        : null,
    };
  }
}
