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

/** Companies without an explicit plan are on the pilot trial (TZ §12.2). */
const TRIAL_PLAN = 'TRIAL';

export interface AdminCompanyOwner {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface AdminCompanyRow extends Company {
  owner: AdminCompanyOwner | null;
  userCount: number;
  tripCount: number;
}

export interface AdminStats {
  companies: number;
  activeCompanies: number;
  trialCompanies: number;
  expiredCompanies: number;
  users: number;
  trips: number;
}

type CompanyWithCounts = Company & {
  _count: { users: number; trips: number };
  users: AdminCompanyOwner[];
};

function toAdminRow(company: CompanyWithCounts): AdminCompanyRow {
  const { _count, users, ...rest } = company;
  return {
    ...rest,
    owner: users[0] ?? null,
    userCount: _count.users,
    tripCount: _count.trips,
  };
}

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

  /**
   * Platform-wide tenant list. Company is the tenant root, so it is one of the
   * few models queried off the bare client — access is gated by the SUPERADMIN
   * role on the controller.
   */
  async adminList(pagination: PaginationDto): Promise<{ data: AdminCompanyRow[]; total: number }> {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          _count: { select: { users: true, trips: true } },
          users: {
            where: { role: 'OWNER' },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { id: true, fullName: true, email: true, phone: true, isActive: true },
          },
        },
      }),
      this.prisma.company.count(),
    ]);
    return { data: data.map(toAdminRow), total };
  }

  async adminGetById(id: string): Promise<AdminCompanyRow> {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true, trips: true } },
        users: {
          where: { role: 'OWNER' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { id: true, fullName: true, email: true, phone: true, isActive: true },
        },
      },
    });
    if (!company) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return toAdminRow(company);
  }

  /** Platform KPI row for the superadmin dashboard. */
  async adminStats(now = new Date()): Promise<AdminStats> {
    const [companies, activeCompanies, trialCompanies, expiredCompanies, users, trips] =
      await this.prisma.$transaction([
        this.prisma.company.count(),
        this.prisma.company.count({ where: { isActive: true } }),
        this.prisma.company.count({
          where: { OR: [{ tariffPlan: null }, { tariffPlan: TRIAL_PLAN }] },
        }),
        this.prisma.company.count({ where: { subscriptionUntil: { lt: now } } }),
        this.prisma.user.count(),
        this.prisma.trip.count(),
      ]);
    return { companies, activeCompanies, trialCompanies, expiredCompanies, users, trips };
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
