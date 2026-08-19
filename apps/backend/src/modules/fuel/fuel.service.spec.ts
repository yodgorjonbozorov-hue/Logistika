import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import type { PrismaService } from '../../prisma/prisma.service';
import { FuelService } from './fuel.service';

function setup(fuelDeviationPercent = 7) {
  const { prisma, db, forCompany } = createTenantDbMock(['fuelLog', 'vehicle', 'trip']);
  // The company row itself is outside the tenant extension (it *is* the tenant).
  (prisma as unknown as { company: { findUnique: jest.Mock } }).company = {
    findUnique: jest.fn().mockResolvedValue({ fuelDeviationPercent }),
  };
  const audit = { log: jest.fn() } as unknown as AuditService;
  return { service: new FuelService(prisma as PrismaService, audit), db, forCompany, audit };
}

describe('FuelService — journal', () => {
  it('stores money as BigInt tiyin and the time as a Date', async () => {
    const { service, db } = setup();
    db.fuelLog!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'f1', ...data }),
    );

    await service.create(ACTOR, {
      vehicleId: '11111111-1111-1111-1111-111111111111',
      liters: 320.45,
      pricePerLiter: '1000000',
      totalAmount: '320450000',
      refuelTime: '2026-08-18T12:05:00Z',
    });

    const data = db.fuelLog!.create!.mock.calls[0][0].data;
    expect(data.pricePerLiter).toBe(1_000_000n);
    expect(data.totalAmount).toBe(320_450_000n);
    expect(typeof data.totalAmount).toBe('bigint');
    expect(data.refuelTime).toBeInstanceOf(Date);
  });

  it("cannot touch another company's entry — the scoped read finds nothing", async () => {
    const { service, db, forCompany } = setup();
    db.fuelLog!.findUnique!.mockResolvedValue(null);

    await expect(service.update(ACTOR, 'log-of-company-b', { liters: 1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.remove(ACTOR, 'log-of-company-b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(forCompany).toHaveBeenCalledWith(ACTOR.companyId);
  });

  it('writes an audit entry when an entry is corrected', async () => {
    const { service, db, audit } = setup();
    db.fuelLog!.findUnique!.mockResolvedValue({ id: 'f1', liters: '300', totalAmount: 1n });
    db.fuelLog!.update!.mockResolvedValue({ id: 'f1', liters: '320', totalAmount: 2n });

    await service.update(ACTOR, 'f1', { liters: 320 });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'FuelLog', entityId: 'f1', action: 'UPDATE' }),
    );
  });
});

describe('FuelService — W-8 control table', () => {
  function withFleet(percent = 7) {
    const context = setup(percent);
    const { db } = context;
    db.vehicle!.findMany!.mockResolvedValue([
      { id: 'v1', plateNumber: '01 A 123 AA', fuelNormPer100km: '32.00' },
      { id: 'v2', plateNumber: '30 B 210 CA', fuelNormPer100km: '29.40' },
      { id: 'v3', plateNumber: '10 C 909 DA', fuelNormPer100km: '24.10' },
    ]);
    db.trip!.findMany!.mockResolvedValue([
      { vehicleId: 'v1', actualDistanceKm: '1240.0', plannedDistanceKm: null },
      { vehicleId: 'v2', actualDistanceKm: null, plannedDistanceKm: '1000.0' },
      // v3 stayed in the yard this month.
    ]);
    db.fuelLog!.findMany!.mockResolvedValue([
      { vehicleId: 'v1', liters: '250.00', pricePerLiter: 1_000_000n, totalAmount: 250_000_000n },
      { vehicleId: 'v1', liters: '202.00', pricePerLiter: 1_000_000n, totalAmount: 202_000_000n },
      { vehicleId: 'v2', liters: '280.00', pricePerLiter: 1_000_000n, totalAmount: 280_000_000n },
    ]);
    return context;
  }

  it('reproduces the TZ W-8 example row', async () => {
    const { service } = withFleet();
    const result = await service.control(ACTOR, {});

    const row = result.rows.find((item) => item.plateNumber === '01 A 123 AA')!;
    expect(row.distanceKm10).toBe(12_400);
    expect(row.normLitersCenti).toBe(39_680); // 396.80 l
    expect(row.actualLitersCenti).toBe(45_200); // 452.00 l
    expect(row.diffLitersCenti).toBe(5520); // +55.20 l
    expect(row.lossTiyin).toBe('55200000'); // 552 000 so'm
    expect(row.refuelCount).toBe(2);
    expect(row.avgPricePerLiter).toBe('1000000');
  });

  it('raises the signal only above the company threshold', async () => {
    const generous = await withFleet(20).service.control(ACTOR, {});
    const strict = await withFleet(7).service.control(ACTOR, {});

    const plate = '01 A 123 AA'; // +13.91% over the norm
    expect(generous.rows.find((row) => row.plateNumber === plate)!.overThreshold).toBe(false);
    expect(strict.rows.find((row) => row.plateNumber === plate)!.overThreshold).toBe(true);
    expect(strict.thresholdBp).toBe(700);
  });

  it('counts a vehicle that burned less than its norm as a saving, not a loss', async () => {
    const { service } = withFleet();
    const result = await service.control(ACTOR, {});

    const row = result.rows.find((item) => item.plateNumber === '30 B 210 CA')!;
    expect(row.diffLitersCenti).toBe(-1400); // 280.00 l against a 294.00 l norm
    expect(row.lossTiyin).toBe('0');
    expect(row.overThreshold).toBe(false);
  });

  it('leaves out vehicles that neither drove nor refuelled', async () => {
    const { service } = withFleet();
    const result = await service.control(ACTOR, {});
    expect(result.rows.map((row) => row.plateNumber)).not.toContain('10 C 909 DA');
  });

  it('sorts the worst overrun first and totals the loss', async () => {
    const { service } = withFleet();
    const result = await service.control(ACTOR, {});
    expect(result.rows[0]!.plateNumber).toBe('01 A 123 AA');
    expect(result.totalLossTiyin).toBe('55200000');
  });

  it('reports a vehicle without a declared norm without accusing it', async () => {
    const { service, db } = withFleet();
    db.vehicle!.findMany!.mockResolvedValue([
      { id: 'v1', plateNumber: '01 A 123 AA', fuelNormPer100km: null },
    ]);

    const row = (await service.control(ACTOR, {})).rows[0]!;
    expect(row.normLitersCenti).toBe(0);
    expect(row.diffBp).toBe(0);
    expect(row.overThreshold).toBe(false);
  });
});
