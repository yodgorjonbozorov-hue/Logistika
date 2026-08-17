import { HttpStatus, Injectable } from '@nestjs/common';
import type { Expense, Income, Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { requireTenantActor } from '../../common/tenant-actor';
import { toAuditJson } from '../audit/audit.service';
import { assertTenantRefs } from '../../common/tenant-refs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateExpenseDto,
  CreateIncomeDto,
  ListExpensesDto,
  UpdateExpenseDto,
  UpdateIncomeDto,
} from './dto/expense.dto';

/**
 * Create needs the required fields typed as present; the shared converter below
 * makes everything optional because it also serves partial updates.
 */
function toExpenseCreateData(dto: CreateExpenseDto) {
  const { amount, unitPrice, expenseDate, ...rest } = dto;
  return {
    ...rest,
    amount: BigInt(amount),
    unitPrice: unitPrice === undefined ? undefined : BigInt(unitPrice),
    expenseDate: new Date(expenseDate),
  };
}

function toIncomeCreateData(dto: CreateIncomeDto) {
  const { amount, paymentDate, ...rest } = dto;
  return {
    ...rest,
    amount: BigInt(amount),
    paymentDate: paymentDate === undefined ? undefined : new Date(paymentDate),
  };
}

function toExpenseData(dto: CreateExpenseDto | UpdateExpenseDto) {
  const { amount, unitPrice, expenseDate, ...rest } = dto;
  return {
    ...rest,
    amount: amount === undefined ? undefined : BigInt(amount),
    unitPrice: unitPrice === undefined ? undefined : BigInt(unitPrice),
    expenseDate: expenseDate === undefined ? undefined : new Date(expenseDate),
  };
}

function toIncomeData(dto: CreateIncomeDto | UpdateIncomeDto) {
  const { amount, paymentDate, ...rest } = dto;
  return {
    ...rest,
    amount: amount === undefined ? undefined : BigInt(amount),
    paymentDate: paymentDate === undefined ? undefined : new Date(paymentDate),
  };
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Expenses ----------

  async listExpenses(
    actor: CurrentUserPayload,
    filter: ListExpensesDto,
  ): Promise<{ data: Expense[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.ExpenseWhereInput = {
      tripId: filter.tripId,
      vehicleId: filter.vehicleId,
      category: filter.category,
    };
    const [data, total] = await Promise.all([
      db.expense.findMany({
        where,
        orderBy: { expenseDate: 'desc' },
        skip: filter.skip,
        take: filter.limit,
      }),
      db.expense.count({ where }),
    ]);
    return { data, total };
  }

  async createExpense(actor: CurrentUserPayload, dto: CreateExpenseDto): Promise<Expense> {
    const tenant = requireTenantActor(actor);
    await assertTenantRefs(this.prisma.forCompany(tenant.companyId), dto);
    try {
      // The row and its audit entry are written together: a money record whose
      // author was lost to a failed side-write is not auditable.
      return await this.prisma.forCompanyTx(tenant.companyId, async (tx) => {
        const expense = await tx.expense.create({
          data: {
            ...toExpenseCreateData(dto),
            companyId: tenant.companyId,
            createdById: tenant.userId,
          },
        });
        await this.audit.logInTx(tx, {
          companyId: tenant.companyId,
          userId: tenant.userId,
          action: 'CREATE',
          entityType: 'Expense',
          entityId: expense.id,
          after: toAuditJson(expense),
        });
        return expense;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async updateExpense(
    actor: CurrentUserPayload,
    id: string,
    dto: UpdateExpenseDto,
  ): Promise<Expense> {
    const existing = await this.prisma
      .forCompany(actor.companyId)
      .expense.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    // An approved expense is part of the financial record — no silent edits.
    if (existing.isApproved) throw new AppException('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
    await assertTenantRefs(this.prisma.forCompany(actor.companyId), dto);
    try {
      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        const expense = await tx.expense.update({ where: { id }, data: toExpenseData(dto) });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'UPDATE',
          entityType: 'Expense',
          entityId: id,
          before: toAuditJson(existing),
          after: toAuditJson(expense),
        });
        return expense;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async approveExpense(actor: CurrentUserPayload, id: string): Promise<Expense> {
    try {
      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        const expense = await tx.expense.update({ where: { id }, data: { isApproved: true } });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'APPROVE',
          entityType: 'Expense',
          entityId: id,
          after: { amount: expense.amount.toString(), category: expense.category },
        });
        return expense;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async removeExpense(actor: CurrentUserPayload, id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma
      .forCompany(actor.companyId)
      .expense.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    if (existing.isApproved) throw new AppException('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
    await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
      await tx.expense.delete({ where: { id } });
      await this.audit.logInTx(tx, {
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'DELETE',
        entityType: 'Expense',
        entityId: id,
        // The whole row: once deleted this is the only copy of what it said.
        before: toAuditJson(existing),
      });
    });
    return { deleted: true };
  }

  // ---------- Incomes ----------

  async listIncomes(
    actor: CurrentUserPayload,
    pagination: ListExpensesDto,
  ): Promise<{ data: Income[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.IncomeWhereInput = { tripId: pagination.tripId };
    const [data, total] = await Promise.all([
      db.income.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      db.income.count({ where }),
    ]);
    return { data, total };
  }

  async createIncome(actor: CurrentUserPayload, dto: CreateIncomeDto): Promise<Income> {
    const tenant = requireTenantActor(actor);
    await assertTenantRefs(this.prisma.forCompany(tenant.companyId), dto);
    try {
      return await this.prisma.forCompanyTx(tenant.companyId, async (tx) => {
        const income = await tx.income.create({
          data: { ...toIncomeCreateData(dto), companyId: tenant.companyId },
        });
        await this.audit.logInTx(tx, {
          companyId: tenant.companyId,
          userId: tenant.userId,
          action: 'CREATE',
          entityType: 'Income',
          entityId: income.id,
          after: toAuditJson(income),
        });
        return income;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async updateIncome(actor: CurrentUserPayload, id: string, dto: UpdateIncomeDto): Promise<Income> {
    const db = this.prisma.forCompany(actor.companyId);
    await assertTenantRefs(db, dto);
    const existing = await db.income.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    try {
      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        const income = await tx.income.update({ where: { id }, data: toIncomeData(dto) });
        await this.audit.logInTx(tx, {
          companyId: actor.companyId,
          userId: actor.userId,
          action: 'UPDATE',
          entityType: 'Income',
          entityId: id,
          // Payment status changes used to leave no trace at all.
          before: toAuditJson(existing),
          after: toAuditJson(income),
        });
        return income;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }
}
