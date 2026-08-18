import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  DEFAULT_JOB_OPTIONS,
  deadLetterName,
  type JobPayloads,
  type QueueName,
} from './job-queues';

/** What a queue's worker does with one job. */
export type JobHandler<N extends QueueName> = (payload: JobPayloads[N]) => Promise<void>;

/**
 * The one place that talks to BullMQ.
 *
 * Callers say `enqueue('sms', payload)` and never see a Queue, a Worker or a
 * connection — which is what makes the inline mode below possible, and what
 * keeps the retry and dead-letter policy in a single file instead of
 * copy-pasted next to every producer.
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private readonly handlers = new Map<QueueName, JobHandler<QueueName>>();

  /**
   * Run handlers in the caller's process instead of through Redis.
   *
   * Not a convenience: unit and e2e tests must not depend on a broker being up
   * to answer "did the upload finish", and a developer running the API without
   * `docker compose up` should get a working app rather than photos stuck in
   * PROCESSING for ever. The handler code is identical either way, so the only
   * thing the mode changes is *when* it runs.
   */
  private readonly inline: boolean;

  constructor(private readonly config: ConfigService) {
    this.inline = config.get<string>('JOBS_INLINE') === 'true';
    if (this.inline) this.logger.warn('Background jobs run inline — no Redis queue');
  }

  /** Attaches the worker for a queue. Called once per queue at module init. */
  register<N extends QueueName>(name: N, handler: JobHandler<N>): void {
    this.handlers.set(name, handler as JobHandler<QueueName>);
    if (this.inline) return;

    const worker = new Worker(name, (job: Job) => handler(job.data as JobPayloads[N]), {
      connection: this.connection(),
      concurrency: 5,
    });
    // A job that has burned every attempt is not "logged and forgotten": it is
    // moved somewhere a person can find it, count it and replay it.
    worker.on('failed', (job, error) => {
      const attemptsLeft = (job?.opts.attempts ?? 1) - (job?.attemptsMade ?? 0);
      this.logger.error(
        `Job ${name}#${job?.id} failed (${attemptsLeft} attempt(s) left): ${error.message}`,
      );
      if (job && attemptsLeft <= 0) void this.toDeadLetter(name, job, error);
    });
    worker.on('error', (error) => this.logger.error(`Worker ${name} error: ${error.message}`));
    this.workers.push(worker);
  }

  async enqueue<N extends QueueName>(name: N, payload: JobPayloads[N]): Promise<void> {
    if (this.inline) {
      const handler = this.handlers.get(name);
      if (!handler) {
        this.logger.warn(`No handler registered for queue ${name}; job dropped`);
        return;
      }
      // Inline still means "the request does not fail because the job did":
      // that is the whole promise of moving this work off the request.
      try {
        await handler(payload);
      } catch (error) {
        this.logger.error(`Inline job ${name} failed: ${this.messageOf(error)}`);
      }
      return;
    }

    try {
      await this.queueFor(name).add(name, payload, DEFAULT_JOB_OPTIONS);
    } catch (error) {
      // A broker that is down must not turn into a 500 on an upload. The work
      // is lost and said so loudly, which is the honest trade here.
      this.logger.error(`Could not enqueue ${name}: ${this.messageOf(error)}`);
    }
  }

  /** Queue depth, for the health endpoint and for tests. */
  async pending(name: QueueName): Promise<number> {
    if (this.inline) return 0;
    return this.queueFor(name).getWaitingCount();
  }

  async onModuleDestroy(): Promise<void> {
    // Workers first: closing a connection out from under a running job is how
    // a clean shutdown turns into a stuck job that nobody retries.
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }

  private async toDeadLetter(name: QueueName, job: Job, error: Error): Promise<void> {
    try {
      await this.queueFor(deadLetterName(name)).add(
        job.name,
        { payload: job.data, failedReason: error.message, originalJobId: job.id },
        { removeOnComplete: false, removeOnFail: false },
      );
    } catch (deadLetterError) {
      this.logger.error(`Dead-letter write failed for ${name}: ${this.messageOf(deadLetterError)}`);
    }
  }

  private queueFor(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;
    const queue = new Queue(name, {
      connection: this.connection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.queues.set(name, queue);
    return queue;
  }

  private connection(): ConnectionOptions {
    return {
      url: this.config.getOrThrow<string>('REDIS_URL'),
      // BullMQ requires this: with retries capped, a blocking command fails
      // instead of hanging the worker for ever on a dead broker.
      maxRetriesPerRequest: null,
    } as ConnectionOptions;
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
