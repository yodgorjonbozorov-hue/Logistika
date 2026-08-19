import { HttpStatus, Injectable } from '@nestjs/common';
import type { Client } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

/**
 * `clients.balance` is DERIVED, never stored (M-2).
 *
 * The column existed but nothing ever wrote to it, so every screen confidently
 * showed 0 — worse than showing nothing. The single source of truth is the
 * income ledger: what the client still owes is the sum of their incomes that
 * are not yet PAID.
 */
const OUTSTANDING_STATUSES = ['PENDING', 'PARTIAL', 'OVERDUE'] as const;

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
    return { data: await this.withBalances(actor, data), total };
  }

  /**
   * Fills in the derived balance for a page of clients with ONE grouped query
   * rather than a query per row.
   */
  private async withBalances(actor: CurrentUserPayload, clients: Client[]): Promise<Client[]> {
    if (clients.length === 0) return clients;
    const grouped = await this.prisma.forCompany(actor.companyId).income.groupBy({
      by: ['clientId'],
      where: {
        clientId: { in: clients.map((c) => c.id) },
        status: { in: [...OUTSTANDING_STATUSES] },
      },
      _sum: { amount: true },
    });
    const owedByClient = new Map(grouped.map((row) => [row.clientId, row._sum.amount ?? 0n]));
    return clients.map((client) => ({ ...client, balance: owedByClient.get(client.id) ?? 0n }));
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
    return (await this.withBalances(actor, [client]))[0]!;
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
