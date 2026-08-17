import { HttpStatus, Injectable } from '@nestjs/common';
import type { Client } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { rethrowPrismaError } from '../../common/prisma-errors';
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
    pagination: PaginationDto,
  ): Promise<{ data: Client[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const [data, total] = await Promise.all([
      db.client.findMany({
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      db.client.count(),
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

  /** Hard delete; blocked by FK (RESOURCE_IN_USE) once trips/incomes reference the client. */
  async remove(actor: CurrentUserPayload, id: string): Promise<{ deleted: boolean }> {
    const before = await this.getById(actor, id);
    try {
      await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        await tx.client.delete({ where: { id } });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'DELETE',
          entityType: 'Client',
          entityId: id,
          // The whole row: once deleted this is the only record of what it said.
          before: toAuditJson(before),
        });
      });
      return { deleted: true };
    } catch (error) {
      rethrowPrismaError(error);
    }
  }
}
