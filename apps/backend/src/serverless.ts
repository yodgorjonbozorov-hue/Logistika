import './common/serialization';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApp } from './create-app';

/**
 * Vercel Function entry.
 *
 * Vercel keeps a warm instance between invocations, so the Nest application is
 * bootstrapped once and the promise is reused — a cold start pays for it, every
 * later request does not. `app.init()` wires the modules without opening a
 * listening socket; the platform owns the socket.
 */
let cached: Promise<Express> | null = null;

async function bootstrap(): Promise<Express> {
  const app = await createApp();
  await app.init();
  return app.getHttpAdapter().getInstance() as Express;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  cached ??= bootstrap().catch((error: unknown) => {
    // A failed bootstrap must not be cached, or the function stays broken until
    // the instance is recycled.
    cached = null;
    throw error;
  });
  const server = await cached;
  server(request, response);
}
