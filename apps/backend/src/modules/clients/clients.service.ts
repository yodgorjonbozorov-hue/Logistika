import { HttpStatus, Injectable } from '@nestjs/common';
import type { Client } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

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

  /**
   * W-7 qarzdorlar: every client with unpaid (non-PAID) incomes and the
   * outstanding total — deterministic aggregation, biggest debts first.
   */
  async receivables(actor: CurrentUserPayload): Promise<
    Array<{
      clientId: string;
      name: string;
      phone: string | null;
      paymentTermsDays: number | null;
      outstanding: bigint;
      overdue: bigint;
      invoiceCount: number;
    }>
  > {
    const db = this.prisma.forCompany(actor.companyId);
    const incomes = await db.income.findMany({
      where: { status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] }, clientId: { not: null } },
      include: { client: true },
    });

    const byClient = new Map<
      string,
      {
        clientId: string;
        name: string;
        phone: string | null;
        paymentTermsDays: number | null;
        outstanding: bigint;
        overdue: bigint;
        invoiceCount: number;
      }
    >();
    for (const income of incomes) {
      if (!income.clientId || !income.client) continue;
      const entry = byClient.get(income.clientId) ?? {
        clientId: income.clientId,
        name: income.client.name,
        phone: income.client.phone,
        paymentTermsDays: income.client.paymentTermsDays,
        outstanding: 0n,
        overdue: 0n,
        invoiceCount: 0,
      };
      entry.outstanding += income.amount;
      if (income.status === 'OVERDUE') entry.overdue += income.amount;
      entry.invoiceCount += 1;
      byClient.set(income.clientId, entry);
    }
    return [...byClient.values()].sort((a, b) => (a.outstanding > b.outstanding ? -1 : 1));
  }

  async create(actor: CurrentUserPayload, dto: CreateClientDto): Promise<Client> {
    try {
      // companyId satisfies the type; the tenant extension enforces the same value.
      return await this.prisma
        .forCompany(actor.companyId)
        .client.create({ data: { ...dto, companyId: actor.companyId as string } });
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
    try {
      return await this.prisma
        .forCompany(actor.companyId)
        .client.update({ where: { id }, data: dto });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /** Hard delete; blocked by FK (RESOURCE_IN_USE) once trips/incomes reference the client. */
  async remove(actor: CurrentUserPayload, id: string): Promise<{ deleted: boolean }> {
    try {
      await this.prisma.forCompany(actor.companyId).client.delete({ where: { id } });
      return { deleted: true };
    } catch (error) {
      rethrowPrismaError(error);
    }
  }
}
