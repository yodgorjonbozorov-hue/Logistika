import { HttpStatus, Injectable } from '@nestjs/common';
import type { Client } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
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
      // companyId satisfies the type; the tenant extension enforces the same value.
      const created = await this.prisma
        .forCompany(actor.companyId)
        .client.create({ data: { ...dto, companyId: actor.companyId as string } });
      this.audit.record(actor, 'CREATE', 'Client', created);
      return created;
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
      const before = await this.getById(actor, id);
      const updated = await this.prisma
        .forCompany(actor.companyId)
        .client.update({ where: { id }, data: dto });
      this.audit.record(actor, 'UPDATE', 'Client', updated, before);
      return updated;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /** Hard delete; blocked by FK (RESOURCE_IN_USE) once trips/incomes reference the client. */
  async remove(actor: CurrentUserPayload, id: string): Promise<{ deleted: boolean }> {
    try {
      const before = await this.getById(actor, id);
      await this.prisma.forCompany(actor.companyId).client.delete({ where: { id } });
      this.audit.record(actor, 'DELETE', 'Client', before);
      return { deleted: true };
    } catch (error) {
      rethrowPrismaError(error);
    }
  }
}
