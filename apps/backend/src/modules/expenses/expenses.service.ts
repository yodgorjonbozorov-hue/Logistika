import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Expense, type Income } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
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

/** Money snapshots for the audit trail — BigInt is not JSON-serialisable. */
function expenseSnapshot(expense: Expense): Prisma.InputJsonValue {
  return {
    amount: expense.amount.toString(),
    currency: expense.currency,
    category: expense.category,
    tripId: expense.tripId,
    vehicleId: expense.vehicleId,
    driverId: expense.driverId,
    expenseDate: expense.expenseDate.toISOString(),
    description: expense.description,
    isApproved: expense.isApproved,
  };
}

function incomeSnapshot(income: Income): Prisma.InputJsonValue {
  return {
    amount: income.amount.toString(),
    currency: income.currency,
    status: income.status,
    tripId: income.tripId,
    clientId: income.clientId,
    invoiceNumber: income.invoiceNumber,
    paymentDate: income.paymentDate?.toISOString() ?? null,
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
    await this.assertRefsInTenant(actor, dto);

    // H-3: a retried POST (double click, mobile retry, flaky link) must not
    // book the money twice. The unique (company_id, client_tx_id) index is the
    // real guard; this lookup just turns the race into the same happy answer.
    if (dto.clientTxId) {
      const existing = await this.prisma
        .forCompany(actor.companyId)
        .expense.findFirst({ where: { clientTxId: dto.clientTxId } });
      if (existing) return existing;
    }

    try {
      const expense = await this.prisma.forCompany(actor.companyId).expense.create({
        data: {
          ...toExpenseData(dto),
          createdById: actor.userId,
        } as Prisma.ExpenseUncheckedCreateInput,
      });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'Expense',
        entityId: expense.id,
        after: expenseSnapshot(expense),
      });
      return expense;
    } catch (error) {
      // Lost the idempotency race: the winner's row is the correct answer.
      if (
        dto.clientTxId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma
          .forCompany(actor.companyId)
          .expense.findFirst({ where: { clientTxId: dto.clientTxId } });
        if (winner) return winner;
      }
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
    await this.assertRefsInTenant(actor, dto);
    try {
      const expense = await this.prisma
        .forCompany(actor.companyId)
        .expense.update({ where: { id }, data: toExpenseData(dto) });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'UPDATE',
        entityType: 'Expense',
        entityId: id,
        before: expenseSnapshot(existing),
        after: expenseSnapshot(expense),
      });
      return expense;
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
    // M-3: money never leaves the system without a trace — the full row is
    // captured in `before` so a deletion can be reconstructed and questioned.
    this.audit.log({
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'DELETE',
      entityType: 'Expense',
      entityId: id,
      before: expenseSnapshot(existing),
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
    await this.assertRefsInTenant(actor, dto);

    if (dto.clientTxId) {
      const existing = await this.prisma
        .forCompany(actor.companyId)
        .income.findFirst({ where: { clientTxId: dto.clientTxId } });
      if (existing) return existing;
    }

    try {
      const income = await this.prisma.forCompany(actor.companyId).income.create({
        data: toIncomeData(dto) as Prisma.IncomeUncheckedCreateInput,
      });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'Income',
        entityId: income.id,
        after: incomeSnapshot(income),
      });
      return income;
    } catch (error) {
      if (
        dto.clientTxId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma
          .forCompany(actor.companyId)
          .income.findFirst({ where: { clientTxId: dto.clientTxId } });
        if (winner) return winner;
      }
      rethrowPrismaError(error);
    }
  }

  async updateIncome(actor: CurrentUserPayload, id: string, dto: UpdateIncomeDto): Promise<Income> {
    const existing = await this.prisma
      .forCompany(actor.companyId)
      .income.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.assertRefsInTenant(actor, dto);
    try {
      const income = await this.prisma
        .forCompany(actor.companyId)
        .income.update({ where: { id }, data: toIncomeData(dto) });
      this.audit.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'UPDATE',
        entityType: 'Income',
        entityId: id,
        before: incomeSnapshot(existing),
        after: incomeSnapshot(income),
      });
      return income;
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /**
   * H-2: every foreign key on a money row must point inside the caller's own
   * tenant. Prisma would happily accept another company's tripId — the FK
   * itself only checks that the row exists *somewhere* — which both leaks the
   * existence of foreign records and corrupts the other company's P&L.
   *
   * The lookups run through the tenant-scoped client, so a foreign id is
   * indistinguishable from a missing one (no cross-tenant enumeration).
   */
  private async assertRefsInTenant(
    actor: CurrentUserPayload,
    refs: { tripId?: string; vehicleId?: string; driverId?: string; clientId?: string },
  ): Promise<void> {
    const db = this.prisma.forCompany(actor.companyId);
    const checks: Array<[string | undefined, () => Promise<{ id: string } | null>]> = [
      [
        refs.tripId,
        () => db.trip.findUnique({ where: { id: refs.tripId! }, select: { id: true } }),
      ],
      [
        refs.vehicleId,
        () => db.vehicle.findUnique({ where: { id: refs.vehicleId! }, select: { id: true } }),
      ],
      [
        refs.driverId,
        () => db.driver.findUnique({ where: { id: refs.driverId! }, select: { id: true } }),
      ],
      [
        refs.clientId,
        () => db.client.findUnique({ where: { id: refs.clientId! }, select: { id: true } }),
      ],
    ];
    for (const [id, lookup] of checks) {
      if (id && !(await lookup())) {
        throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, undefined, { id });
      }
    }
  }
}
