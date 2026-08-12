import { ExpenseCategory } from 'shared';
import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { ExpensesService } from './expenses.service';

describe('ExpensesService', () => {
  const audit = { log: jest.fn() } as unknown as AuditService;

  function setup() {
    const { prisma, db } = createTenantDbMock(['expense', 'income']);
    const alerts = {
      raise: jest.fn(),
    } as unknown as import('../alerts/alerts.service').AlertsService;
    const service = new ExpensesService(prisma, audit, alerts);
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
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVE' }));
  });
});
