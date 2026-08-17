import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type LedgerEntry } from '@prisma/client';
import type { CurrentUserPayload, TenantActor } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService, type TenantScopedClient } from '../../prisma/prisma.service';
import type { ListLedgerDto } from './dto/ledger.dto';

/**
 * What a client owes, and why.
 *
 * `Client.balance` existed as a column that nothing ever wrote, so the central
 * question of the business — "how much does this client owe us?" — had no
 * answer. Entries are immutable: corrections are made by adding a REVERSAL,
 * which is what makes a balance defensible months later.
 *
 * Sign convention, from the company's point of view:
 *   DEBIT  — the client owes more (a trip was invoiced)
 *   CREDIT — the client paid some of it
 *   balance = SUM(CREDIT) - SUM(DEBIT); negative means the client is in debt.
 * The API also reports `debt` (= -balance when positive), because that is the
 * number a person actually asks for.
 */
export interface LedgerInput {
  clientId?: string | null;
  driverId?: string | null;
  tripId?: string | null;
  incomeId?: string | null;
  expenseId?: string | null;
  direction: 'DEBIT' | 'CREDIT';
  reason: 'TRIP_INVOICED' | 'PAYMENT_RECEIVED' | 'ADJUSTMENT' | 'REFUND' | 'DRIVER_ADVANCE';
  amount: bigint;
  currency?: 'UZS' | 'USD' | 'RUB' | 'KZT';
  /** UZS tiyin. Until TASK-3.3 lands this equals `amount` for UZS entries. */
  amountBase: bigint;
  reference?: string;
}

export interface ClientBalance {
  clientId: string;
  /** SUM(CREDIT) - SUM(DEBIT) in UZS tiyin. Negative = the client owes us. */
  balance: bigint;
  /** What the client owes right now (0 when they are square or in credit). */
  debt: bigint;
  /** The part of that debt whose payment term has already passed. */
  overdue: bigint;
  paymentTermsDays: number | null;
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records one movement and moves the cached balance with it.
   *
   * Both happen inside the caller's transaction, and the balance is changed
   * with an atomic `increment` rather than read-modify-write: two payments
   * landing at the same moment must not overwrite each other's arithmetic
   * (DB-5).
   */
  async record(
    tx: TenantScopedClient,
    actor: TenantActor,
    input: LedgerInput,
  ): Promise<LedgerEntry> {
    if (input.amount <= 0n) {
      // Negative money is expressed as the opposite direction or a reversal,
      // never as a negative amount: it keeps every SUM() honest.
      throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
        'ledger amount must be positive; use the opposite direction or a reversal',
      ]);
    }

    const entry = await tx.ledgerEntry.create({
      data: {
        companyId: actor.companyId,
        clientId: input.clientId ?? null,
        driverId: input.driverId ?? null,
        tripId: input.tripId ?? null,
        incomeId: input.incomeId ?? null,
        expenseId: input.expenseId ?? null,
        direction: input.direction,
        reason: input.reason,
        amount: input.amount,
        currency: input.currency ?? 'UZS',
        amountBase: input.amountBase,
        reference: input.reference,
        createdById: actor.userId,
      },
    });

    if (input.clientId) {
      await tx.client.update({
        where: { id: input.clientId },
        data: { balance: { increment: this.signedBase(input.direction, input.amountBase) } },
      });
    }
    return entry;
  }

  /**
   * Cancels an entry by adding its mirror image. The original stays exactly as
   * it was written — that is the point of an immutable ledger.
   */
  async reverse(
    tx: TenantScopedClient,
    actor: TenantActor,
    entryId: string,
    reference?: string,
  ): Promise<LedgerEntry> {
    const original = await tx.ledgerEntry.findUnique({ where: { id: entryId } });
    if (!original) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    if (original.reversedByEntryId) {
      throw new AppException('ALREADY_EXISTS', HttpStatus.CONFLICT, undefined, {
        reversedBy: original.reversedByEntryId,
      });
    }

    const mirror = await tx.ledgerEntry.create({
      data: {
        companyId: actor.companyId,
        clientId: original.clientId,
        driverId: original.driverId,
        tripId: original.tripId,
        incomeId: original.incomeId,
        expenseId: original.expenseId,
        direction: original.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        reason: 'REVERSAL',
        amount: original.amount,
        currency: original.currency,
        amountBase: original.amountBase,
        // The rate is copied, not recalculated: reversing at today's rate would
        // invent a profit or loss that never happened.
        rateUsed: original.rateUsed,
        rateDate: original.rateDate,
        reference: reference ?? `reversal of ${original.id}`,
        createdById: actor.userId,
      },
    });

    await tx.ledgerEntry.update({
      where: { id: original.id },
      data: { reversedByEntryId: mirror.id },
    });

    if (original.clientId) {
      await tx.client.update({
        where: { id: original.clientId },
        data: {
          balance: { increment: this.signedBase(mirror.direction, mirror.amountBase) },
        },
      });
    }
    return mirror;
  }

  async list(
    actor: CurrentUserPayload,
    clientId: string,
    filter: ListLedgerDto,
  ): Promise<{ data: LedgerEntry[]; total: number }> {
    const db = this.prisma.forCompany(actor.companyId);
    await this.requireClient(db, clientId);

    const where: Prisma.LedgerEntryWhereInput = {
      clientId,
      createdAt: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
    };
    const [data, total] = await Promise.all([
      db.ledgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.limit,
      }),
      db.ledgerEntry.count({ where }),
    ]);
    return { data, total };
  }

  /**
   * Balance from the entries themselves, not from the cached column: the cache
   * is a convenience for list screens, and anything that reports a debt should
   * be able to show its work.
   */
  async balanceOf(actor: CurrentUserPayload, clientId: string): Promise<ClientBalance> {
    const db = this.prisma.forCompany(actor.companyId);
    const client = await this.requireClient(db, clientId);

    const totals = await db.ledgerEntry.groupBy({
      by: ['direction'],
      where: { clientId },
      _sum: { amountBase: true },
    });
    const sumOf = (direction: 'DEBIT' | 'CREDIT') =>
      totals.find((row) => row.direction === direction)?._sum.amountBase ?? 0n;

    const balance = sumOf('CREDIT') - sumOf('DEBIT');
    const debt = balance < 0n ? -balance : 0n;

    return {
      clientId,
      balance,
      debt,
      overdue: await this.overdueAmount(db, clientId, client.paymentTermsDays, debt),
      paymentTermsDays: client.paymentTermsDays,
    };
  }

  /**
   * How much of the debt is late.
   *
   * Payments are applied oldest-invoice-first (the usual convention): the
   * overdue figure is what remains of invoices whose term has passed once all
   * credits are used up against the oldest ones.
   */
  private async overdueAmount(
    db: ReturnType<PrismaService['forCompany']>,
    clientId: string,
    paymentTermsDays: number | null,
    debt: bigint,
  ): Promise<bigint> {
    if (debt === 0n) return 0n;
    // No agreed term means nothing can be late yet.
    if (paymentTermsDays === null) return 0n;

    const entries = await db.ledgerEntry.findMany({
      where: { clientId },
      orderBy: { createdAt: 'asc' },
      select: { direction: true, amountBase: true, createdAt: true },
    });

    let credit = entries
      .filter((entry) => entry.direction === 'CREDIT')
      .reduce((sum, entry) => sum + entry.amountBase, 0n);

    const dueBefore = new Date(Date.now() - paymentTermsDays * 24 * 60 * 60 * 1000);
    let overdue = 0n;
    for (const entry of entries) {
      if (entry.direction !== 'DEBIT') continue;
      const unpaid = entry.amountBase > credit ? entry.amountBase - credit : 0n;
      credit = credit > entry.amountBase ? credit - entry.amountBase : 0n;
      if (unpaid > 0n && entry.createdAt < dueBefore) overdue += unpaid;
    }
    return overdue;
  }

  private async requireClient(
    db: ReturnType<PrismaService['forCompany']>,
    clientId: string,
  ): Promise<{ paymentTermsDays: number | null }> {
    const client = await db.client.findUnique({ where: { id: clientId } });
    if (!client) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return client;
  }

  /** CREDIT raises the balance, DEBIT lowers it. */
  private signedBase(direction: 'DEBIT' | 'CREDIT', amountBase: bigint): bigint {
    return direction === 'CREDIT' ? amountBase : -amountBase;
  }
}
