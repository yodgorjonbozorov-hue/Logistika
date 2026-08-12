import type { AiClientService } from './ai-client.service';
import type { FilesService } from '../files/files.service';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { estimateCostUsd } from './ai.constants';
import { amountMatches, OcrService } from './ocr.service';

const AI_RESULT = {
  text: `\`\`\`json
{"docType":"FUEL_RECEIPT","stationName":"Lukoil","liters":302,"pricePerLiterSom":13900,"totalAmountSom":4197800,"documentDate":"2026-08-06T09:22:00Z","odometer":null,"description":"Dizel","confidence":0.93}
\`\`\``,
  model: 'claude-haiku-4-5',
  inputTokens: 1200,
  outputTokens: 180,
  costUsd: 0.0021,
  latencyMs: 900,
};

describe('estimateCostUsd', () => {
  it('prices tokens per model', () => {
    // haiku: (1200×$1 + 180×$5) / 1M = 0.0021
    expect(estimateCostUsd('claude-haiku-4-5', 1200, 180)).toBe(0.0021);
    expect(estimateCostUsd('claude-sonnet-5', 1000, 1000)).toBe(0.018);
  });

  it('unknown models fall back to the most expensive price', () => {
    expect(estimateCostUsd('mystery-model', 1_000_000, 0)).toBe(5);
  });
});

describe('amountMatches (TZ §8.3 ±1%)', () => {
  it('accepts an exact and near match, rejects a big gap', () => {
    expect(amountMatches({ liters: 302, pricePerLiterSom: 13900, totalAmountSom: 4197800 })).toBe(
      true,
    );
    expect(amountMatches({ liters: 302, pricePerLiterSom: 13900, totalAmountSom: 4230000 })).toBe(
      true,
    ); // +0.77%
    expect(amountMatches({ liters: 302, pricePerLiterSom: 13900, totalAmountSom: 5000000 })).toBe(
      false,
    );
  });

  it('is null when any input is missing', () => {
    expect(
      amountMatches({ liters: null, pricePerLiterSom: 13900, totalAmountSom: 100 }),
    ).toBeNull();
  });
});

describe('OcrService', () => {
  function setup(overrides: { aiText?: string } = {}) {
    const mock = createTenantDbMock([
      'aiSettings',
      'aiRequest',
      'storedFile',
      'trip',
      'expense',
      'fuelLog',
    ]);
    const aiClient = {
      enabled: true,
      vision: jest
        .fn()
        .mockResolvedValue({ ...AI_RESULT, text: overrides.aiText ?? AI_RESULT.text }),
    };
    const files = {
      getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-image-bytes')),
    };
    const service = new OcrService(
      mock.prisma,
      aiClient as unknown as AiClientService,
      files as unknown as FilesService,
    );

    // Defaults: settings present, OCR on, nothing spent, file exists, no duplicate.
    mock.db.aiSettings!.findFirst!.mockResolvedValue({ ocrEnabled: true, monthlyAiLimitUsd: 50 });
    mock.db.aiRequest!.findMany!.mockResolvedValue([]);
    mock.db.storedFile!.findUnique!.mockResolvedValue({
      id: 'file-1',
      key: 'company-a/x.jpg',
      mimeType: 'image/jpeg',
    });
    mock.db.aiRequest!.findFirst!.mockResolvedValue(null);
    mock.db.aiRequest!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'req-1', ...data }),
    );
    return { service, db: mock.db, aiClient, files };
  }

  describe('analyze (AI-2)', () => {
    it('returns a validated proposal with auto-checks and logs the request', async () => {
      const { service, db } = setup();
      const analysis = await service.analyze(ACTOR, { fileId: 'file-1' });

      expect(analysis.proposal.docType).toBe('FUEL_RECEIPT');
      expect(analysis.proposal.liters).toBe(302);
      expect(analysis.checks.amountMatches).toBe(true);
      expect(analysis.checks.duplicateReceipt).toBe(false);

      const logged = db.aiRequest!.create!.mock.calls[0][0].data;
      expect(logged.feature).toBe('ocr');
      expect(logged.receiptHash).toHaveLength(64);
      expect(logged.costUsd).toBe(AI_RESULT.costUsd);
    });

    it('NEVER writes business records — only the ai_requests log (TZ §8.12.1)', async () => {
      const { service, db } = setup();
      await service.analyze(ACTOR, { fileId: 'file-1' });
      expect(db.expense!.create).not.toHaveBeenCalled();
      expect(db.fuelLog!.create).not.toHaveBeenCalled();
    });

    it('flags a duplicate receipt (fraud check)', async () => {
      const { service, db } = setup();
      db.aiRequest!.findFirst!.mockResolvedValue({ id: 'older-request' });
      const analysis = await service.analyze(ACTOR, { fileId: 'file-1' });
      expect(analysis.checks.duplicateReceipt).toBe(true);
    });

    it('blocks when the monthly limit is spent', async () => {
      const { service, db } = setup();
      db.aiRequest!.findMany!.mockResolvedValue([{ costUsd: 30 }, { costUsd: 25 }]);
      await expect(service.analyze(ACTOR, { fileId: 'file-1' })).rejects.toMatchObject({
        code: 'AI_LIMIT_EXCEEDED',
      });
    });

    it('blocks when OCR is disabled in company settings', async () => {
      const { service, db } = setup();
      db.aiSettings!.findFirst!.mockResolvedValue({ ocrEnabled: false, monthlyAiLimitUsd: 50 });
      await expect(service.analyze(ACTOR, { fileId: 'file-1' })).rejects.toMatchObject({
        code: 'AI_DISABLED',
      });
    });

    it('rejects malformed AI output as AI_PARSE_FAILED (validated like external input)', async () => {
      const { service } = setup({ aiText: 'sorry, no json here' });
      await expect(service.analyze(ACTOR, { fileId: 'file-1' })).rejects.toMatchObject({
        code: 'AI_PARSE_FAILED',
      });
    });

    it('sanitizes suspicious values instead of trusting them', async () => {
      const { service } = setup({
        aiText: '{"docType":"HACK","liters":-5,"totalAmountSom":"NaN","confidence":7}',
      });
      const analysis = await service.analyze(ACTOR, { fileId: 'file-1' });
      expect(analysis.proposal.docType).toBe('OTHER');
      expect(analysis.proposal.liters).toBeNull();
      expect(analysis.proposal.totalAmountSom).toBeNull();
      expect(analysis.proposal.confidence).toBeLessThanOrEqual(1);
    });

    it('404s for a foreign file (tenant isolation)', async () => {
      const { service, db } = setup();
      db.storedFile!.findUnique!.mockResolvedValue(null);
      await expect(service.analyze(ACTOR, { fileId: 'foreign' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('confirm', () => {
    const storedRequest = {
      id: 'req-1',
      feature: 'ocr',
      isConfirmed: false,
      inputRef: 'file-1',
      responseJson: {
        docType: 'FUEL_RECEIPT',
        stationName: 'Lukoil',
        liters: 302,
        pricePerLiterSom: 13900,
        totalAmountSom: 4197800,
        documentDate: '2026-08-06T09:22:00Z',
        odometer: null,
        description: 'Dizel',
        confidence: 0.93,
      },
    };

    it('creates an expense in tiyin BigInt after human approval', async () => {
      const { service, db } = setup();
      db.aiRequest!.findUnique!.mockResolvedValue(storedRequest);
      db.expense!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'e-1', ...data }),
      );
      db.aiRequest!.update!.mockResolvedValue({});

      const result = await service.confirm(ACTOR, 'req-1', { target: 'EXPENSE', tripId: 't-1' });
      expect(result).toEqual({ createdType: 'EXPENSE', createdId: 'e-1' });

      const data = db.expense!.create!.mock.calls[0][0].data;
      expect(data.category).toBe('FUEL');
      expect(data.amount).toBe(419_780_000n); // 4 197 800 so'm in tiyin
      expect(typeof data.amount).toBe('bigint');

      const update = db.aiRequest!.update!.mock.calls[0][0].data;
      expect(update.isConfirmed).toBe(true);
      expect(update.confirmedById).toBe(ACTOR.userId);
    });

    it('applies human corrections and stores them for the accuracy loop', async () => {
      const { service, db } = setup();
      db.aiRequest!.findUnique!.mockResolvedValue(storedRequest);
      db.fuelLog!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'f-1', ...data }),
      );
      db.aiRequest!.update!.mockResolvedValue({});

      await service.confirm(ACTOR, 'req-1', {
        target: 'FUEL',
        vehicleId: 'v-1',
        corrections: { liters: 310 },
      });

      expect(db.fuelLog!.create!.mock.calls[0][0].data.liters).toBe(310);
      expect(db.aiRequest!.update!.mock.calls[0][0].data.correctedData).toEqual({ liters: 310 });
    });

    it('refuses to confirm the same request twice', async () => {
      const { service, db } = setup();
      db.aiRequest!.findUnique!.mockResolvedValue({ ...storedRequest, isConfirmed: true });
      await expect(service.confirm(ACTOR, 'req-1', { target: 'EXPENSE' })).rejects.toMatchObject({
        code: 'ALREADY_EXISTS',
      });
    });
  });

  describe('usage', () => {
    it('sums this month per feature', async () => {
      const { service, db } = setup();
      db.aiRequest!.findMany!.mockResolvedValue([
        { feature: 'ocr', costUsd: 0.002 },
        { feature: 'ocr', costUsd: 0.003 },
        { feature: 'chat', costUsd: 0.01 },
      ]);
      const usage = await service.usage(ACTOR);
      expect(usage.monthUsd).toBe(0.015);
      expect(usage.limitUsd).toBe(50);
      expect(usage.requestCount).toBe(3);
      expect(usage.byFeature.ocr).toBe(0.005);
    });
  });
});
