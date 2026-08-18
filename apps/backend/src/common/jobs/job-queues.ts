/**
 * The work that must not happen inside a request (TASK-4.3).
 *
 * `bullmq` and `ioredis` were dependencies from the beginning and no code ever
 * opened a queue (L-7), so SMS delivery, image compression and archival all ran
 * on the request thread: a driver's photo upload waited for sharp, and a login
 * waited for an SMS gateway that may be having a bad day.
 */
export const QUEUES = {
  /** One-time codes and notifications. Costs money; must survive a bad gateway. */
  sms: 'sms',
  /** Image downscaling — seconds of CPU that a driver should not wait for. */
  files: 'files',
  /** Nightly GPS archival and retention (TASK-4.4). */
  gpsArchive: 'gps-archive',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Jobs whose payload is a promise to do something specific. */
export interface SmsJob {
  /** The row in `sms_messages` that records how this delivery went. */
  messageId: string;
  phone: string;
  text: string;
}

export interface CompressImageJob {
  companyId: string;
  fileId: string;
}

export interface GpsArchiveJob {
  /** Nothing to carry: the job reads its own cut-off from configuration. */
  reason: 'cron' | 'manual';
}

export interface JobPayloads {
  sms: SmsJob;
  files: CompressImageJob;
  'gps-archive': GpsArchiveJob;
}

/**
 * Retry policy shared by every queue.
 *
 * Three attempts with exponential backoff: an SMS gateway that returns 502 is
 * usually fine ten seconds later, and one that is genuinely down will not be
 * fixed by a fourth attempt two seconds after the third. Failures are kept
 * (`removeOnFail`) because a job nobody can see failed is a job nobody fixes;
 * successes are trimmed because a queue of a million green jobs is just a
 * slow Redis.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 1_000 },
} as const;

/** Where a job goes once it has used up every attempt. */
export const deadLetterName = (queue: QueueName): string => `${queue}.dead`;
