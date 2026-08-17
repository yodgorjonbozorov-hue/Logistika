import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

const logger = new Logger('Sentry');

let enabled = false;

/**
 * Error tracking, off unless SENTRY_DSN is configured.
 *
 * Unhandled errors currently only reach the container log, where nobody sees
 * them until a user complains. This reports them — with the personal data
 * stripped: a logistics company's driver phone numbers and receipt contents
 * have no business leaving the server.
 */
export function initSentry(dsn: string | undefined, environment: string, release?: string): void {
  if (!dsn) {
    logger.log('SENTRY_DSN not set — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment,
    release,
    // Off by default: performance sampling on a small VPS is a cost, not a win.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrub,
  });
  enabled = true;
  logger.log(`Error tracking enabled for environment "${environment}"`);
}

export function isSentryEnabled(): boolean {
  return enabled;
}

const SENSITIVE_KEYS = /pass|token|secret|authorization|cookie|code|phone|inn/i;

/** Removes credentials and personal data from anything on its way out. */
export function scrub(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (SENSITIVE_KEYS.test(key)) event.request.headers[key] = '[redacted]';
      }
    }
  }
  if (event.extra) event.extra = redactObject(event.extra);
  if (event.contexts) {
    for (const [name, context] of Object.entries(event.contexts)) {
      if (context) event.contexts[name] = redactObject(context);
    }
  }
  return event;
}

function redactObject<T extends Record<string, unknown>>(input: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = SENSITIVE_KEYS.test(key) ? '[redacted]' : value;
  }
  return output as T;
}

/** Reports an exception the global filter could not attribute to the caller. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
