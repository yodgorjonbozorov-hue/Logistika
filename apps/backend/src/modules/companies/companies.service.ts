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

  /**
   * Order matters: children before parents, and rows that reference other rows
   * of the same tenant before the rows they point at. Postgres has no cascade
   * on these relations — that is deliberate, so nothing can be deleted by
   * accident — which means the order has to be spelled out here.
   */
  private static readonly TENANT_TABLES = [
    'gps_track_archive',
    'gps_tracks',
    'tracking_links',
    'trip_events',
    'fuel_logs',
    'expenses',
    'incomes',
    'documents',
    'notifications',
    'maintenances',
    'audit_logs',
    'stored_files',
    'trips',
    'drivers',
    'vehicles',
    'clients',
  ] as const;

  /**
   * Removes a tenant and everything under it, in one transaction.
   *
   * Guarded by the company's own name: the caller has to type it back, so a
   * mis-clicked row id cannot wipe a live customer. Refresh tokens go first —
   * they hang off users, which hang off the company.
   */
  async adminDelete(
    adminUserId: string,
    id: string,
    confirmName: string,
  ): Promise<{ deleted: boolean; name: string }> {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    if (confirmName.trim() !== company.name) {
      throw new AppException('CONFIRMATION_MISMATCH', HttpStatus.BAD_REQUEST);
    }

    await this.prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({ where: { companyId: id }, select: { id: true } });
      const userIds = users.map((user) => user.id);
      if (userIds.length > 0) {
        await tx.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      }
      for (const table of CompaniesService.TENANT_TABLES) {
        await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE company_id = $1`, id);
      }
      await tx.user.deleteMany({ where: { companyId: id } });
      await tx.company.delete({ where: { id } });
    });

    // Logged after the fact and without a companyId: the company it referred to
    // no longer exists, and the audit row must not dangle.
    this.audit.log({
      companyId: null,
      userId: adminUserId,
      action: 'DELETE',
      entityType: 'Company',
      entityId: id,
      before: { name: company.name },
    });
    return { deleted: true, name: company.name };
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
