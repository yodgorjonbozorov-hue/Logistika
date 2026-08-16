import { AppException } from '../../common/exceptions/app.exception';
import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import type { AiService } from './ai.service';
import { CHAT_FUNCTIONS, CHAT_TOOLS, parseChatCall } from './chat.functions';
import { ChatService } from './chat.service';
import { chatResultMessage, parseChatAnswer } from './chat.prompt';

const VEHICLES = [
  { vehicleId: 'v1', plateNumber: '01 A 123 AA', profit: 18_600_000_000n, roiBp: 2100 },
  { vehicleId: 'v2', plateNumber: '01 A 456 BB', profit: -4_200_000_000n, roiBp: -500 },
];

const ANSWER = { answer: 'Iyul oyida 01 A 456 BB zarar keltirdi.', chart: 'bar' };

function setup(
  options: { route?: { tool: string; args: Record<string, unknown> }; rows?: unknown[] } = {},
) {
  const { prisma } = createTenantDbMock([]);
  (prisma as unknown as { company: Record<string, jest.Mock> }).company = {
    findUnique: jest.fn().mockResolvedValue({ locale: 'uz-latn' }),
  };

  const sent: Record<string, unknown>[] = [];
  const run = jest.fn(async (opts: Record<string, unknown>) => {
    sent.push(opts);
    const parse = opts.parse as (raw: unknown, tool: string) => unknown;
    const first = sent.length === 1;
    const routing = options.route ?? { tool: 'get_vehicle_profit', args: {} };
    const data = first ? parse(routing.args, routing.tool) : parse(ANSWER, 'answer_question');
    return {
      requestId: first ? 'req-route' : 'req-answer',
      data,
      confidenceBp: null,
      costMicroUsd: 900n,
    };
  });
  const ai = { run } as unknown as AiService;

  const finance = {
    fleetEconomics: jest.fn().mockResolvedValue(options.rows ?? VEHICLES),
    receivables: jest.fn().mockResolvedValue([
      { clientId: 'c1', clientName: 'Alfa Trans', pending: 0n, overdue: 34_000_000_000n },
      { clientId: 'c2', clientName: 'Beta', pending: 5_000_000_000n, overdue: 0n },
    ]),
    summary: jest.fn().mockResolvedValue({ profit: 16_000_000_000n }),
  };
  const fuel = { control: jest.fn().mockResolvedValue([]) };
  const reports = {
    table: jest.fn().mockResolvedValue({
      key: 'drivers',
      titleKey: 'reports.drivers.title',
      columns: [{ key: 'driver', labelKey: 'reports.column.driver', type: 'text' }],
      rows: [{ driver: 'Alisher' }, { driver: 'Bobur' }],
    }),
  };

  const service = new ChatService(prisma, ai, finance as never, fuel as never, reports as never);
  return { service, sent, finance, fuel, reports };
}

describe('ChatService.ask', () => {
  it('routes the question, runs the query itself, and words the result', async () => {
    const { service, finance } = setup();

    const reply = await service.ask(ACTOR, 'Shu oy qaysi mashina zarar keltirdi?');

    expect(reply.answer).toBe(ANSWER.answer);
    expect(reply.chart).toBe('bar');
    expect(reply.source.function).toBe('get_vehicle_profit');
    expect(reply.source.rowCount).toBe(2);
    expect(reply.requestIds).toEqual(['req-route', 'req-answer']);
    // The query ran on the ordinary finance service, tenant-scoped as always.
    expect(finance.fleetEconomics).toHaveBeenCalledTimes(1);
    expect(finance.fleetEconomics.mock.calls[0][0].companyId).toBe('company-a');
  });

  it('offers the model the whitelist in step one and nothing else in step two', async () => {
    const { service, sent } = setup();
    await service.ask(ACTOR, 'Kim menga qarzdor?');

    const offered = (sent[0]!.tools as { name: string }[]).map((tool) => tool.name);
    expect(offered).toEqual([...CHAT_FUNCTIONS]);
    expect((sent[1]!.tools as { name: string }[]).map((t) => t.name)).toEqual(['answer_question']);
  });

  it('hands the figures to the model instead of asking for them', async () => {
    const { service, sent } = setup();
    await service.ask(ACTOR, 'Qaysi mashina foydali?');

    const message = JSON.stringify(sent[1]!.messages);
    expect(message).toContain('18600000000'); // profit in tiyin, unrounded
    expect(message).toContain('get_vehicle_profit');
  });

  it('filters to the subject the question named', async () => {
    const { service } = setup({
      route: { tool: 'get_vehicle_profit', args: { vehicle: '456 BB' } },
    });

    const reply = await service.ask(ACTOR, '01 A 456 BB qancha foyda keltirdi?');

    expect(reply.data).toEqual([VEHICLES[1]]);
  });

  it('shows everything rather than nothing when the named subject matches none', async () => {
    const { service } = setup({
      route: { tool: 'get_vehicle_profit', args: { vehicle: 'bunday mashina yo‘q' } },
    });

    expect(await service.ask(ACTOR, 'X mashina-chi?')).toMatchObject({
      source: { rowCount: 2 },
    });
  });

  it('runs the receivables query with the status filter', async () => {
    const { service } = setup({
      route: { tool: 'get_receivables', args: { status: 'overdue' } },
    });

    const reply = await service.ask(ACTOR, 'Kim menga qarzdor?');

    expect((reply.data as Array<{ clientName: string }>).map((row) => row.clientName)).toEqual([
      'Alfa Trans',
    ]);
  });

  it('compares two periods by running the summary twice', async () => {
    const { service, finance } = setup({
      route: {
        tool: 'compare_periods',
        args: {
          metric: 'profit',
          from: '2026-07-01',
          to: '2026-07-31',
          compare_from: '2026-06-01',
          compare_to: '2026-06-30',
        },
      },
    });

    const reply = await service.ask(ACTOR, "O'tgan oyga nisbatan foyda o'sdimi?");

    expect(finance.summary).toHaveBeenCalledTimes(2);
    expect(reply.data).toMatchObject({ metric: 'profit' });
    expect(reply.source.from).toContain('2026-07-01');
  });
});

describe('the AI-3 whitelist (TZ §8.4 / §8.12 rule 2)', () => {
  it('accepts every documented function and rejects anything else', () => {
    for (const name of CHAT_FUNCTIONS) {
      // compare_periods is the one call that needs an argument to mean anything.
      const args = name === 'compare_periods' ? { metric: 'profit' } : {};
      expect(parseChatCall(args, name).name).toBe(name);
    }
    expect(() => parseChatCall({}, 'run_sql')).toThrow(AppException);
    expect(() => parseChatCall({}, 'get_vehicle_profit; DROP TABLE trips')).toThrow(AppException);
  });

  it('exposes exactly the documented functions as tools', () => {
    expect(CHAT_TOOLS.map((tool) => tool.name)).toEqual([...CHAT_FUNCTIONS]);
  });

  it('defaults to the current month when the model names no period', () => {
    const call = parseChatCall({}, 'get_fuel_anomalies');
    expect(call.period.fromDate.getUTCDate()).toBe(1);
    expect(call.period.toDate.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('reads explicit dates and refuses unparseable ones', () => {
    const call = parseChatCall({ from: '2026-07-01', to: '2026-07-31' }, 'get_vehicle_profit');
    expect(call.period.fromDate.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(() => parseChatCall({ from: 'o‘tgan oy' }, 'get_vehicle_profit')).toThrow(AppException);
  });

  it('insists on a metric for a comparison', () => {
    expect(() => parseChatCall({}, 'compare_periods')).toThrow(AppException);
    expect(() => parseChatCall({ metric: 'karma' }, 'compare_periods')).toThrow(AppException);
    expect(parseChatCall({ metric: 'profit' }, 'compare_periods').metric).toBe('profit');
  });
});

describe('parseChatAnswer', () => {
  it('takes the answer and a chart hint, defaulting to none', () => {
    expect(parseChatAnswer(ANSWER)).toEqual(ANSWER);
    expect(parseChatAnswer({ answer: 'ha' }).chart).toBe('none');
    expect(() => parseChatAnswer({ chart: 'bar' })).toThrow(AppException);
    expect(() => parseChatAnswer({ answer: 'ha', chart: 'sankey' })).toThrow(AppException);
  });
});

describe('chatResultMessage', () => {
  it('serialises BigInt tiyin as digits, so nothing is rounded on the way', () => {
    const call = parseChatCall({ from: '2026-07-01', to: '2026-07-31' }, 'get_vehicle_profit');
    const message = chatResultMessage('savol', call, [{ profit: 18_600_000_000n }]);
    expect(message).toContain('"18600000000"');
    expect(message).toContain('2026-07-01');
  });
});
