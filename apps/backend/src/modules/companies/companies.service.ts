import { HttpStatus, Injectable } from '@nestjs/common';
import type { Company, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdminCreateCompanyDto, AdminUpdateCompanyDto } from './dto/admin-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getOwn(companyId: string | null): Promise<Company> {
    if (!companyId) throw new AppException('TENANT_MISSING', HttpStatus.FORBIDDEN);
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return company;
  }

  async updateOwn(
    companyId: string | null,
    userId: string,
    dto: UpdateCompanyDto,
  ): Promise<Company> {
    const before = await this.getOwn(companyId);
    const company = await this.prisma.company.update({ where: { id: before.id }, data: dto });
    this.audit.log({
      companyId: before.id,
      userId,
      action: 'UPDATE',
      entityType: 'Company',
      entityId: before.id,
      before: { name: before.name, phone: before.phone, address: before.address },
      after: dto as Prisma.InputJsonValue,
    });
    return company;
  }

  // ---------- SUPERADMIN ----------

  async adminList(pagination: PaginationDto): Promise<{ data: Company[]; total: number }> {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.company.count(),
    ]);
    return { data, total };
  }

  /** Creates a tenant together with its first OWNER user (one transaction). */
  async adminCreate(adminUserId: string, dto: AdminCreateCompanyDto): Promise<Company> {
    const passwordHash = await argon2.hash(dto.owner.password);
    try {
      const company = await this.prisma.$transaction(async (tx) => {
        const created = await tx.company.create({
          data: {
            name: dto.name,
            tariffPlan: dto.tariffPlan,
            subscriptionUntil: dto.subscriptionUntil ? new Date(dto.subscriptionUntil) : null,
          },
        });
        await tx.user.create({
          data: {
            companyId: created.id,
            fullName: dto.owner.fullName,
            email: dto.owner.email,
            passwordHash,
            role: 'OWNER',
          },
        });
        return created;
      });
      this.audit.log({
        companyId: company.id,
        userId: adminUserId,
        action: 'CREATE',
        entityType: 'Company',
        entityId: company.id,
        after: { name: company.name, tariffPlan: company.tariffPlan },
      });
      return company;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async adminUpdate(adminUserId: string, id: string, dto: AdminUpdateCompanyDto): Promise<Company> {
    try {
      const company = await this.prisma.company.update({
        where: { id },
        data: {
          tariffPlan: dto.tariffPlan,
          subscriptionUntil: dto.subscriptionUntil ? new Date(dto.subscriptionUntil) : undefined,
          isActive: dto.isActive,
        },
      });
      this.audit.log({
        companyId: id,
        userId: adminUserId,
        action: 'UPDATE',
        entityType: 'Company',
        entityId: id,
        after: dto as Prisma.InputJsonValue,
      });
      return company;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }
}
