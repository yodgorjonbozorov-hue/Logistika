import type { ConfigService } from '@nestjs/config';
import type { JobsService } from '../../common/jobs/jobs.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { SmsService } from './sms.service';

/**
 * Sending an SMS used to be an HTTP call on the request thread whose every
 * failure was swallowed (TASK-4.3): a slow gateway made every login slow, and a
 * dead one meant the code never arrived with nothing anywhere to say so.
 */

const configOf = (values: Record<string, string> = {}): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

function setup(values: Record<string, string> = {}) {
  const rows: Array<Record<string, unknown>> = [];
  const update = jest.fn(
    ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row ?? {}, data);
      return Promise.resolve(row);
    },
  );
  const prisma = {
    smsMessage: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `m${rows.length + 1}`, status: 'QUEUED', ...data };
        rows.push(row);
        return Promise.resolve(row);
      }),
      update,
    },
  } as unknown as PrismaService;

  /** Runs the registered handler immediately, the way inline mode does. */
  let handler: ((payload: never) => Promise<void>) | undefined;
  const enqueue = jest.fn((_name: string, payload: unknown) => handler!(payload as never));
  const jobs = {
    register: (_name: string, fn: (payload: never) => Promise<void>) => {
      handler = fn;
    },
    enqueue,
  } as unknown as JobsService;

  const service = new SmsService(configOf(values), jobs, prisma);
  service.onModuleInit();
  return { service, rows, enqueue, update };
}

describe('SmsService', () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('records the purpose, never the message text', async () => {
    const { service, rows } = setup();

    await service.send('+998901112233', 'TruckControl: kirish kodi 908877', 'DRIVER_LOGIN');

    // A table of live one-time codes is a table worth stealing.
    expect(rows[0]).toMatchObject({ phone: '+998901112233', purpose: 'DRIVER_LOGIN' });
    expect(JSON.stringify(rows[0])).not.toContain('908877');
  });

  it('hands the delivery to the queue rather than doing it inline', async () => {
    const { service, enqueue } = setup();

    await service.send('+998901234567', 'code 1', 'DRIVER_LOGIN');

    expect(enqueue).toHaveBeenCalledWith('sms', {
      messageId: 'm1',
      phone: '+998901234567',
      text: 'code 1',
    });
  });

  it('marks the message sent when no provider is configured', async () => {
    // Dev has no gateway; the code is logged, and the row must not sit at
    // QUEUED for ever pretending something is still in flight.
    const { service, rows } = setup();

    await service.send('+998901234567', 'code', 'DRIVER_LOGIN');

    expect(rows[0]!.status).toBe('SENT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks the message sent when the provider accepts it', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { service, rows } = setup({ SMS_PROVIDER_URL: 'https://sms.test/send' });

    await service.send('+998901234567', 'code', 'DRIVER_LOGIN');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sms.test/send',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(rows[0]).toMatchObject({ status: 'SENT', attempts: { increment: 1 } });
  });

  it('rethrows a rejected delivery so the queue retries it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502 });
    const { service } = setup({ SMS_PROVIDER_URL: 'https://sms.test/send' });

    // Throwing is the contract with BullMQ: swallow it and there is no retry.
    await expect(service.send('+998901234567', 'code', 'DRIVER_LOGIN')).rejects.toThrow(
      'provider returned 502',
    );
  });

  it('records why a delivery failed', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    const { service, rows } = setup({ SMS_PROVIDER_URL: 'https://sms.test/send' });

    await expect(service.send('+998901234567', 'code', 'DRIVER_LOGIN')).rejects.toThrow();

    expect(rows[0]).toMatchObject({ status: 'FAILED', lastError: 'ETIMEDOUT', sentAt: null });
  });

  it('does not let bookkeeping failure cause a spurious retry', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { service, update } = setup({ SMS_PROVIDER_URL: 'https://sms.test/send' });
    update.mockRejectedValueOnce(new Error('db down'));

    // The message went out. Failing the job here would send it a second time.
    await expect(service.send('+998901234567', 'code', 'DRIVER_LOGIN')).resolves.toBeUndefined();
  });
});
