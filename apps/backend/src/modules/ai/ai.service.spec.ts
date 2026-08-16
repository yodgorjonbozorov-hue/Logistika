import { AiFeature } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { createTenantDbMock } from '../../test-utils/tenant-db.mock';
import type { AiClient, AiPrompt, AiRawResult } from './ai.client';
import { AiService, type AiRunOptions } from './ai.service';
import { asObject, confidenceBp, requiredString } from './ai.validation';

interface Parsed {
  station: string;
  confidenceBp: number | null;
}

function parseReceipt(raw: unknown): Parsed {
  const source = asObject(raw);
  return { station: requiredString(source, 'station'), confidenceBp: confidenceBp(source) };
}

const OCR_JSON = { station: 'AZS Jizzax', confidence: 0.95 };

function setup(
  options: {
    configured?: boolean;
    settings?: Record<string, unknown> | null;
    complete?: (prompt: AiPrompt) => Promise<AiRawResult>;
  } = {},
) {
  const { prisma, db, forCompany } = createTenantDbMock(['aiSettings', 'aiRequest']);
  db.aiSettings!.findFirst!.mockResolvedValue(options.settings ?? null);
  db.aiSettings!.create!.mockResolvedValue({ id: 's1' });
  db.aiSettings!.update!.mockResolvedValue({ id: 's1' });
  db.aiRequest!.create!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'req-1', ...data }),
  );

  const complete = jest.fn(
    options.complete ??
      (() => Promise.resolve({ json: OCR_JSON, promptTokens: 1500, completionTokens: 200 })),
  );
  const client = { configured: options.configured ?? true, complete } as unknown as AiClient;
  return { service: new AiService(prisma, client), db, forCompany, complete };
}

const RUN: AiRunOptions<Parsed> = {
  companyId: 'company-a',
  userId: 'user-1',
  feature: AiFeature.OCR,
  inputType: 'photo',
  inputRef: 'company-a/receipts/1.jpg',
  system: 'extract the receipt',
  messages: [{ role: 'user', content: 'photo' }],
  tool: { name: 'receipt', description: 'receipt fields', schema: { type: 'object' } },
  parse: parseReceipt,
  confidenceBp: (value) => value.confidenceBp,
};

async function expectCode(run: () => Promise<unknown>, code: string): Promise<void> {
  await expect(run()).rejects.toMatchObject({ code });
}

describe('AiService.run', () => {
  it('returns a validated proposal and logs it as unconfirmed', async () => {
    const { service, db, forCompany } = setup();

    const result = await service.run(RUN);

    expect(forCompany).toHaveBeenCalledWith('company-a');
    expect(result.data.station).toBe('AZS Jizzax');
    expect(result.confidenceBp).toBe(9500);
    // Haiku 1500 in + 200 out = 1500 + 1000 micro-USD.
    expect(result.costMicroUsd).toBe(2500n);

    const logged = db.aiRequest!.create!.mock.calls[0][0].data;
    expect(logged.status).toBe('SUCCEEDED');
    expect(logged.feature).toBe(AiFeature.OCR);
    expect(logged.costMicroUsd).toBe(2500n);
    expect(logged.confidenceBp).toBe(9500);
    // TZ §8.0: nothing is accepted until a person confirms it.
    expect(logged.isConfirmed).toBeUndefined();
  });

  it('writes nothing outside ai_requests / ai_settings', async () => {
    const { service, db } = setup();
    await service.run(RUN);
    expect(Object.keys(db)).toEqual(['aiSettings', 'aiRequest']);
  });

  it('never takes companyId from the payload — only the scoped client', async () => {
    const { service, db } = setup();
    await service.run(RUN);
    expect(db.aiRequest!.create!.mock.calls[0][0].data.companyId).toBeUndefined();
  });

  it('charges the running month and rolls a stale bucket over', async () => {
    const { service, db } = setup({
      settings: {
        id: 's1',
        usageMonth: '2026-07',
        currentUsageMicroUsd: 900n,
        monthlyLimitMicroUsd: 50_000_000n,
      },
    });
    db.aiSettings!.findFirst!.mockResolvedValueOnce({
      id: 's1',
      usageMonth: '2026-07',
      currentUsageMicroUsd: 900n,
      monthlyLimitMicroUsd: 50_000_000n,
    }).mockResolvedValueOnce({ id: 's1', usageMonth: '2026-07' });

    await service.run(RUN);

    // July's spend does not carry into the new month — it is replaced, not incremented.
    expect(db.aiSettings!.update!.mock.calls[0][0].data).toEqual({
      usageMonth: expect.any(String),
      currentUsageMicroUsd: 2500n,
    });
  });

  it('increments the same month instead of replacing it', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const { service, db } = setup({
      settings: {
        id: 's1',
        usageMonth: month,
        currentUsageMicroUsd: 900n,
        monthlyLimitMicroUsd: 50_000_000n,
      },
    });

    await service.run(RUN);

    expect(db.aiSettings!.update!.mock.calls[0][0].data).toEqual({
      currentUsageMicroUsd: { increment: 2500n },
    });
  });

  it('stops once the monthly cap is reached, without calling the model', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const { service, complete } = setup({
      settings: {
        id: 's1',
        usageMonth: month,
        currentUsageMicroUsd: 50_000_000n,
        monthlyLimitMicroUsd: 50_000_000n,
      },
    });

    await expectCode(() => service.run(RUN), 'AI_LIMIT_REACHED');
    expect(complete).not.toHaveBeenCalled();
  });

  it('refuses a feature the company switched off', async () => {
    const { service, complete } = setup({
      settings: { id: 's1', ocrEnabled: false, monthlyLimitMicroUsd: 50_000_000n },
    });

    await expectCode(() => service.run(RUN), 'AI_FEATURE_DISABLED');
    expect(complete).not.toHaveBeenCalled();
  });

  it('reports AI_NOT_CONFIGURED when no key is set, so manual entry stays open', async () => {
    const { service, complete } = setup({ configured: false });
    await expectCode(() => service.run(RUN), 'AI_NOT_CONFIGURED');
    expect(complete).not.toHaveBeenCalled();
    expect(service.available).toBe(false);
  });

  it('logs a failed call and rethrows, leaving the caller to fall back', async () => {
    const { service, db } = setup({
      complete: () =>
        Promise.reject(new AppException('AI_UNAVAILABLE', 503 as never)) as Promise<AiRawResult>,
    });

    await expectCode(() => service.run(RUN), 'AI_UNAVAILABLE');
    const logged = db.aiRequest!.create!.mock.calls[0][0].data;
    expect(logged.status).toBe('FAILED');
    expect(logged.errorCode).toBe('AI_UNAVAILABLE');
    expect(logged.costMicroUsd).toBe(0n);
    // Nothing was billed, because nothing came back.
    expect(db.aiSettings!.update).not.toHaveBeenCalled();
  });

  it('rejects an answer that does not validate, but still charges the tokens', async () => {
    const { service, db } = setup({
      complete: () =>
        Promise.resolve({ json: { station: null }, promptTokens: 1500, completionTokens: 200 }),
    });

    await expectCode(() => service.run(RUN), 'AI_INVALID_RESPONSE');
    const logged = db.aiRequest!.create!.mock.calls[0][0].data;
    expect(logged.status).toBe('FAILED');
    expect(logged.errorCode).toBe('AI_INVALID_RESPONSE');
    expect(logged.costMicroUsd).toBe(2500n);
    expect(db.aiSettings!.create).toHaveBeenCalled();
  });
});

describe('AiService.confirm', () => {
  it('records who accepted the proposal and what they corrected', async () => {
    const { service, db } = setup();
    db.aiRequest!.findFirst!.mockResolvedValue({ id: 'req-1' });
    db.aiRequest!.update!.mockResolvedValue({ id: 'req-1', isConfirmed: true });

    await service.confirm('company-a', 'req-1', 'user-9', { liters: 305 });

    const call = db.aiRequest!.update!.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'req-1' });
    expect(call.data).toMatchObject({
      isConfirmed: true,
      confirmedBy: 'user-9',
      correctedData: { liters: 305 },
    });
  });

  it('cannot confirm a request of another company', async () => {
    const { service, db, forCompany } = setup();
    db.aiRequest!.findFirst!.mockResolvedValue(null);

    await expectCode(() => service.confirm('company-b', 'req-1', 'user-9'), 'NOT_FOUND');
    expect(forCompany).toHaveBeenCalledWith('company-b');
    expect(db.aiRequest!.update).not.toHaveBeenCalled();
  });
});

describe('AiService.usage', () => {
  it('falls back to the default cap before a settings row exists', async () => {
    const { service } = setup();
    const usage = await service.usage('company-a');
    expect(usage.limitMicroUsd).toBe(50_000_000n);
    expect(usage.usedMicroUsd).toBe(0n);
    expect(usage.exhausted).toBe(false);
  });
});
