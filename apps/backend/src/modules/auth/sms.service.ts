import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsService } from '../../common/jobs/jobs.service';
import { QUEUES, type SmsJob } from '../../common/jobs/job-queues';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * SMS gateway wrapper.
 *
 * `send()` used to make the HTTP call on the request thread and swallow every
 * failure (TASK-4.3, A-3): a gateway having a slow ten seconds made every
 * login take ten seconds, and a gateway that was down meant the code simply
 * never arrived — with nothing anywhere to say so. Now the call is queued,
 * retried three times with exponential backoff, and its outcome is recorded in
 * `sms_messages`, so "did this driver get their code?" has an answer.
 *
 * Without SMS_PROVIDER_URL configured (dev) the code is only logged.
 */
@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(QUEUES.sms, (job) => this.deliver(job));
  }

  /**
   * Hands the message to the queue and returns.
   *
   * `purpose` rather than the text is what gets stored: for a login the text
   * contains the one-time code, and a table of live codes is a table worth
   * stealing.
   */
  async send(phone: string, text: string, purpose = 'GENERIC'): Promise<void> {
    const message = await this.prisma.smsMessage.create({ data: { phone, purpose } });
    await this.jobs.enqueue(QUEUES.sms, { messageId: message.id, phone, text });
  }

  /**
   * The actual delivery, run by the worker.
   *
   * Throws on failure on purpose: that is how BullMQ knows to retry. The only
   * failure that is not retried is a provider that is not configured, because
   * no number of attempts will configure one.
   */
  private async deliver(job: SmsJob): Promise<void> {
    const providerUrl = this.config.get<string>('SMS_PROVIDER_URL');
    if (!providerUrl) {
      this.logger.log(`[DEV SMS] ${job.phone}: ${job.text}`);
      await this.settle(job.messageId, 'SENT');
      return;
    }

    try {
      const response = await fetch(providerUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.get<string>('SMS_PROVIDER_TOKEN') ?? ''}`,
        },
        body: JSON.stringify({ phone: job.phone, text: job.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`provider returned ${response.status}`);
      await this.settle(job.messageId, 'SENT');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.settle(job.messageId, 'FAILED', reason);
      this.logger.error(`SMS send failed for ${job.phone}: ${reason}`);
      throw error instanceof Error ? error : new Error(reason);
    }
  }

  private async settle(
    messageId: string,
    status: 'SENT' | 'FAILED',
    lastError?: string,
  ): Promise<void> {
    try {
      await this.prisma.smsMessage.update({
        where: { id: messageId },
        data: {
          status,
          lastError: lastError ?? null,
          attempts: { increment: 1 },
          sentAt: status === 'SENT' ? new Date() : null,
        },
      });
    } catch (error) {
      // Bookkeeping must never be the reason a delivery is retried.
      this.logger.warn(
        `Could not record SMS outcome ${messageId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
