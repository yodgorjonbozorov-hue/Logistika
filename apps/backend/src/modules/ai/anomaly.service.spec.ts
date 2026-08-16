import { AiInsightStatus } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { I18nService } from '../../i18n/i18n.service';
import { createTenantDbMock } from '../../test-utils/tenant-db.mock';
import type { AiService } from './ai.service';
import { AnomalyService } from './anomaly.service';
import { parseNarrative } from './anomaly.prompt';

const NOW = new Date('2026-08-16T04:00:00Z');

const FUEL_ROW = {
  vehicleId: 'v1',
  plateNumber: '01 A 123 AA',
  normPer100km: '32.0',
  distanceKm: '3280.0',
  normLitres: '1049.60',
  actualLitres: '1229.60',
  deviationLitres: '180.00',
  deviationBp: 1715,
  avgPricePerLitre: 1_200_000n,
  lossTiyin: 216_000_000n,
  refuelCount: 4,
  exceedsThreshold: true,
};

const NARRATIVE = {
  title: '01 A 123 AA — yoqilgi anomaliyasi',
  description: 'Oxirgi 4 quyishda norma 17% oshgan.',
  recommendation: 'Cheklarni qayta tekshiring.',
};

function setup(options: { aiFails?: boolean; open?: { id: string } | null } = {}) {
  const { prisma, db, forCompany } = createTenantDbMock(['expense', 'driver', 'trip', 'aiInsight']);
  // Company itself is outside the tenant extension — it IS the tenant.
  (prisma as unknown as { company: Record<string, jest.Mock> }).company = {
    findMany: jest.fn().mockResolvedValue([{ id: 'company-a' }]),
    findUnique: jest.fn().mockResolvedValue({ locale: 'uz-latn' }),
  };

  db.aiInsight!.findFirst!.mockResolvedValue(options.open ?? null);
  db.aiInsight!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'i1', ...data }),
  );

  const sent: Record<string, unknown>[] = [];
  const run = jest.fn(async (opts: Record<string, unknown>) => {
    sent.push(opts);
    if (options.aiFails) throw new AppException('AI_LIMIT_REACHED', 429 as never);
    const parse = opts.parse as (raw: unknown, tool: string) => unknown;
    return {
      requestId: 'req-1',
      data: parse(NARRATIVE, 'explain_anomaly'),
      confidenceBp: null,
      costMicroUsd: 900n,
    };
  });
  const ai = { run } as unknown as AiService;

  const fuel = { control: jest.fn().mockResolvedValue([FUEL_ROW]) };
  const settings = { thresholds: jest.fn().mockResolvedValue({ fuelDeviationThresholdBp: 700 }) };

  const service = new AnomalyService(
    prisma,
    ai,
    fuel as never,
    settings as never,
    new I18nService(),
  );
  return { service, db, prisma, forCompany, sent, fuel };
}

describe('AnomalyService.scan', () => {
  it('stores an insight with the measured figures and the AI explanation', async () => {
    const { service, db, sent } = setup();

    const stored = await service.scan('company-a', NOW);

    expect(stored).toHaveLength(1);
    const data = db.aiInsight!.create!.mock.calls[0][0].data;
    expect(data.type).toBe('FUEL_OVERRUN');
    expect(data.severity).toBe('HIGH');
    expect(data.title).toBe(NARRATIVE.title);
    expect(data.estimatedLoss).toBe(216_000_000n);
    expect(data.data).toMatchObject({ deviationBp: 1715, thresholdBp: 700 });
    expect(data.locale).toBe('uz-latn');
    // The figures go TO the model; the model never produces them.
    expect(JSON.stringify(sent[0]!.messages)).toContain('1715');
  });

  it('falls back to the message catalogue when AI is unavailable', async () => {
    const { service, db } = setup({ aiFails: true });

    await service.scan('company-a', NOW);

    const data = db.aiInsight!.create!.mock.calls[0][0].data;
    // The anomaly is recorded either way — AI is a convenience (TZ §8.12.5).
    expect(data.type).toBe('FUEL_OVERRUN');
    expect(data.title).toContain('01 A 123 AA');
    expect(data.description).toContain('180.00');
    expect(data.recommendation).not.toBe('');
  });

  it('writes the explanation in the company language', async () => {
    const { service, db, prisma } = setup({ aiFails: true });
    (
      prisma as unknown as { company: { findUnique: jest.Mock } }
    ).company.findUnique.mockResolvedValue({ locale: 'ru' });

    await service.scan('company-a', NOW);

    const data = db.aiInsight!.create!.mock.calls[0][0].data;
    expect(data.locale).toBe('ru');
    expect(data.title).toContain('перерасход');
  });

  it('does not report the same open anomaly twice', async () => {
    const { service, db } = setup({ open: { id: 'i-old' } });

    expect(await service.scan('company-a', NOW)).toEqual([]);
    expect(db.aiInsight!.create).not.toHaveBeenCalled();
    expect(db.aiInsight!.findFirst!.mock.calls[0][0].where).toMatchObject({
      type: 'FUEL_OVERRUN',
      relatedId: 'v1',
    });
  });

  it('scopes every read to the company', async () => {
    const { service, forCompany, fuel } = setup();
    await service.scan('company-a', NOW);
    expect(forCompany).toHaveBeenCalledWith('company-a');
    expect(fuel.control.mock.calls[0][0].companyId).toBe('company-a');
  });
});

describe('AnomalyService.scanAllCompanies', () => {
  it('keeps going when one tenant fails', async () => {
    const { service, prisma, db } = setup();
    (prisma as unknown as { company: { findMany: jest.Mock } }).company.findMany.mockResolvedValue([
      { id: 'company-a' },
      { id: 'company-b' },
    ]);
    db.aiInsight!.create!.mockRejectedValueOnce(new Error('database is on fire'));

    await service.scanAllCompanies();

    expect(db.aiInsight!.create).toHaveBeenCalledTimes(2);
  });
});

describe('AnomalyService.setStatus', () => {
  it('records the verdict and who gave it', async () => {
    const { service, db } = setup();
    db.aiInsight!.findFirst!.mockResolvedValue({ id: 'i1' });
    db.aiInsight!.update!.mockResolvedValue({ id: 'i1' });

    await service.setStatus('company-a', 'i1', AiInsightStatus.FALSE_POSITIVE, 'user-9');

    expect(db.aiInsight!.update!.mock.calls[0][0].data).toMatchObject({
      status: AiInsightStatus.FALSE_POSITIVE,
      reviewedBy: 'user-9',
    });
  });

  it('cannot touch an insight of another company', async () => {
    const { service, db } = setup();
    db.aiInsight!.findFirst!.mockResolvedValue(null);

    await expect(
      service.setStatus('company-b', 'i1', AiInsightStatus.RESOLVED, 'user-9'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.aiInsight!.update).not.toHaveBeenCalled();
  });
});

describe('parseNarrative', () => {
  it('accepts an explanation and rejects an empty one', () => {
    expect(parseNarrative(NARRATIVE)).toEqual(NARRATIVE);
    expect(parseNarrative({ ...NARRATIVE, recommendation: null }).recommendation).toBeNull();
    expect(() => parseNarrative({ description: 'no title' })).toThrow(AppException);
  });
});
