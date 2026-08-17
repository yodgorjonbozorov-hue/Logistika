import { ExpenseCategory } from 'shared';
import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { ExpensesService } from './expenses.service';

/** Ledger behaviour is covered by ledger.service.spec.ts and the e2e suite. */
const ledgerStub = {
  record: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
  reverse: jest.fn(),
} as unknown as import('../ledger/ledger.service').LedgerService;

describe('ExpensesService', () => {
  const audit = {
    log: jest.fn(),
    logInTx: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  function setup() {
    const { prisma, db } = createTenantDbMock([
      'expense',
      'income',
      'trip',
      'vehicle',
      'driver',
      'client',
    ]);
    // Referenced records exist in this tenant unless a test says otherwise.
    for (const model of ['trip', 'vehicle', 'driver', 'client']) {
      db[model]!.findUnique!.mockResolvedValue({ id: 'ref' });
    }
    const service = new ExpensesService(prisma, audit, ledgerStub);
    return { service, db };
  }

  it('stores money as BigInt tiyin, never float', async () => {
    const { service, db } = setup();
    db.expense!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'e1', ...data }),
    );

    await service.createExpense(ACTOR, {
      category: ExpenseCategory.FUEL,
      amount: '419780000', // 4 197 800 so'm in tiyin
      unitPrice: '1390000',
      quantity: 302,
      expenseDate: '2026-08-06T09:22:00Z',
    });

    const data = db.expense!.create!.mock.calls[0][0].data;
    expect(data.amount).toBe(419_780_000n);
    expect(data.unitPrice).toBe(1_390_000n);
    expect(typeof data.amount).toBe('bigint');
    expect(data.expenseDate).toBeInstanceOf(Date);
  });

  it('blocks edits and deletion of approved expenses (financial record)', async () => {
    const { service, db } = setup();
    db.expense!.findUnique!.mockResolvedValue({ id: 'e1', isApproved: true });

    await expect(service.updateExpense(ACTOR, 'e1', { amount: '1' })).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    await expect(service.removeExpense(ACTOR, 'e1')).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('approval flips the flag and writes an audit entry', async () => {
    const { service, db } = setup();
    db.expense!.update!.mockResolvedValue({
      id: 'e1',
      isApproved: true,
      amount: 100n,
      category: 'FUEL',
    });

    await service.approveExpense(ACTOR, 'e1');

    expect(db.expense!.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { isApproved: true },
    });
    // The audit row is written inside the same transaction as the flag now, so
    // an approval can never be recorded without the change (or the reverse).
    expect(audit.logInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'APPROVE' }),
    );
  });
});

describe('ExpensesService tenant references (TASK-2.2)', () => {
  const audit = {
    log: jest.fn(),
    logInTx: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  function setup() {
    const { prisma, db } = createTenantDbMock([
      'expense',
      'income',
      'trip',
      'vehicle',
      'driver',
      'client',
    ]);
    for (const model of ['trip', 'vehicle', 'driver', 'client']) {
      db[model]!.findUnique!.mockResolvedValue({ id: 'ref' });
    }
    db.expense!.create!.mockResolvedValue({ id: 'e1' });
    db.income!.create!.mockResolvedValue({ id: 'i1' });
    db.expense!.findUnique!.mockResolvedValue({ id: 'e1', isApproved: false });
    db.expense!.update!.mockResolvedValue({ id: 'e1' });
    db.income!.update!.mockResolvedValue({ id: 'i1' });
    return { service: new ExpensesService(prisma, audit, ledgerStub), db };
  }

  const expense = (overrides: Record<string, unknown> = {}) => ({
    category: ExpenseCategory.FUEL,
    amount: '1000000',
    expenseDate: '2026-08-06T09:00:00Z',
    ...overrides,
  });

  it('refuses an expense whose trip belongs to another tenant', async () => {
    const { service, db } = setup();
    // The tenant-scoped lookup cannot see it — the id may as well not exist.
    db.trip!.findUnique!.mockResolvedValue(null);

    await expect(
      service.createExpense(ACTOR, expense({ tripId: 'other-company-trip' }) as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.expense!.create).not.toHaveBeenCalled();
  });

  it('refuses an expense whose vehicle or driver belongs to another tenant', async () => {
    const { service, db } = setup();
    db.vehicle!.findUnique!.mockResolvedValue(null);
    await expect(
      service.createExpense(ACTOR, expense({ vehicleId: 'foreign' }) as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const second = setup();
    second.db.driver!.findUnique!.mockResolvedValue(null);
    await expect(
      second.service.createExpense(ACTOR, expense({ driverId: 'foreign' }) as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses an income whose client belongs to another tenant', async () => {
    const { service, db } = setup();
    db.client!.findUnique!.mockResolvedValue(null);

    await expect(
      service.createIncome(ACTOR, { amount: '1000000', clientId: 'foreign' } as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.income!.create).not.toHaveBeenCalled();
  });

  it('checks references on update too, not only on create', async () => {
    const { service, db } = setup();
    db.trip!.findUnique!.mockResolvedValue(null);

    await expect(
      service.updateExpense(ACTOR, 'e1', { tripId: 'foreign' } as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.expense!.update).not.toHaveBeenCalled();

    db.client!.findUnique!.mockResolvedValue(null);
    await expect(
      service.updateIncome(ACTOR, 'i1', { clientId: 'foreign' } as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.income!.update).not.toHaveBeenCalled();
  });

  it('stamps the tenant from the token, never from the payload', async () => {
    const { service, db } = setup();

    await service.createExpense(ACTOR, {
      ...expense(),
      // A client-supplied companyId must have no effect whatsoever.
      companyId: 'attacker-company',
    } as never);

    const data = db.expense!.create!.mock.calls[0][0].data;
    expect(data.companyId).toBe(ACTOR.companyId);
    expect(data.createdById).toBe(ACTOR.userId);
  });

  it('accepts references that do exist in the tenant', async () => {
    const { service, db } = setup();
    await service.createExpense(ACTOR, expense({ tripId: 't1', vehicleId: 'v1' }) as never);
    expect(db.expense!.create).toHaveBeenCalled();
  });
});

describe('ExpensesService money conversion edge cases', () => {
  const audit = {
    log: jest.fn(),
    logInTx: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  function setup() {
    const { prisma, db } = createTenantDbMock([
      'expense',
      'income',
      'trip',
      'vehicle',
      'driver',
      'client',
    ]);
    for (const model of ['trip', 'vehicle', 'driver', 'client']) {
      db[model]!.findUnique!.mockResolvedValue({ id: 'ref' });
    }
    db.expense!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'e1', ...data }),
    );
    db.income!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'i1', ...data }),
    );
    db.expense!.findUnique!.mockResolvedValue({ id: 'e1', isApproved: false });
    db.expense!.update!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'e1', ...data }),
    );
    db.income!.update!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'i1', ...data }),
    );
    db.income!.findUnique!.mockResolvedValue({ id: 'i1', amount: 1n });
    return { service: new ExpensesService(prisma, audit, ledgerStub), db };
  }

  it('leaves omitted optional money fields unset rather than zero', async () => {
    const { service, db } = setup();
    await service.createExpense(ACTOR, {
      category: ExpenseCategory.TOLL,
      amount: '8000000',
      expenseDate: '2026-08-06T09:00:00Z',
    } as never);

    const data = db.expense!.create!.mock.calls[0][0].data;
    expect(data.amount).toBe(8_000_000n);
    // A missing unit price is unknown, not 0 — 0 would poison per-unit reports.
    expect(data.unitPrice).toBeUndefined();
  });

  it('converts an income with and without a payment date', async () => {
    const { service, db } = setup();
    await service.createIncome(ACTOR, { amount: '950000000' } as never);
    expect(db.income!.create!.mock.calls[0][0].data.paymentDate).toBeUndefined();

    await service.createIncome(ACTOR, {
      amount: '950000000',
      paymentDate: '2026-08-10T00:00:00Z',
    } as never);
    expect(db.income!.create!.mock.calls[1][0].data.paymentDate).toEqual(
      new Date('2026-08-10T00:00:00Z'),
    );
  });

  it('keeps a partial update partial: untouched money fields stay undefined', async () => {
    const { service, db } = setup();
    await service.updateExpense(ACTOR, 'e1', { description: 'typo fixed' } as never);

    const data = db.expense!.update!.mock.calls[0][0].data;
    expect(data.description).toBe('typo fixed');
    expect(data.amount).toBeUndefined();
    expect(data.expenseDate).toBeUndefined();
  });

  it('converts amounts on update without losing precision', async () => {
    const { service, db } = setup();
    await service.updateExpense(ACTOR, 'e1', { amount: '9007199254740993' } as never);

    // Beyond Number.MAX_SAFE_INTEGER: exactly why money is BigInt tiyin.
    expect(db.expense!.update!.mock.calls[0][0].data.amount).toBe(9_007_199_254_740_993n);
  });

  it('converts income amounts on update', async () => {
    const { service, db } = setup();
    await service.updateIncome(ACTOR, 'i1', { amount: '1', paymentDate: undefined } as never);
    expect(db.income!.update!.mock.calls[0][0].data.amount).toBe(1n);
  });
});

describe('ExpensesService missing rows', () => {
  const audit = {
    log: jest.fn(),
    logInTx: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  function setup() {
    const { prisma, db } = createTenantDbMock([
      'expense',
      'income',
      'trip',
      'vehicle',
      'driver',
      'client',
    ]);
    for (const model of ['trip', 'vehicle', 'driver', 'client']) {
      db[model]!.findUnique!.mockResolvedValue({ id: 'ref' });
    }
    return { service: new ExpensesService(prisma, audit, ledgerStub), db };
  }

  it('reports a missing income as not found instead of updating nothing', async () => {
    const { service, db } = setup();
    // Another tenant's id looks exactly like this through the scoped client.
    db.income!.findUnique!.mockResolvedValue(null);

    await expect(
      service.updateIncome(ACTOR, 'someone-elses-income', { amount: '1' } as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.income!.update).not.toHaveBeenCalled();
    expect(audit.logInTx).not.toHaveBeenCalled();
  });

  it('reports a missing expense as not found on update and delete', async () => {
    const { service, db } = setup();
    db.expense!.findUnique!.mockResolvedValue(null);

    await expect(
      service.updateExpense(ACTOR, 'gone', { amount: '1' } as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.removeExpense(ACTOR, 'gone')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('ExpensesService income ↔ ledger (TASK-3.1)', () => {
  const audit = {
    log: jest.fn(),
    logInTx: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  function setup(options: { invoiced?: bigint; paid?: bigint } = {}) {
    const { prisma, db } = createTenantDbMock([
      'expense',
      'income',
      'trip',
      'vehicle',
      'driver',
      'client',
      'ledgerEntry',
    ]);
    for (const model of ['trip', 'vehicle', 'driver', 'client']) {
      db[model]!.findUnique!.mockResolvedValue({ id: 'ref' });
    }
    db.income!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'i1', status: 'PENDING', currency: 'UZS', ...data }),
    );
    db.income!.update!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'i1', tripId: 't1', currency: 'UZS', status: 'PENDING', ...data }),
    );
    db.income!.findUnique!.mockResolvedValue({
      id: 'i1',
      tripId: 't1',
      clientId: 'c1',
      amount: 100n,
      currency: 'UZS',
      status: 'PENDING',
    });
    db.ledgerEntry!.groupBy = jest.fn().mockResolvedValue([
      { direction: 'DEBIT', _sum: { amountBase: options.invoiced ?? 0n } },
      { direction: 'CREDIT', _sum: { amountBase: options.paid ?? 0n } },
    ]);
    db.ledgerEntry!.findFirst = jest.fn().mockResolvedValue({ id: 'ledger-1' });

    const ledger = {
      record: jest.fn().mockResolvedValue({ id: 'ledger-2' }),
      reverse: jest.fn().mockResolvedValue({ id: 'mirror' }),
    };
    return {
      service: new ExpensesService(prisma, audit, ledger as never),
      db,
      ledger,
    };
  }

  const payment = (amount: string, extra: Record<string, unknown> = {}) =>
    ({ amount, clientId: 'c1', tripId: 't1', ...extra }) as never;

  it('credits the client ledger when a payment is recorded', async () => {
    const { service, ledger } = setup();
    await service.createIncome(ACTOR, payment('400000000'));

    expect(ledger.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyId: ACTOR.companyId }),
      expect.objectContaining({
        direction: 'CREDIT',
        reason: 'PAYMENT_RECEIVED',
        amount: 400_000_000n,
        clientId: 'c1',
      }),
    );
  });

  it('records an income with no client without touching any balance', async () => {
    const { service, ledger } = setup();
    await service.createIncome(ACTOR, { amount: '1000' } as never);
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('marks the payment PARTIAL while the invoice is not covered', async () => {
    const { service, db } = setup({ invoiced: 1000n, paid: 400n });
    await service.createIncome(ACTOR, payment('400'));

    expect(db.income!.update!.mock.calls.at(-1)![0].data).toEqual({ status: 'PARTIAL' });
  });

  it('marks the payment PAID once the invoice is fully covered', async () => {
    const { service, db } = setup({ invoiced: 1000n, paid: 1000n });
    await service.createIncome(ACTOR, payment('1000'));

    expect(db.income!.update!.mock.calls.at(-1)![0].data).toEqual({ status: 'PAID' });
  });

  it('treats an overpayment as PAID, not as something beyond it', async () => {
    const { service, db } = setup({ invoiced: 1000n, paid: 1200n });
    await service.createIncome(ACTOR, payment('1200'));
    expect(db.income!.update!.mock.calls.at(-1)![0].data).toEqual({ status: 'PAID' });
  });

  it('leaves the status alone when there is no invoice to measure against', async () => {
    const { service, db } = setup({ invoiced: 0n, paid: 500n });
    await service.createIncome(ACTOR, payment('500'));
    expect(db.income!.update).not.toHaveBeenCalled();
  });

  it('corrects a payment amount by reversing and re-recording, never editing', async () => {
    const { service, ledger } = setup({ invoiced: 1000n, paid: 900n });

    await service.updateIncome(ACTOR, 'i1', { amount: '900' } as never);

    expect(ledger.reverse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyId: ACTOR.companyId }),
      'ledger-1',
      expect.stringContaining('correction'),
    );
    expect(ledger.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ direction: 'CREDIT', amount: 900n }),
    );
  });

  it('does not touch the ledger when the amount did not change', async () => {
    const { service, ledger } = setup({ invoiced: 1000n, paid: 100n });
    await service.updateIncome(ACTOR, 'i1', { paymentMethod: 'bank' } as never);

    expect(ledger.reverse).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });
});