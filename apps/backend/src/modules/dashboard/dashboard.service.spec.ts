import type { ConfigService } from '@nestjs/config';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const config = { get: () => 'Asia/Tashkent' } as unknown as ConfigService;

  function setup() {
    const { prisma, db, forCompany } = createTenantDbMock([
      'trip',
      'vehicle',
      'driver',
      'income',
      'expense',
    ]);
    return { service: new DashboardService(prisma, config), db, forCompany };
  }

  it('scopes every query to the actor company (tenant isolation)', async () => {
    const { service, forCompany } = setup();
    await service.summary(ACTOR);
    expect(forCompany).toHaveBeenCalledWith('company-a');
    expect(forCompany).not.toHaveBeenCalledWith(undefined);
  });

  it('counts "today" in the company timezone, not in UTC', async () => {
    const { service, db } = setup();
    // 21:00 UTC on the 17th is already 02:00 on the 18th in Tashkent.
    await service.summary(ACTOR, new Date('2026-08-17T21:00:00Z'));

    const todayCall = db.trip!.count!.mock.calls.find(
      (call: [{ where?: { createdAt?: { gte: Date; lt: Date } } }]) => call[0]?.where?.createdAt,
    );
    const window = todayCall![0].where.createdAt;
    expect(window.gte.toISOString()).toBe('2026-08-17T19:00:00.000Z');
    expect(window.lt.toISOString()).toBe('2026-08-18T19:00:00.000Z');
  });

  it('sums money as BigInt and defaults empty aggregates to zero', async () => {
    const { service, db } = setup();
    db.income!.aggregate!.mockResolvedValueOnce({ _sum: { amount: 4_500_000n } }) // today
      .mockResolvedValueOnce({ _sum: { amount: 12_000_000n } }); // receivables
    db.expense!.aggregate!.mockResolvedValue({ _sum: { amount: null } });

    const summary = await service.summary(ACTOR);

    expect(summary.kpi.todayIncome).toBe(4_500_000n);
    expect(summary.kpi.receivables).toBe(12_000_000n);
    expect(summary.kpi.todayExpense).toBe(0n);
    expect(typeof summary.kpi.todayExpense).toBe('bigint');
  });

  it('only counts trips that still need attention as active', async () => {
    const { service, db } = setup();
    await service.summary(ACTOR);
    const where = db.trip!.findMany!.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['ASSIGNED', 'IN_PROGRESS']);
  });
});
