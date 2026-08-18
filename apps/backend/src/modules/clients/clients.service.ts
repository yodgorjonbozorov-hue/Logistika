import { HttpStatus, Injectable } from '@nestjs/common';
import type { Client } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { CatalogueListDto } from '../../common/dto/catalogue.dto';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { ACTIVE_TRIP_STATUSES } from '../../common/trip-transitions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, toAuditJson } from '../audit/audit.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: CurrentUserPayload,
    pagination: CatalogueListDto,
  ): Promise<{ data: Client[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    // Retired records leave the working list but stay reachable with
    // ?includeInactive=true — the history is the reason they were kept.
    const where = { isActive: pagination.activeFilter };
    const [data, total] = await Promise.all([
      db.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      db.client.count({ where }),
    ]);
    return { data, total };
  }

  async create(actor: CurrentUserPayload, dto: CreateClientDto): Promise<Client> {
    try {
      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        // companyId satisfies the type; the tenant extension enforces the same value.
        const client = await tx.client.create({
          data: { ...dto, companyId: actor.companyId as string },
        });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'CREATE',
          entityType: 'Client',
          entityId: client.id,
          after: toAuditJson(client),
        });
        return client;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async getById(actor: CurrentUserPayload, id: string): Promise<Client> {
    const client = await this.prisma
      .forCompany(actor.companyId)
      .client.findUnique({ where: { id } });
    if (!client) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return client;
  }

  async update(actor: CurrentUserPayload, id: string, dto: UpdateClientDto): Promise<Client> {
    // Client.balance lives on this row — every change to it needs an author.
    const before = await this.getById(actor, id);
    try {
      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        const client = await tx.client.update({ where: { id }, data: dto });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'UPDATE',
          entityType: 'Client',
          entityId: id,
          before: toAuditJson(before),
          after: toAuditJson(client),
        });
        return client;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /**
   * Soft delete — clients keep their trips, invoices and ledger history.
   *
   * This used to be a hard DELETE. The foreign keys made it fail once anything
   * pointed at the client, which hid the real problem: it *succeeded* for a
   * client with nothing attached, and that row vanished completely — the audit
   * `before` was the only remaining trace that the counterparty had existed.
   */
  async deactivate(actor: CurrentUserPayload, id: string): Promise<Client> {
    const before = await this.getById(actor, id);
    await this.assertNothingOutstanding(actor, before);
    try {
      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        const client = await tx.client.update({ where: { id }, data: { isActive: false } });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'DEACTIVATE',
          entityType: 'Client',
          entityId: id,
          before: toAuditJson(before),
          after: toAuditJson(client),
        });
        return client;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /**
   * Refuses to retire a client the company is still entangled with.
   *
   * Two reasons, both about not losing sight of money:
   *
   *  - an unsettled balance. A retired client drops out of the list, and with
   *    it the debt — the one number somebody has to keep chasing.
   *  - a trip that is planned or under way. Its invoice has not been raised or
   *    not been paid, and it is about to become that same debt.
   */
  private async assertNothingOutstanding(actor: CurrentUserPayload, client: Client): Promise<void> {
    if (client.balance !== 0n) {
      throw new AppException('RESOURCE_IN_USE', HttpStatus.CONFLICT, undefined, {
        reason: 'balance',
        balance: client.balance.toString(),
      });
    }

    const active = await this.prisma.forCompany(actor.companyId).trip.findFirst({
      where: { clientId: client.id, status: { in: ACTIVE_TRIP_STATUSES } },
      select: { id: true, tripNumber: true, status: true },
    });
    if (active) {
      throw new AppException('RESOURCE_IN_USE', HttpStatus.CONFLICT, undefined, {
        reason: 'trip',
        tripId: active.id,
        tripNumber: active.tripNumber,
        status: active.status,
      });
    }
  }
}
