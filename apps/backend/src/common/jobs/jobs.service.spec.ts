import { ConfigService } from '@nestjs/config';
import { DEFAULT_JOB_OPTIONS, deadLetterName, QUEUES } from './job-queues';
import { JobsService } from './jobs.service';

/**
 * The queue layer is tested through its own seams rather than against a live
 * Redis: what matters here is the policy (three attempts, exponential backoff,
 * dead-letter on exhaustion) and that a broker having a bad day never becomes
 * an error in front of a user.
 */

const configOf = (values: Record<string, string>): ConfigService =>
  ({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`missing ${key}`);
      return value;
    },
  }) as unknown as ConfigService;

const INLINE = { JOBS_INLINE: 'true', REDIS_URL: 'redis://localhost:6379' };

describe('DEFAULT_JOB_OPTIONS', () => {
  it('retries three times with exponential backoff', () => {
    // A gateway returning 502 is usually fine ten seconds later; one that is
    // genuinely down is not fixed by a fourth attempt two seconds on.
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({ type: 'exponential', delay: 5_000 });
  });

  it('keeps failures far longer than successes', () => {
    // A job nobody can see failed is a job nobody fixes; a million green jobs
    // is just a slow Redis.
    expect(DEFAULT_JOB_OPTIONS.removeOnFail.count).toBeGreaterThan(
      DEFAULT_JOB_OPTIONS.removeOnComplete.count,
    );
  });

  it('names the dead-letter queue after its own queue', () => {
    expect(deadLetterName(QUEUES.sms)).toBe('sms.dead');
  });
});

describe('JobsService (inline)', () => {
  it('runs the registered handler with the payload', async () => {
    const jobs = new JobsService(configOf(INLINE));
    const handled: unknown[] = [];
    jobs.register(QUEUES.sms, async (payload) => {
      handled.push(payload);
    });

    await jobs.enqueue(QUEUES.sms, { messageId: 'm1', phone: '+998901234567', text: 'code' });

    expect(handled).toEqual([{ messageId: 'm1', phone: '+998901234567', text: 'code' }]);
  });

  it('does not let a failing job fail the caller', async () => {
    const jobs = new JobsService(configOf(INLINE));
    jobs.register(QUEUES.sms, () => Promise.reject(new Error('gateway down')));

    // The whole point of moving this work off the request: a login must not
    // 500 because an SMS provider is having a bad minute.
    await expect(
      jobs.enqueue(QUEUES.sms, { messageId: 'm1', phone: '+998901234567', text: 'code' }),
    ).resolves.toBeUndefined();
  });

  it('drops a job with no handler rather than throwing', async () => {
    const jobs = new JobsService(configOf(INLINE));
    await expect(
      jobs.enqueue(QUEUES.files, { companyId: 'c1', fileId: 'f1' }),
    ).resolves.toBeUndefined();
  });

  it('reports no queue depth when nothing is queued', async () => {
    const jobs = new JobsService(configOf(INLINE));
    await expect(jobs.pending(QUEUES.files)).resolves.toBe(0);
  });
});

describe('JobsService (queued)', () => {
  const QUEUED = { JOBS_INLINE: 'false', REDIS_URL: 'redis://localhost:6379' };

  /** Replaces the real Queue with a stub, so no broker is involved. */
  function withFakeQueue(jobs: JobsService) {
    const added: Array<{ queue: string; name: string; data: unknown; opts: unknown }> = [];
    const queues = new Map<string, unknown>();
    (jobs as unknown as { queueFor: (n: string) => unknown }).queueFor = (name: string) => {
      if (!queues.has(name)) {
        queues.set(name, {
          add: (jobName: string, data: unknown, opts: unknown) => {
            added.push({ queue: name, name: jobName, data, opts });
            return Promise.resolve();
          },
        });
      }
      return queues.get(name);
    };
    return added;
  }

  it('adds the job with the shared retry policy', async () => {
    const jobs = new JobsService(configOf(QUEUED));
    const added = withFakeQueue(jobs);

    await jobs.enqueue(QUEUES.files, { companyId: 'c1', fileId: 'f1' });

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      queue: 'files',
      data: { companyId: 'c1', fileId: 'f1' },
      opts: DEFAULT_JOB_OPTIONS,
    });
  });

  it('does not run the handler in the caller when queued', async () => {
    const jobs = new JobsService(configOf(QUEUED));
    withFakeQueue(jobs);
    const handler = jest.fn();
    // register() would open a real Worker, so only the handler map is seeded.
    (jobs as unknown as { handlers: Map<string, unknown> }).handlers.set(QUEUES.files, handler);

    await jobs.enqueue(QUEUES.files, { companyId: 'c1', fileId: 'f1' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('swallows a broker that will not take the job', async () => {
    const jobs = new JobsService(configOf(QUEUED));
    (jobs as unknown as { queueFor: (n: string) => unknown }).queueFor = () => ({
      add: () => Promise.reject(new Error('ECONNREFUSED')),
    });

    // Losing the job is bad and it is logged; turning an upload into a 500
    // because Redis blinked is worse.
    await expect(
      jobs.enqueue(QUEUES.files, { companyId: 'c1', fileId: 'f1' }),
    ).resolves.toBeUndefined();
  });

  it('moves an exhausted job to the dead-letter queue', async () => {
    const jobs = new JobsService(configOf(QUEUED));
    const added = withFakeQueue(jobs);

    await (
      jobs as unknown as {
        toDeadLetter: (q: string, job: unknown, error: Error) => Promise<void>;
      }
    ).toDeadLetter(
      QUEUES.sms,
      { id: '7', name: 'sms', data: { messageId: 'm1' } },
      new Error('gateway down'),
    );

    expect(added).toHaveLength(1);
    expect(added[0]!.queue).toBe('sms.dead');
    expect(added[0]!.data).toMatchObject({
      originalJobId: '7',
      failedReason: 'gateway down',
      payload: { messageId: 'm1' },
    });
  });

  it('keeps dead letters instead of trimming them away', async () => {
    const jobs = new JobsService(configOf(QUEUED));
    const added = withFakeQueue(jobs);

    await (
      jobs as unknown as {
        toDeadLetter: (q: string, job: unknown, error: Error) => Promise<void>;
      }
    ).toDeadLetter(QUEUES.files, { id: '1', name: 'files', data: {} }, new Error('boom'));

    // A dead letter that is auto-removed is a dead letter nobody replays.
    expect(added[0]!.opts).toMatchObject({ removeOnComplete: false, removeOnFail: false });
  });
});
