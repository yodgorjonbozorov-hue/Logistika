/**
 * What this pins down is mostly what must NOT appear: a log line is the one
 * artefact that outlives the request, gets shipped off the host and is kept for
 * months, so the body, the query string and the raw URL staying out of it is
 * the property worth a test.
 */
import type { NextFunction, Request, Response } from 'express';
import { currentRequestContext } from './request-context';
import { REQUEST_ID_HEADER, RequestLoggerMiddleware } from './request-logger.middleware';

type FinishHandler = () => void;

function createExchange(over: Partial<Request> = {}) {
  const handlers: FinishHandler[] = [];
  const headers: Record<string, string> = {};

  const request = {
    method: 'GET',
    url: '/api/v1/trips/8e1f?token=secret-capability',
    baseUrl: '/api/v1/trips',
    route: { path: '/:id' },
    headers: {},
    ...over,
  } as unknown as Request;

  const response = {
    statusCode: 200,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    on: (event: string, handler: FinishHandler) => {
      if (event === 'finish') handlers.push(handler);
    },
  } as unknown as Response;

  return { request, response, headers, finish: () => handlers.forEach((h) => h()) };
}

describe('RequestLoggerMiddleware', () => {
  const middleware = new RequestLoggerMiddleware();
  let written: string[];
  let spy: jest.SpyInstance;

  beforeEach(() => {
    written = [];
    spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    // The JSON branch is the production one, and the one worth testing.
    (middleware as unknown as { json: boolean }).json = true;
  });
  afterEach(() => spy.mockRestore());

  const run = (exchange: ReturnType<typeof createExchange>, next: NextFunction = () => {}) => {
    middleware.use(exchange.request, exchange.response, next);
    exchange.finish();
    return written.map((line) => JSON.parse(line) as Record<string, unknown>);
  };

  it('writes one JSON line with the fields a runbook asks for', () => {
    const [entry] = run(createExchange());
    expect(entry).toMatchObject({
      msg: 'request',
      method: 'GET',
      route: '/api/v1/trips/:id',
      statusCode: 200,
    });
    expect(typeof entry!.durationMs).toBe('number');
    expect(typeof entry!.requestId).toBe('string');
    expect(typeof entry!.time).toBe('string');
  });

  it('logs the route template, never the URL — a path parameter is tenant data', () => {
    // The fixture URL is /api/v1/trips/8e1f?token=secret-capability: a real
    // trip id and a public-tracking capability, both of which a log must not
    // preserve for six months.
    const [entry] = run(createExchange());
    expect(JSON.stringify(entry)).not.toContain('8e1f');
    expect(JSON.stringify(entry)).not.toContain('secret-capability');
  });

  it('carries the authenticated identity when there is one', () => {
    const exchange = createExchange({
      user: { userId: 'u-1', companyId: 'c-1', role: 'OWNER' },
    } as Partial<Request>);
    const [entry] = run(exchange);
    expect(entry).toMatchObject({ userId: 'u-1', companyId: 'c-1' });
  });

  it('records null rather than omitting the identity for an anonymous request', () => {
    const [entry] = run(createExchange());
    expect(entry!.userId).toBeNull();
    expect(entry!.companyId).toBeNull();
  });

  it('marks a 5xx at error level so an aggregator can alert on it', () => {
    const exchange = createExchange();
    (exchange.response as { statusCode: number }).statusCode = 503;
    expect(run(exchange)[0]).toMatchObject({ level: 'error', statusCode: 503 });
  });

  it('returns the request id to the client so a user can quote it in a report', () => {
    const exchange = createExchange();
    run(exchange);
    expect(exchange.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('adopts an upstream trace id so one id spans the whole hop chain', () => {
    const exchange = createExchange({ headers: { [REQUEST_ID_HEADER]: 'edge-abc123def' } });
    expect(run(exchange)[0]!.requestId).toBe('edge-abc123def');
  });

  it.each([
    ['a newline that would forge a second log line', 'abcdefgh\nlevel=info msg=forged'],
    ['a value too short to be a real trace id', 'x'],
    ['punctuation that is not id-shaped', 'abcdefgh{"injected":true}'],
  ])('refuses %s and issues its own id', (_label, supplied) => {
    const exchange = createExchange({ headers: { [REQUEST_ID_HEADER]: supplied } });
    const entry = run(exchange)[0]!;
    expect(entry.requestId).not.toBe(supplied);
    expect(entry.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('makes the id visible to code running inside the request', () => {
    const exchange = createExchange();
    let seen: string | undefined;
    middleware.use(exchange.request, exchange.response, () => {
      seen = currentRequestContext()?.requestId;
    });
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('says "unmatched" rather than guessing when no route matched', () => {
    const exchange = createExchange({ route: undefined, baseUrl: '' } as Partial<Request>);
    expect(run(exchange)[0]!.route).toBe('unmatched');
  });
});
