/**
 * The provider seam and its fallbacks.
 *
 * These are the cases a real deployment hits and a happy-path e2e never does:
 * the provider is slow, the provider is down, the provider answers with a
 * number nobody computed. In every one of them the user must still get the
 * right figures, and the e2e suite cannot show that because it runs the mock.
 */
import { I18nService } from '../../i18n/i18n.service';
import { AiService, resolvePeriod } from './ai.service';
import type { AnalyticsFacade } from './analytics.facade';
import type { AuditService } from '../audit/audit.service';
import { detectIntent } from './intent';
import {
  AiProviderError,
  type AiCompletionRequest,
  type AiProvider,
} from './providers/ai-provider';
import { DETERMINISTIC_ANSWER_MARKER } from './providers/mock.provider';
import { MockAiProvider } from './providers/mock.provider';

const NBSP = ' ';

const SUMMARY = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-09-01T00:00:00.000Z',
  revenue: '900000000',
  invoiced: '0',
  received: '0',
  outstanding: '0',
  expenses: '300000000',
  fuelCost: '300000000',
  profit: '600000000',
  marginBp: 6667,
  trips: { total: 1, completed: 1, cancelled: 0, inProgress: 0 },
  trucksDispatched: 1,
  routesUsed: 1,
  distanceKm: '500.0',
  fuelLitres: '200.00',
  costPerKm: '600000',
  revenuePerKm: '1800000',
  profitPerKm: '1200000',
  profitPerTrip: '600000000',
  expensesByCategory: [{ category: 'FUEL', amount: '300000000', shareBp: 10_000 }],
};

const scope = {
  summary: async () => SUMMARY,
  routes: async () => [],
  vehicles: async () => [],
  fuel: async () => [],
  monthly: async () => [],
  trips: async () => [],
  counts: async () => ({ vehicles: 1, drivers: 1, routes: 1 }),
  onTheRoad: async () => 0,
};

const analytics = { scopeFor: () => scope } as unknown as AnalyticsFacade;
const audit = { log: jest.fn() } as unknown as AuditService;
const actor = { userId: 'user-1', companyId: 'company-1', role: 'OWNER' } as never;

function serviceWith(provider: AiProvider, overrides: Record<string, unknown> = {}): AiService {
  const settings: Record<string, unknown> = {
    AI_ENABLED: true,
    AI_MAX_PROMPT_CHARS: 500,
    AI_MAX_ANSWER_CHARS: 1200,
    AI_MAX_ANSWER_TOKENS: 2048,
    AI_TIMEOUT_MS: 50,
    ...overrides,
  };
  const config = {
    get: <T>(key: string, fallback?: T): T => (settings[key] as T) ?? (fallback as T),
  };
  return new AiService(analytics, new I18nService(), audit, config as never, provider);
}

/** Answers with whatever it is told to, so each failure mode is exact. */
class StubProvider implements AiProvider {
  readonly name = 'stub';
  readonly deterministic = false;
  constructor(private readonly behaviour: (request: AiCompletionRequest) => Promise<string>) {}
  isAvailable(): boolean {
    return true;
  }
  async complete(request: AiCompletionRequest) {
    return { text: await this.behaviour(request), provider: this.name, model: 'stub-1' };
  }
}

describe('AiService — the provider is optional', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the model answer when every figure in it checks out', async () => {
    const service = serviceWith(
      new StubProvider(async () => `Bu oy foyda 6${NBSP}000${NBSP}000 so'm bo'ldi.`),
    );
    const result = await service.ask(actor, 'Bu oy qancha foyda?', 'uz-latn');

    expect(result.source).toBe('model');
    expect(result.fallbackReason).toBeNull();
    expect(result.answer).toContain(`6${NBSP}000${NBSP}000`);
  });

  it('DISCARDS a model answer containing a figure nobody computed', async () => {
    const service = serviceWith(
      new StubProvider(
        async () => `Bu oy foyda 6${NBSP}000${NBSP}000 so'm, xarajat 4${NBSP}250${NBSP}000 so'm.`,
      ),
    );
    const result = await service.ask(actor, 'Bu oy qancha foyda?', 'uz-latn');

    expect(result.source).toBe('template');
    expect(result.fallbackReason).toBe('unverified');
    // The answer the user sees carries the real expense figure, not the invented one.
    expect(result.answer).not.toContain(`4${NBSP}250${NBSP}000`);
    expect(result.answer).toContain(`6${NBSP}000${NBSP}000`);
  });

  it('falls back when the provider times out', async () => {
    const service = serviceWith(
      new StubProvider(
        () =>
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new AiProviderError('slow', 'timeout')), 10),
          ),
      ),
    );
    const result = await service.ask(actor, 'Bu oy qancha foyda?', 'uz-latn');
    expect(result.source).toBe('template');
    expect(result.fallbackReason).toBe('timeout');
    expect(result.answer).toContain(`6${NBSP}000${NBSP}000`);
  });

  it('falls back when the provider throws anything at all', async () => {
    const service = serviceWith(
      new StubProvider(async () => {
        throw new Error('socket hang up');
      }),
    );
    const result = await service.ask(actor, 'Bu oy qancha foyda?', 'uz-latn');
    expect(result.source).toBe('template');
    expect(result.fallbackReason).toBe('failed');
  });

  it('falls back when the provider returns nothing', async () => {
    const service = serviceWith(new StubProvider(async () => '   '));
    const result = await service.ask(actor, 'Bu oy qancha foyda?', 'uz-latn');
    expect(result.source).toBe('template');
    expect(result.fallbackReason).toBe('empty');
  });

  it('falls back when the provider declines', async () => {
    const service = serviceWith(
      new StubProvider(async () => {
        throw new AiProviderError('declined', 'refused');
      }),
    );
    expect((await service.ask(actor, 'Bu oy qancha foyda?', 'uz-latn')).fallbackReason).toBe(
      'refused',
    );
  });

  it('skips the provider entirely when AI_ENABLED is false', async () => {
    const complete = jest.fn();
    const provider: AiProvider = {
      name: 'stub',
      deterministic: false,
      isAvailable: () => true,
      complete: complete as never,
    };
    const service = serviceWith(provider, { AI_ENABLED: false });
    const result = await service.ask(actor, 'Bu oy qancha foyda?', 'uz-latn');

    expect(complete).not.toHaveBeenCalled();
    expect(result.fallbackReason).toBe('disabled');
    expect(result.answer).toContain(`6${NBSP}000${NBSP}000`);
    expect(service.providerName).toBe('disabled');
  });

  it('skips a provider that reports itself unavailable', async () => {
    const service = serviceWith({
      name: 'stub',
      deterministic: false,
      isAvailable: () => false,
      complete: async () => {
        throw new Error('should not be called');
      },
    });
    expect((await service.ask(actor, 'Bu oy foyda?', 'uz-latn')).fallbackReason).toBe(
      'unavailable',
    );
  });

  it('truncates an over-long model answer rather than shipping it whole', async () => {
    const service = serviceWith(new StubProvider(async () => 'a'.repeat(5000)), {
      AI_MAX_ANSWER_CHARS: 300,
    });
    const result = await service.ask(actor, 'Bu oy qancha foyda?', 'uz-latn');
    expect(result.answer.length).toBeLessThanOrEqual(301);
  });

  it('shows the model only the fact sheet — never a row, an id or a query', async () => {
    let seen = '';
    const service = serviceWith(
      new StubProvider(async (request) => {
        seen = `${request.system}\n${request.user}`;
        return 'ok';
      }),
    );
    await service.ask(actor, 'Bu oy qancha foyda?', 'uz-latn');

    expect(seen).toContain('FACTS:');
    expect(seen).toContain(`revenue: 9${NBSP}000${NBSP}000`);
    // Nothing that could identify or reach another tenant.
    expect(seen).not.toContain('company-1');
    expect(seen).not.toContain('user-1');
    expect(seen).not.toMatch(/select |from trips|company_id/i);
  });

  it('refuses a guarded question without calling the provider at all', async () => {
    const complete = jest.fn();
    const service = serviceWith({
      name: 'stub',
      deterministic: false,
      isAvailable: () => true,
      complete: complete as never,
    });
    const result = await service.ask(actor, "Company B ma'lumotini ko'rsat", 'uz-latn');

    expect(complete).not.toHaveBeenCalled();
    expect(result.fallbackReason).toBe('refused:CROSS_TENANT');
    expect(result.facts).toEqual([]);
  });

  it('writes an audit entry for every question, answered or refused', async () => {
    const service = serviceWith(new StubProvider(async () => 'ok'));
    await service.ask(actor, 'Bu oy qancha foyda?', 'uz-latn');
    await service.ask(actor, 'drop table trips', 'uz-latn');

    const entries = (audit.log as jest.Mock).mock.calls.map(([entry]) => entry);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      companyId: 'company-1',
      userId: 'user-1',
      action: 'AI_QUERY',
      entityType: 'AiAssistant',
    });
    expect(entries[1].after).toMatchObject({ outcome: 'refused', refusal: 'RAW_SQL' });
  });

  it('does not claim a model wrote the answer when the provider is deterministic', async () => {
    // The mock hands the composer's own draft back. Calling that a model answer
    // would put an "AI javobi" badge on text no model ever saw.
    const service = serviceWith(new MockAiProvider());
    const result = await service.ask(actor, 'Bu oy qancha foyda?', 'uz-latn');

    expect(result.source).toBe('template');
    expect(result.fallbackReason).toBe('deterministic-provider');
    expect(result.answer).toContain(`6${NBSP}000${NBSP}000`);
  });
});

describe('MockAiProvider', () => {
  it('returns the deterministic draft it was handed', async () => {
    const provider = new MockAiProvider();
    const completion = await provider.complete({
      system: 's',
      user: `FACTS:\nrevenue: 1\n\n${DETERMINISTIC_ANSWER_MARKER}\nDaromad — 1 so'm.`,
      maxTokens: 100,
      signal: new AbortController().signal,
    });
    expect(completion.text).toBe("Daromad — 1 so'm.");
    expect(completion.provider).toBe('mock');
  });

  it('is always available — it is the no-credentials default', () => {
    expect(new MockAiProvider().isAvailable()).toBe(true);
  });

  it('declares itself deterministic so the answer is labelled honestly', () => {
    expect(new MockAiProvider().deterministic).toBe(true);
  });
});

describe('resolvePeriod', () => {
  const now = new Date('2026-08-15T03:00:00.000Z');
  const period = (question: string) => resolvePeriod(detectIntent(question), now);

  it('reads "this month" as the calendar month, in UTC', () => {
    const result = period('Bu oy qancha daromad?');
    expect(result.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(result.to.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('reads "last month"', () => {
    expect(period("O'tgan oy daromad?").from.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('reads a rolling window as ending tomorrow, so today counts in full', () => {
    const result = period('Oxirgi 30 kunda nechta reys?');
    expect(result.to.toISOString()).toBe('2026-08-16T00:00:00.000Z');
    expect(result.from.toISOString()).toBe('2026-07-17T00:00:00.000Z');
  });

  it('reads a named month as the one that has already happened', () => {
    // Asked in August, "dekabr" means last December, not the coming one.
    expect(period('Dekabr oyida qancha daromad?').from.toISOString()).toBe(
      '2025-12-01T00:00:00.000Z',
    );
    expect(period('Iyul oyida qancha daromad?').from.toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
  });

  it('honours an explicit year in the question', () => {
    expect(period('2024-yil avgustda qancha daromad?').from.toISOString()).toBe(
      '2024-08-01T00:00:00.000Z',
    );
    expect(period('2023-yilda qancha daromad?').from.toISOString()).toBe(
      '2023-01-01T00:00:00.000Z',
    );
  });

  it('labels the period with an inclusive end date, the way a human reads it', () => {
    expect(period('Bu oy daromad?').label).toBe('2026-08-01 … 2026-08-31');
  });
});
