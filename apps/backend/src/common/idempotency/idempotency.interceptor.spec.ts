import { Prisma } from '@prisma/client';
import { of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import type { PrismaService } from '../../prisma/prisma.service';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('IdempotencyInterceptor', () => {
  function setup(options: { required?: boolean; key?: string; body?: unknown } = {}) {
    const store = {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = { idempotencyKey: store } as unknown as PrismaService;
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(options.required ?? true),
    } as unknown as Reflector;

    const response = { statusCode: 201, status: jest.fn() };
    const request = {
      method: 'POST',
      path: '/api/v1/expenses',
      route: { path: '/api/v1/expenses' },
      headers: options.key === undefined ? {} : { 'idempotency-key': options.key },
      body: options.body ?? { amount: '1000', category: 'FUEL' },
      user: { userId: 'u1', companyId: 'company-a', role: 'OWNER' },
    };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ExecutionContext;

    const handler: CallHandler = { handle: jest.fn(() => of({ id: 'e1' })) };
    return {
      interceptor: new IdempotencyInterceptor(prisma, reflector),
      context,
      handler,
      store,
      response,
      request,
    };
  }

  it('lets unmarked endpoints straight through', async () => {
    const { interceptor, context, handler, store } = setup({ required: false });

    await interceptor.intercept(context, handler);

    expect(handler.handle).toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
  });

  it('refuses a money request with no key, or an implausibly short one', async () => {
    for (const key of [undefined, 'short']) {
      const { interceptor, context, handler } = setup({ key });
      await expect(interceptor.intercept(context, handler)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(handler.handle).not.toHaveBeenCalled();
    }
  });

  it('claims the key before running the handler, not after', async () => {
    const { interceptor, context, handler, store } = setup({ key: 'key-12345678' });

    await interceptor.intercept(context, handler);

    // Checking first and writing afterwards leaves the double-click window open.
    const claimOrder = store.create.mock.invocationCallOrder[0]!;
    const handlerOrder = (handler.handle as jest.Mock).mock.invocationCallOrder[0]!;
    expect(claimOrder).toBeLessThan(handlerOrder);
    // The claim is marked in-progress until the answer is known.
    expect(store.create.mock.calls[0][0].data.statusCode).toBe(0);
  });

  it('stores the response once the handler succeeds', async () => {
    const { interceptor, context, handler, store } = setup({ key: 'key-12345678' });

    await interceptor.intercept(context, handler);

    expect(store.update).toHaveBeenCalledWith({
      where: { companyId_key: { companyId: 'company-a', key: 'key-12345678' } },
      data: { statusCode: 201, responseBody: { id: 'e1' } },
    });
  });

  it('replays the stored answer for a repeat of the same request', async () => {
    const { interceptor, context, handler, store, response } = setup({ key: 'key-12345678' });
    store.create.mockRejectedValue(uniqueViolation());
    store.findUnique.mockResolvedValue({
      statusCode: 201,
      responseBody: { id: 'first-answer' },
      endpoint: 'POST /api/v1/expenses',
      // Same body as the request, so the hash matches.
      requestHash: await hashOf({ amount: '1000', category: 'FUEL' }),
    });

    const result = await interceptor.intercept(context, handler);

    expect(handler.handle).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(201);
    await expect(firstValue(result)).resolves.toEqual({ id: 'first-answer' });
  });

  it('refuses the same key carrying a different payload', async () => {
    const { interceptor, context, handler, store } = setup({ key: 'key-12345678' });
    store.create.mockRejectedValue(uniqueViolation());
    store.findUnique.mockResolvedValue({
      statusCode: 201,
      responseBody: {},
      endpoint: 'POST /api/v1/expenses',
      requestHash: 'a-different-hash',
    });

    // Replaying the old answer here would silently discard this request.
    await expect(interceptor.intercept(context, handler)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('releases the key when the handler fails, so a corrected retry can reuse it', async () => {
    const { interceptor, context, handler, store } = setup({ key: 'key-12345678' });
    (handler.handle as jest.Mock).mockImplementation(() => {
      throw new Error('validation failed');
    });

    await expect(interceptor.intercept(context, handler)).rejects.toThrow('validation failed');
    expect(store.deleteMany).toHaveBeenCalledWith({
      where: { companyId: 'company-a', key: 'key-12345678', statusCode: 0 },
    });
  });

  it('hashes the body independently of key order', async () => {
    const first = setup({ key: 'key-12345678', body: { a: 1, b: 2 } });
    await first.interceptor.intercept(first.context, first.handler);

    const second = setup({ key: 'key-12345678', body: { b: 2, a: 1 } });
    await second.interceptor.intercept(second.context, second.handler);

    // Clients serialise objects in whatever order they like; the same data must
    // hash the same way or every retry would look like a different request.
    expect(first.store.create.mock.calls[0][0].data.requestHash).toBe(
      second.store.create.mock.calls[0][0].data.requestHash,
    );
  });

  it('serialises BigInt money in the stored response', async () => {
    const { interceptor, context, handler, store } = setup({ key: 'key-12345678' });
    (handler.handle as jest.Mock).mockReturnValue(of({ id: 'e1', amount: 419_780_000n }));

    await interceptor.intercept(context, handler);

    // JSON has no BigInt; storing it unconverted would throw on every write.
    expect(store.update.mock.calls[0][0].data.responseBody).toEqual({
      id: 'e1',
      amount: '419780000',
    });
  });
});

async function hashOf(body: unknown): Promise<string> {
  const { createHash } = await import('node:crypto');
  const stable = (_key: string, value: unknown): unknown =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value;
  return createHash('sha256').update(JSON.stringify(body, stable)).digest('hex');
}

async function firstValue<T>(observable: unknown): Promise<T> {
  const { firstValueFrom } = await import('rxjs');
  return firstValueFrom(observable as Parameters<typeof firstValueFrom>[0]) as Promise<T>;
}
