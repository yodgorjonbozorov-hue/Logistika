import { AppException } from '../../common/exceptions/app.exception';
import { I18nService } from '../../i18n/i18n.service';
import { createTenantDbMock } from '../../test-utils/tenant-db.mock';
import type { AiService } from './ai.service';
import { DigestService } from './digest.service';
import { digestUserMessage, parseDigest } from './digest.prompt';
import type { DigestFacts } from './digest.facts';

/** 15:00 UTC is 20:00 in Tashkent — the TZ §8.9 digest hour. */
const AT_DIGEST_HOUR = new Date('2026-08-16T15:00:00Z');

const TOTALS = {
  revenue: 4_200_000_000n,
  cost: 2_600_000_000n,
  profit: 1_600_000_000n,
};

function setup(
  options: {
    aiFails?: boolean;
    chats?: string[];
    configured?: boolean;
    company?: { timezone: string; locale: string };
    quiet?: boolean;
  } = {},
) {
  const { prisma, db, forCompany } = createTenantDbMock(['trip', 'vehicle', 'aiInsight']);
  const company = options.company ?? { timezone: 'Asia/Tashkent', locale: 'uz-latn' };
  (prisma as unknown as { company: Record<string, jest.Mock> }).company = {
    findMany: jest.fn().mockResolvedValue([{ id: 'company-a', timezone: company.timezone }]),
    findUnique: jest.fn().mockResolvedValue(company),
  };

  const busy = !options.quiet;
  db.trip!.findMany!.mockResolvedValue(busy ? [{ vehicleId: 'v1' }, { vehicleId: 'v2' }] : []);
  db.vehicle!.count!.mockResolvedValue(9);
  db.trip!.count!.mockResolvedValue(busy ? 3 : 0);
  db.aiInsight!.findMany!.mockResolvedValue(
    busy ? [{ title: '01 A 456 BB', description: "yoqilg'i normadan oshdi" }] : [],
  );

  const sent: Record<string, unknown>[] = [];
  const run = jest.fn(async (opts: Record<string, unknown>) => {
    sent.push(opts);
    if (options.aiFails) throw new AppException('AI_UNAVAILABLE', 503 as never);
    const parse = opts.parse as (raw: unknown, tool: string) => unknown;
    return {
      requestId: 'req-1',
      data: parse({ message: 'AI yozgan xulosa' }, 'write_digest'),
      confidenceBp: null,
      costMicroUsd: 400n,
    };
  });
  const ai = { run } as unknown as AiService;

  const finance = { summary: jest.fn().mockResolvedValue(TOTALS) };
  const documents = { expiring: jest.fn().mockResolvedValue(busy ? [{ id: 'd1' }] : []) };
  const settings = { thresholds: jest.fn().mockResolvedValue({ digestTime: '20:00' }) };
  const notifications = {
    digestRecipients: jest.fn().mockResolvedValue(options.chats ?? ['12345']),
  };
  const telegram = {
    configured: options.configured ?? true,
    send: jest.fn().mockResolvedValue(true),
  };

  const service = new DigestService(
    prisma,
    ai,
    finance as never,
    documents as never,
    settings as never,
    notifications as never,
    telegram as never,
    new I18nService(),
  );
  return { service, db, prisma, forCompany, telegram, settings, sent };
}

describe('DigestService.sendDigest', () => {
  it('sends the AI-worded message to every linked owner chat', async () => {
    const { service, telegram } = setup({ chats: ['111', '222'] });

    expect(await service.sendDigest('company-a', AT_DIGEST_HOUR)).toBe(2);
    expect(telegram.send).toHaveBeenCalledWith('111', 'AI yozgan xulosa');
    expect(telegram.send).toHaveBeenCalledWith('222', 'AI yozgan xulosa');
  });

  it('sends the plain digest when AI cannot word it', async () => {
    const { service, telegram } = setup({ aiFails: true });

    await service.sendDigest('company-a', AT_DIGEST_HOUR);

    const message = telegram.send.mock.calls[0][1] as string;
    // The same figures go out either way, in so'm.
    expect(message).toContain('42000000');
    expect(message).toContain('16000000');
    expect(message).toContain('01 A 456 BB');
  });

  it('writes the plain digest in the company language', async () => {
    const { service, telegram } = setup({
      aiFails: true,
      company: { timezone: 'Asia/Tashkent', locale: 'ru' },
    });

    await service.sendDigest('company-a', AT_DIGEST_HOUR);

    expect(telegram.send.mock.calls[0][1] as string).toContain('Итоги');
  });

  it('says nothing when nobody linked a chat', async () => {
    const { service, telegram } = setup({ chats: [] });
    expect(await service.sendDigest('company-a', AT_DIGEST_HOUR)).toBe(0);
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('says nothing on a day where nothing happened', async () => {
    const { service, telegram } = setup({ quiet: true });
    expect(await service.sendDigest('company-a', AT_DIGEST_HOUR)).toBe(0);
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('hands the figures to the model rather than asking for them', async () => {
    const { service, sent } = setup();
    await service.sendDigest('company-a', AT_DIGEST_HOUR);
    expect(JSON.stringify(sent[0]!.messages)).toContain('4200000000'); // tiyin, unrounded
  });

  it('reads the day through the tenant-scoped client', async () => {
    const { service, forCompany } = setup();
    await service.sendDigest('company-a', AT_DIGEST_HOUR);
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });
});

describe('DigestService.sendDueDigests', () => {
  it('sends at the company own 20:00, not the server one', async () => {
    const { service, telegram } = setup();

    await service.sendDueDigests(AT_DIGEST_HOUR);
    expect(telegram.send).toHaveBeenCalledTimes(1);

    telegram.send.mockClear();
    await service.sendDueDigests(new Date('2026-08-16T09:00:00Z')); // 14:00 local
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('does nothing at all without a bot token', async () => {
    const { service, prisma } = setup({ configured: false });
    await service.sendDueDigests(AT_DIGEST_HOUR);
    expect(
      (prisma as unknown as { company: { findMany: jest.Mock } }).company.findMany,
    ).not.toHaveBeenCalled();
  });

  it('keeps going when one company fails', async () => {
    const { service, prisma, settings, telegram } = setup();
    (prisma as unknown as { company: { findMany: jest.Mock } }).company.findMany.mockResolvedValue([
      { id: 'company-a', timezone: 'Asia/Tashkent' },
      { id: 'company-b', timezone: 'Asia/Tashkent' },
    ]);
    settings.thresholds.mockRejectedValueOnce(new Error('settings unreadable'));

    await service.sendDueDigests(AT_DIGEST_HOUR);

    expect(telegram.send).toHaveBeenCalledTimes(1);
  });
});

describe('the digest prompt', () => {
  const FACTS: DigestFacts = {
    date: '2026-08-16',
    vehiclesOnRoad: 7,
    vehiclesTotal: 9,
    tripsFinished: 3,
    tripsStarted: 2,
    revenueToday: 4_200_000_000n,
    expensesToday: 2_600_000_000n,
    profitToday: 1_600_000_000n,
    attention: [{ title: '01 A 456 BB', detail: "yoqilg'i normadan oshdi" }],
    loadingsTomorrow: 2,
    documentsExpiringSoon: 1,
  };

  it('states every figure in tiyin, and marks an empty attention list', () => {
    expect(digestUserMessage(FACTS)).toContain('4200000000 tiyin');
    expect(digestUserMessage({ ...FACTS, attention: [] })).toContain('nothing');
  });

  it('rejects an empty message from the model', () => {
    expect(parseDigest({ message: 'ok' })).toEqual({ message: 'ok' });
    expect(() => parseDigest({ message: '' })).toThrow(AppException);
  });
});
