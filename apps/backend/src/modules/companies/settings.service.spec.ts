import type { AuditService } from '../audit/audit.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { DEFAULT_SETTINGS, SettingsService } from './settings.service';

function setup() {
  const { prisma, db, forCompany } = createTenantDbMock(['aiSettings']);
  db.aiSettings!.findFirst!.mockResolvedValue(null);
  const audit = { record: jest.fn(), log: jest.fn() };
  const service = new SettingsService(prisma, audit as unknown as AuditService);
  return { service, db, forCompany, audit };
}

describe('SettingsService.settings', () => {
  it('runs on the TZ defaults until a company saves anything', async () => {
    const { service, forCompany } = setup();

    const settings = await service.settings('company-a');

    expect(settings.fuelDeviationThresholdBp).toBe(700); // 7%
    expect(settings.idleAlertHours).toBe(2);
    expect(settings.routeDeviationKm).toBe(20);
    expect(settings.digestTime).toBe('20:00');
    expect(settings.ocrEnabled).toBe(true);
    expect(settings.monthlyLimitMicroUsd).toBe(50_000_000n); // $50
    expect(settings.currentUsageMicroUsd).toBe(0n);
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });

  it('reports what the company actually saved', async () => {
    const { service, db } = setup();
    db.aiSettings!.findFirst!.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      fuelDeviationThresholdBp: 500,
      ocrEnabled: false,
      monthlyLimitMicroUsd: 20_000_000n,
      currentUsageMicroUsd: 1_250_000n,
      usageMonth: '2026-08',
    });

    const settings = await service.settings('company-a');

    expect(settings.fuelDeviationThresholdBp).toBe(500);
    expect(settings.ocrEnabled).toBe(false);
    expect(settings.currentUsageMicroUsd).toBe(1_250_000n);
    expect(settings.usageMonth).toBe('2026-08');
  });
});

describe('SettingsService.update', () => {
  it('converts the dollars an owner types into the micro-USD stored', async () => {
    const { service, db } = setup();
    db.aiSettings!.findFirst!.mockResolvedValue({ id: 's1' });
    db.aiSettings!.update!.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      monthlyLimitMicroUsd: 30_000_000n,
    });

    await service.update(ACTOR, { monthlyLimitUsd: 30 });

    expect(db.aiSettings!.update!.mock.calls[0][0].data).toEqual({
      monthlyLimitMicroUsd: 30_000_000n,
    });
  });

  it('leaves the cap alone when the form did not touch it', async () => {
    const { service, db } = setup();
    db.aiSettings!.findFirst!.mockResolvedValue({ id: 's1' });
    db.aiSettings!.update!.mockResolvedValue(DEFAULT_SETTINGS);

    await service.update(ACTOR, { idleAlertHours: 3 });

    expect(db.aiSettings!.update!.mock.calls[0][0].data).toEqual({ idleAlertHours: 3 });
  });

  it('creates the row on first save, without taking companyId from the body', async () => {
    const { service, db } = setup();
    db.aiSettings!.create!.mockResolvedValue({ ...DEFAULT_SETTINGS, ocrEnabled: false });

    await service.update(ACTOR, { ocrEnabled: false });

    expect(db.aiSettings!.create!.mock.calls[0][0].data).toEqual({ ocrEnabled: false });
  });
});
