import type { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const config = { get: () => 'Asia/Tashkent' } as unknown as ConfigService;

  function setup() {
    const { prisma, db, forCompany } = createTenantDbMock([
      'trip',
      'vehicle',
      'driver',
      'income',
      'expense',
    ]);
    return { service: new ReportsService(prisma, config), db, forCompany };
  }

  const RANGE = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-09-01T00:00:00Z') };

  it('scopes every report to the actor company (tenant isolation)', async () => {
    const { service, forCompany } = setup();
    await Promise.all([
      service.trips(ACTOR, RANGE),
      service.finance(ACTOR, RANGE),
      service.vehicles(ACTOR, RANGE),
      service.drivers(ACTOR, RANGE),
    ]);
    for (const call of forCompany.mock.calls) {
      expect(call[0]).toBe('company-a');
    }
  });

  it('defaults the range to the last 30 local days', () => {
    const { service } = setup();
    const range = service.resolveRange(undefined, undefined, new Date('2026-08-17T21:00:00Z'));
    expect(range.from.toISOString()).toBe('2026-07-18T19:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-08-18T19:00:00.000Z');
  });

  it('keeps trip money in BigInt when bucketing by month', async () => {
    const { service, db } = setup();
    db.trip!.groupBy!.mockResolvedValue([
      { status: 'COMPLETED', _count: { _all: 2 }, _sum: { agreedPrice: 300_000_000n } },
    ]);
    db.trip!.findMany!.mockResolvedValue([
      { createdAt: new Date('2026-08-05T10:00:00Z'), agreedPrice: 100_000_000n },
      { createdAt: new Date('2026-08-06T10:00:00Z'), agreedPrice: 200_000_000n },
    ]);

    const report = await service.trips(ACTOR, RANGE);

    expect(report.total).toBe(2);
    expect(report.byStatus[0]).toEqual({
      status: 'COMPLETED',
      count: 2,
      agreedTotal: 300_000_000n,
    });
    expect(report.byMonth).toEqual([{ month: '2026-08', count: 2, agreedTotal: 300_000_000n }]);
  });

  it('nets UZS income against UZS expense and parks other currencies separately', async () => {
    const { service, db } = setup();
    db.income!.findMany!.mockResolvedValue([
      { paymentDate: new Date('2026-08-05T10:00:00Z'), amount: 500_000_000n, currency: 'UZS' },
      { paymentDate: new Date('2026-08-07T10:00:00Z'), amount: 1_000_00n, currency: 'USD' },
    ]);
    db.expense!.findMany!.mockResolvedValue([
      { expenseDate: new Date('2026-08-06T10:00:00Z'), amount: 120_000_000n, currency: 'UZS' },
    ]);

    const report = await service.finance(ACTOR, RANGE);

    expect(report.incomeTotal).toBe(500_000_000n);
    expect(report.expenseTotal).toBe(120_000_000n);
    expect(report.net).toBe(380_000_000n);
    expect(report.otherCurrencies).toEqual([{ currency: 'USD', income: 100_000n, expense: 0n }]);
    expect(report.byMonth).toEqual([
      { month: '2026-08', income: 500_000_000n, expense: 120_000_000n },
    ]);
  });

  it('reports vehicles with no trips as zeros rather than dropping them', async () => {
    const { service, db } = setup();
    db.vehicle!.findMany!.mockResolvedValue([
      { id: 'v1', plateNumber: '01 A 111 AA', brand: 'MAN', model: 'TGX' },
      { id: 'v2', plateNumber: '01 B 222 BB', brand: null, model: null },
    ]);
    db.trip!.groupBy!.mockResolvedValue([
      {
        vehicleId: 'v1',
        _count: { _all: 3 },
        _sum: { agreedPrice: 900_000_000n, actualDistanceKm: new Prisma.Decimal('1250.5') },
      },
    ]);
    db.expense!.groupBy!.mockResolvedValue([{ vehicleId: 'v1', _sum: { amount: 300_000_000n } }]);

    const rows = await service.vehicles(ACTOR, RANGE);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ trips: 3, revenue: 900_000_000n, expenses: 300_000_000n });
    expect(rows[0]!.distanceKm!.toString()).toBe('1250.5');
    expect(rows[1]).toMatchObject({ trips: 0, revenue: 0n, expenses: 0n, distanceKm: null });
  });

  it('counts completed trips per driver alongside the total', async () => {
    const { service, db } = setup();
    db.driver!.findMany!.mockResolvedValue([{ id: 'd1', fullName: 'Alisher' }]);
    db.trip!.groupBy!.mockResolvedValueOnce([
      { driverId: 'd1', _count: { _all: 4 }, _sum: { agreedPrice: 10n, actualDistanceKm: null } },
    ]).mockResolvedValueOnce([{ driverId: 'd1', _count: { _all: 2 } }]);

    const rows = await service.drivers(ACTOR, RANGE);

    expect(rows[0]).toMatchObject({ trips: 4, completedTrips: 2, revenue: 10n });
  });
});
