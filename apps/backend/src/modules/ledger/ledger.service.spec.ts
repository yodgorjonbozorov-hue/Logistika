import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { LedgerService } from './ledger.service';
import type { TenantActor } from 'shared';

const TENANT = ACTOR as TenantActor;

/** so'm → tiyin, the unit every amount is stored in. */
const som = (value: number): bigint => BigInt(value) * 100n;

describe('LedgerService.record', () => {
  function setup() {
    const { prisma, db } = createTenantDbMock(['ledgerEntry', 'client']);
    db.ledgerEntry!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'l1', ...data }),
    );
    db.client!.update!.mockResolvedValue({ id: 'c1' });
    return { service: new LedgerService(prisma), db, tx: db as never };
  }

  const invoice = (amount: bigint) =>
    ({
      clientId: 'c1',
      tripId: 't1',
      direction: 'DEBIT' as const,
      reason: 'TRIP_INVOICED' as const,
      amount,
      amountBase: amount,
    });

  it('writes the entry and moves the cached balance atomically', async () => {
    const { service, db, tx } = setup();

    await service.record(tx, TENANT, invoice(som(9_500_000)));

    const entry = db.ledgerEntry!.create!.mock.calls[0][0].data;
    expect(entry.direction).toBe('DEBIT');
    expect(entry.amount).toBe(950_000_000n);
    expect(entry.companyId).toBe(TENANT.companyId);
    expect(entry.createdById).toBe(TENANT.userId);

    // increment, never read-modify-write: two payments arriving together must
    // not overwrite each other's arithmetic (DB-5).
    expect(db.client!.update!.mock.calls[0][0].data).toEqual({
      balance: { increment: -950_000_000n },
    });
  });

  it('a payment moves the balance the other way', async () => {
    const { service, db, tx } = setup();

    await service.record(tx, TENANT, {
      clientId: 'c1',
      incomeId: 'i1',
      direction: 'CREDIT',
      reason: 'PAYMENT_RECEIVED',
      amount: som(4_000_000),
      amountBase: som(4_000_000),
    });

    expect(db.client!.update!.mock.calls[0][0].data).toEqual({
      balance: { increment: 400_000_000n },
    });
  });

  it('refuses a zero or negative amount', async () => {
    const { service, tx } = setup();

    // A negative DEBIT is a CREDIT wearing a disguise, and it makes every
    // SUM() in every report ambiguous.
    for (const amount of [0n, -1n, som(-5)]) {
      await expect(service.record(tx, TENANT, invoice(amount))).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
  });

  it('records an entry with no client without touching any balance', async () => {
    const { service, db, tx } = setup();

    await service.record(tx, TENANT, {
      driverId: 'd1',
      direction: 'DEBIT',
      reason: 'DRIVER_ADVANCE',
      amount: som(500_000),
      amountBase: som(500_000),
    });

    expect(db.ledgerEntry!.create).toHaveBeenCalled();
    expect(db.client!.update).not.toHaveBeenCalled();
  });

  it('keeps full precision on amounts beyond a float', async () => {
    const { service, db, tx } = setup();
    const huge = 9_007_199_254_740_993n; // > Number.MAX_SAFE_INTEGER

    await service.record(tx, TENANT, invoice(huge));

    expect(db.ledgerEntry!.create!.mock.calls[0][0].data.amount).toBe(huge);
    expect(db.client!.update!.mock.calls[0][0].data.balance.increment).toBe(-huge);
  });
});

describe('LedgerService.reverse', () => {
  function setup(original: Record<string, unknown> | null) {
    const { prisma, db } = createTenantDbMock(['ledgerEntry', 'client']);
    db.ledgerEntry!.findUnique!.mockResolvedValue(original);
    db.ledgerEntry!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'mirror', ...data }),
    );
    db.ledgerEntry!.update!.mockResolvedValue({});
    db.client!.update!.mockResolvedValue({});
    return { service: new LedgerService(prisma), db, tx: db as never };
  }

  const original = {
    id: 'l1',
    clientId: 'c1',
    tripId: 't1',
    driverId: null,
    incomeId: null,
    expenseId: null,
    direction: 'DEBIT',
    amount: som(1_000_000),
    amountBase: som(1_000_000),
    currency: 'UZS',
    rateUsed: null,
    rateDate: null,
    reversedByEntryId: null,
  };

  it('adds the mirror image instead of editing history', async () => {
    const { service, db, tx } = setup(original);

    const mirror = await service.reverse(tx, TENANT, 'l1');

    const data = db.ledgerEntry!.create!.mock.calls[0][0].data;
    expect(data.direction).toBe('CREDIT');
    expect(data.reason).toBe('REVERSAL');
    expect(data.amount).toBe(som(1_000_000));
    expect(mirror.id).toBe('mirror');

    // The original is only annotated, never rewritten.
    expect(db.ledgerEntry!.update!.mock.calls[0][0]).toEqual({
      where: { id: 'l1' },
      data: { reversedByEntryId: 'mirror' },
    });
    // …and the balance returns to where it was.
    expect(db.client!.update!.mock.calls[0][0].data).toEqual({
      balance: { increment: som(1_000_000) },
    });
  });

  it('copies the original exchange rate rather than using today\'s', async () => {
    const { service, db, tx } = setup({
      ...original,
      currency: 'USD',
      rateUsed: '12500.500000',
      rateDate: new Date('2026-01-15T00:00:00Z'),
    });

    await service.reverse(tx, TENANT, 'l1');

    const data = db.ledgerEntry!.create!.mock.calls[0][0].data;
    // Reversing at a new rate would invent a gain or loss that never happened.
    expect(data.rateUsed).toBe('12500.500000');
    expect(data.rateDate).toEqual(new Date('2026-01-15T00:00:00Z'));
  });

  it('refuses to reverse the same entry twice', async () => {
    const { service, tx } = setup({ ...original, reversedByEntryId: 'already' });

    await expect(service.reverse(tx, TENANT, 'l1')).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
  });

  it('reports an unknown entry as not found', async () => {
    const { service, tx } = setup(null);
    await expect(service.reverse(tx, TENANT, 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('LedgerService.balanceOf', () => {
  function setup(options: {
    entries?: Array<{ direction: string; amountBase: bigint; createdAt: Date }>;
    paymentTermsDays?: number | null;
  }) {
    const { prisma, db } = createTenantDbMock(['ledgerEntry', 'client']);
    const entries = options.entries ?? [];
    db.client!.findUnique!.mockResolvedValue({
      id: 'c1',
      paymentTermsDays: options.paymentTermsDays ?? null,
    });
    db.ledgerEntry!.groupBy = jest.fn().mockResolvedValue(
      (['DEBIT', 'CREDIT'] as const).map((direction) => ({
        direction,
        _sum: {
          amountBase: entries
            .filter((entry) => entry.direction === direction)
            .reduce((sum, entry) => sum + entry.amountBase, 0n),
        },
      })),
    );
    db.ledgerEntry!.findMany!.mockResolvedValue(entries);
    return { service: new LedgerService(prisma) };
  }

  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

  it('reports no debt when nothing has been invoiced', async () => {
    const { service } = setup({});
    const balance = await service.balanceOf(ACTOR, 'c1');

    expect(balance.balance).toBe(0n);
    expect(balance.debt).toBe(0n);
    expect(balance.overdue).toBe(0n);
  });

  it('reports the outstanding amount after a partial payment', async () => {
    const { service } = setup({
      entries: [
        { direction: 'DEBIT', amountBase: som(9_500_000), createdAt: daysAgo(10) },
        { direction: 'CREDIT', amountBase: som(4_000_000), createdAt: daysAgo(2) },
      ],
    });

    const balance = await service.balanceOf(ACTOR, 'c1');
    expect(balance.balance).toBe(-som(5_500_000));
    expect(balance.debt).toBe(som(5_500_000));
  });

  it('reports an overpayment as credit, not as negative debt', async () => {
    const { service } = setup({
      entries: [
        { direction: 'DEBIT', amountBase: som(1_000_000), createdAt: daysAgo(10) },
        { direction: 'CREDIT', amountBase: som(1_500_000), createdAt: daysAgo(1) },
      ],
    });

    const balance = await service.balanceOf(ACTOR, 'c1');
    expect(balance.balance).toBe(som(500_000));
    // The client is ahead; "they owe -500,000" would be a confusing way to say it.
    expect(balance.debt).toBe(0n);
    expect(balance.overdue).toBe(0n);
  });

  it('counts an invoice as overdue only once its term has passed', async () => {
    const { service } = setup({
      paymentTermsDays: 14,
      entries: [{ direction: 'DEBIT', amountBase: som(1_000_000), createdAt: daysAgo(20) }],
    });
    expect((await service.balanceOf(ACTOR, 'c1')).overdue).toBe(som(1_000_000));

    const fresh = setup({
      paymentTermsDays: 14,
      entries: [{ direction: 'DEBIT', amountBase: som(1_000_000), createdAt: daysAgo(3) }],
    });
    expect((await fresh.service.balanceOf(ACTOR, 'c1')).overdue).toBe(0n);
  });

  it('treats the term boundary as not yet late', async () => {
    // Exactly on the due date the client still has the day to pay.
    const { service } = setup({
      paymentTermsDays: 14,
      entries: [
        { direction: 'DEBIT', amountBase: som(1_000_000), createdAt: daysAgo(14 - 0.01) },
      ],
    });
    expect((await service.balanceOf(ACTOR, 'c1')).overdue).toBe(0n);
  });

  it('applies payments to the oldest invoice first', async () => {
    const { service } = setup({
      paymentTermsDays: 14,
      entries: [
        { direction: 'DEBIT', amountBase: som(1_000_000), createdAt: daysAgo(30) },
        { direction: 'DEBIT', amountBase: som(2_000_000), createdAt: daysAgo(2) },
        { direction: 'CREDIT', amountBase: som(1_000_000), createdAt: daysAgo(1) },
      ],
    });

    const balance = await service.balanceOf(ACTOR, 'c1');
    expect(balance.debt).toBe(som(2_000_000));
    // The payment settled the old invoice, so nothing is late — the remaining
    // debt is the recent one, still within its term.
    expect(balance.overdue).toBe(0n);
  });

  it('reports nothing as overdue when no payment term was agreed', async () => {
    const { service } = setup({
      paymentTermsDays: null,
      entries: [{ direction: 'DEBIT', amountBase: som(1_000_000), createdAt: daysAgo(400) }],
    });

    const balance = await service.balanceOf(ACTOR, 'c1');
    expect(balance.debt).toBe(som(1_000_000));
    expect(balance.overdue).toBe(0n);
  });

  it('reports an unknown client as not found', async () => {
    const { prisma, db } = createTenantDbMock(['ledgerEntry', 'client']);
    db.client!.findUnique!.mockResolvedValue(null);
    await expect(new LedgerService(prisma).balanceOf(ACTOR, 'gone')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
