import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Expense, Income, Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateExpenseDto,
  CreateIncomeDto,
  ListExpensesDto,
  UpdateExpenseDto,
  UpdateIncomeDto,
} from './dto/expense.dto';

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
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
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
    try {
      return await this.prisma.forCompany(actor.companyId).expense.create({
        data: {
          ...toExpenseData(dto),
          createdById: actor.userId,
        } as Prisma.ExpenseUncheckedCreateInput,
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
    try {
      return await this.prisma
        .forCompany(actor.companyId)
        .expense.update({ where: { id }, data: toExpenseData(dto) });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async approveExpense(actor: CurrentUserPayload, id: string): Promise<Expense> {
    try {
      const expense = await this.prisma
        .forCompany(actor.companyId)
        .expense.update({ where: { id }, data: { isApproved: true } });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'APPROVE',
        entityType: 'Expense',
        entityId: id,
        after: { amount: expense.amount.toString(), category: expense.category },
      });
      return expense;
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
    await this.prisma.forCompany(actor.companyId).expense.delete({ where: { id } });
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
    try {
      return await this.prisma.forCompany(actor.companyId).income.create({
        data: toIncomeData(dto) as Prisma.IncomeUncheckedCreateInput,
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  async updateIncome(actor: CurrentUserPayload, id: string, dto: UpdateIncomeDto): Promise<Income> {
    try {
      return await this.prisma
        .forCompany(actor.companyId)
        .income.update({ where: { id }, data: toIncomeData(dto) });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /**
   * Daily payment control (W-10 «Mijoz to'lovi kechikdi»): an unpaid income is
   * overdue once its own paymentDate has passed, or the trip finished more
   * than the client's payment-terms days ago. Marks OVERDUE + raises an alert.
   */
  @Cron('0 5 * * *')
  async markOverdueIncomes(): Promise<void> {
    try {
      const now = new Date();
      const companies = await this.prisma.company.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      for (const company of companies) {
        const db = this.prisma.forCompany(company.id);
        const candidates = await db.income.findMany({
          where: { status: { in: ['PENDING', 'PARTIAL'] } },
          include: { client: true, trip: true },
        });
        for (const income of candidates) {
          let due: Date | null = income.paymentDate;
          if (!due && income.trip?.finishedAt && income.client?.paymentTermsDays != null) {
            due = new Date(
              income.trip.finishedAt.getTime() +
                income.client.paymentTermsDays * 24 * 60 * 60 * 1000,
            );
          }
          if (!due || due >= now) continue;
          await db.income.update({ where: { id: income.id }, data: { status: 'OVERDUE' } });
          await this.alerts.raise(company.id, {
            type: 'PAYMENT_OVERDUE',
            params: {
              clientName: income.client?.name ?? '—',
              amount: income.amount.toString(),
              invoiceNumber: income.invoiceNumber ?? '—',
            },
            relatedType: 'Income',
            relatedId: income.id,
          });
        }
      }
    } catch (error) {
      this.logger.error(
        `Overdue income check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
