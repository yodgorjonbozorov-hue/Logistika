import { HttpStatus, Injectable } from '@nestjs/common';
import type { Currency, Expense, Income, Prisma } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { rethrowPrismaError } from '../../common/prisma-errors';
import { requireTenantActor } from '../../common/tenant-actor';
import { toAuditJson } from '../audit/audit.service';
import { CurrencyService } from '../currency/currency.service';
import { LedgerService } from '../ledger/ledger.service';
import { assertTenantRefs } from '../../common/tenant-refs';
import { PrismaService, type TenantScopedClient } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateExpenseDto,
  CreateIncomeDto,
  ListExpensesDto,
  UpdateExpenseDto,
  UpdateIncomeDto,
} from './dto/expense.dto';
import { readPage, type Page } from '../../common/dto/pagination.dto';

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
    private readonly ledger: LedgerService,
    private readonly currency: CurrencyService,
  ) {}

  /**
   * Re-freezes the UZS value of a row that is being edited.
   *
   * Only when the edit actually touches the amount, the currency or the date
   * the rate is read from. Re-running the conversion on every save would
   * restate rows at today's rate and quietly change numbers a report has
   * already shown — the whole point of freezing it is that it does not move.
   */
  private async reconvert(
    existing: { amount: bigint; currency: Currency },
    next: { amount?: bigint; currency?: Currency; on: Date; dateChanged: boolean },
  ): Promise<{
    amountBase: bigint;
    rateUsed: Prisma.Decimal | null;
    rateDate: Date | null;
  } | null> {
    const amount = next.amount ?? existing.amount;
    const currency = next.currency ?? existing.currency;
    if (amount === existing.amount && currency === existing.currency && !next.dateChanged) {
      return null;
    }
    return this.currency.toBase(amount, currency, next.on);
  }

  // ---------- Expenses ----------

  async listExpenses(actor: CurrentUserPayload, filter: ListExpensesDto): Promise<Page<Expense>> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.ExpenseWhereInput = {
      tripId: filter.tripId,
      vehicleId: filter.vehicleId,
      category: filter.category,
    };
    return readPage(
      filter,
      (page) =>
        db.expense.findMany({
          where,
          orderBy: { expenseDate: 'desc' },
          ...page,
        }),
      () => db.expense.count({ where }),
    );
  }

  async createExpense(actor: CurrentUserPayload, dto: CreateExpenseDto): Promise<Expense> {
    const tenant = requireTenantActor(actor);
    await assertTenantRefs(this.prisma.forCompany(tenant.companyId), dto);
    try {
      // The row and its audit entry are written together: a money record whose
      // author was lost to a failed side-write is not auditable.
      const data = toExpenseCreateData(dto);
      // Frozen at write time: a report run next year must show the same number
      // it showed today, whatever the rate has done since.
      const converted = await this.currency.toBase(
        data.amount,
        data.currency ?? 'UZS',
        data.expenseDate,
      );

      return await this.prisma.forCompanyTx(tenant.companyId, async (tx) => {
        const expense = await tx.expense.create({
          data: {
            ...data,
            amountBase: converted.amountBase,
            rateUsed: converted.rateUsed,
            rateDate: converted.rateDate,
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
      const changes = toExpenseData(dto);
      // Editing the amount without re-freezing the base left the row saying
      // "200 USD" and "1 250 000 tiyin" at the same time, and every report sums
      // the second one.
      const converted = await this.reconvert(existing, {
        ...changes,
        on: changes.expenseDate ?? existing.expenseDate,
        dateChanged: changes.expenseDate !== undefined,
      });

      return await this.prisma.forCompanyTx(actor.companyId, async (tx) => {
        // The version read above is part of the WHERE clause, so an approval —
        // or another edit — that landed since the read makes this write miss
        // instead of silently overwriting a decision it never saw.
        const { count } = await tx.expense.updateMany({
          where: { id, isApproved: false, version: existing.version },
          data: { ...changes, ...converted, version: { increment: 1 } },
        });
        if (count === 0) {
          throw new AppException('RESOURCE_CONFLICT', HttpStatus.CONFLICT, undefined, {
            expectedVersion: existing.version,
          });
        }
        const expense = await tx.expense.findUniqueOrThrow({ where: { id } });
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
        // Guarded on the current flag: two approvals racing must not both
        // succeed and write two audit entries for one approval.
        const { count } = await tx.expense.updateMany({
          where: { id, isApproved: false },
          data: { isApproved: true, version: { increment: 1 } },
        });
        if (count === 0) {
          throw new AppException('RESOURCE_CONFLICT', HttpStatus.CONFLICT, undefined, {
            reason: 'the expense is already approved or does not exist',
          });
        }
        const expense = await tx.expense.findUniqueOrThrow({ where: { id } });
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

  /**
   * Cancels an expense with a mirrored row (L-8).
   *
   * `amount` is unsigned by design and an approved expense is immutable, which
   * together left no way to correct one at all: a supplier refund, or a receipt
   * entered as 5 000 000 instead of 500 000, simply could not be recorded.
   *
   * The original stays exactly as it was written — that is the point of a
   * financial record — and the reversal cancels it. A reversed pair sums to
   * nothing, so a cost report nets them out with no sign convention to get
   * wrong. Correcting an amount is a reversal plus a fresh expense, the same
   * shape the ledger uses for a corrected payment.
   */
  async reverseExpense(actor: CurrentUserPayload, id: string, reason: string): Promise<Expense> {
    const tenant = requireTenantActor(actor);
    const original = await this.prisma
      .forCompany(tenant.companyId)
      .expense.findUnique({ where: { id } });
    if (!original) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    if (original.reversalOfId) {
      throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
        'a reversal cannot itself be reversed',
      ]);
    }

    try {
      return await this.prisma.forCompanyTx(tenant.companyId, async (tx) => {
        const {
          id: _id,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          version: _version,
          ...copy
        } = original;
        const reversal = await tx.expense.create({
          data: {
            ...copy,
            // The unique index is the guarantee: two reversals racing would
            // cancel the same cost twice.
            reversalOfId: original.id,
            isApproved: false,
            description: reason,
            createdById: tenant.userId,
          },
        });
        await this.audit.logInTx(tx, {
          companyId: tenant.companyId,
          userId: tenant.userId,
          action: 'REVERSE',
          entityType: 'Expense',
          entityId: original.id,
          before: toAuditJson(original),
          after: toAuditJson(reversal),
        });
        return reversal;
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
      // Same guard as the edit: an approval racing the delete must win, or an
      // approved expense disappears from the financial record.
      const { count } = await tx.expense.deleteMany({ where: { id, isApproved: false } });
      if (count === 0) {
        throw new AppException('RESOURCE_CONFLICT', HttpStatus.CONFLICT, undefined, {
          reason: 'the expense was approved while it was being deleted',
        });
      }
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

  async listIncomes(actor: CurrentUserPayload, pagination: ListExpensesDto): Promise<Page<Income>> {
    const db = this.prisma.forCompany(actor.companyId);
    const where: Prisma.IncomeWhereInput = { tripId: pagination.tripId };
    return readPage(
      pagination,
      (page) =>
        db.income.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...page,
        }),
      () => db.income.count({ where }),
    );
  }

  async createIncome(actor: CurrentUserPayload, dto: CreateIncomeDto): Promise<Income> {
    const tenant = requireTenantActor(actor);
    await assertTenantRefs(this.prisma.forCompany(tenant.companyId), dto);
    try {
      const data = toIncomeCreateData(dto);
      const converted = await this.currency.toBase(
        data.amount,
        data.currency ?? 'UZS',
        data.paymentDate ?? new Date(),
      );

      return await this.prisma.forCompanyTx(tenant.companyId, async (tx) => {
        const income = await tx.income.create({
          data: {
            ...data,
            amountBase: converted.amountBase,
            rateUsed: converted.rateUsed,
            rateDate: converted.rateDate,
            companyId: tenant.companyId,
          },
        });

        // Money received against a client account is what pays a trip down.
        // Without a client there is nobody to credit — the row is still a
        // valid income record, it just does not move any balance.
        if (income.clientId) {
          await this.ledger.record(tx, tenant, {
            clientId: income.clientId,
            tripId: income.tripId,
            incomeId: income.id,
            direction: 'CREDIT',
            reason: 'PAYMENT_RECEIVED',
            amount: income.amount,
            currency: income.currency,
            amountBase: income.amountBase,
            reference: income.invoiceNumber ?? undefined,
          });
        }

        const withStatus = await this.syncPaymentStatus(tx, income);

        await this.audit.logInTx(tx, {
          companyId: tenant.companyId,
          userId: tenant.userId,
          action: 'CREATE',
          entityType: 'Income',
          entityId: income.id,
          after: toAuditJson(withStatus),
        });
        return withStatus;
      });
    } catch (error) {
      rethrowPrismaError(error);
    }
  }

  /**
   * Payment status follows the ledger rather than being typed in: an income is
   * PAID once the trip's invoice is fully covered, PARTIAL while something is
   * still outstanding, and PENDING when there is no invoice to measure against.
   */
  private async syncPaymentStatus(tx: TenantScopedClient, income: Income): Promise<Income> {
    if (!income.tripId) return income;

    const totals = await tx.ledgerEntry.groupBy({
      by: ['direction'],
      where: { tripId: income.tripId },
      _sum: { amountBase: true },
    });
    const sumOf = (direction: 'DEBIT' | 'CREDIT') =>
      totals.find((row) => row.direction === direction)?._sum.amountBase ?? 0n;

    const invoiced = sumOf('DEBIT');
    const paid = sumOf('CREDIT');
    if (invoiced === 0n) return income;

    const status = paid >= invoiced ? 'PAID' : 'PARTIAL';
    if (income.status === status) return income;
    return tx.income.update({ where: { id: income.id }, data: { status } });
  }

  async updateIncome(actor: CurrentUserPayload, id: string, dto: UpdateIncomeDto): Promise<Income> {
    const db = this.prisma.forCompany(actor.companyId);
    await assertTenantRefs(db, dto);
    const existing = await db.income.findUnique({ where: { id } });
    if (!existing) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    try {
      const tenant = requireTenantActor(actor);
      const changes = toIncomeData(dto);
      const converted = await this.reconvert(existing, {
        ...changes,
        on: changes.paymentDate ?? existing.paymentDate ?? existing.createdAt,
        dateChanged: changes.paymentDate !== undefined,
      });

      return await this.prisma.forCompanyTx(tenant.companyId, async (tx) => {
        // Guarded on the version read above. Two corrections racing would both
        // find the same un-reversed ledger entry and reverse it twice, leaving
        // the client's balance short by one payment.
        const { count } = await tx.income.updateMany({
          where: { id, version: existing.version },
          data: { ...changes, ...converted, version: { increment: 1 } },
        });
        if (count === 0) {
          throw new AppException('RESOURCE_CONFLICT', HttpStatus.CONFLICT, undefined, {
            expectedVersion: existing.version,
          });
        }
        const income = await tx.income.findUniqueOrThrow({ where: { id } });

        // Correcting a recorded payment is a reversal plus a new entry, never
        // an edit: the ledger keeps what was believed at the time.
        if (dto.amount !== undefined && BigInt(dto.amount) !== existing.amount) {
          const original = await tx.ledgerEntry.findFirst({
            where: { incomeId: id, reason: 'PAYMENT_RECEIVED', reversedByEntryId: null },
          });
          if (original) {
            await this.ledger.reverse(tx, tenant, original.id, `correction of income ${id}`);
            await this.ledger.record(tx, tenant, {
              clientId: income.clientId,
              tripId: income.tripId,
              incomeId: income.id,
              direction: 'CREDIT',
              reason: 'PAYMENT_RECEIVED',
              amount: income.amount,
              currency: income.currency,
              amountBase: income.amountBase,
              reference: income.invoiceNumber ?? undefined,
            });
          }
        }
        await this.syncPaymentStatus(tx, income);

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
