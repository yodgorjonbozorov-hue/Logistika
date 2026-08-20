/**
 * One structured line per request.
 *
 * Nest's default logger prints prose, which is fine to read over somebody's
 * shoulder and useless to an aggregator: "how many 5xx did company X see last
 * hour" is a grep-and-hope question against prose and a filter against JSON.
 * So in production every request produces one JSON object with the fields the
 * runbook asks about — requestId, userId, companyId, route, status, duration —
 * and in development it stays human-readable.
 *
 * What is deliberately NOT logged: the request body, the query string, and any
 * header. The body of `POST /auth/login` is a password, the query string of a
 * public tracking link is a capability, and `authorization` is a bearer token.
 * The route TEMPLATE is logged rather than the URL, so `/trips/:id` never
 * carries a real id into the log — path parameters are frequently the tenant's
 * own identifiers.
 */
import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { CurrentUserPayload } from 'shared';
import { runWithRequestContext, type RequestContext } from './request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

/** A client-supplied id is accepted only in this shape — it ends up in logs. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');
  private readonly json = process.env.NODE_ENV === 'production';

  use(request: Request, response: Response, next: NextFunction): void {
    const inbound = request.headers[REQUEST_ID_HEADER];
    const supplied = Array.isArray(inbound) ? inbound[0] : inbound;
    // A trace id from an upstream proxy is worth keeping so one id spans the
    // whole hop chain — but only after it has been checked, because it is
    // attacker-controlled text that is about to be written into a log line.
    const requestId = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();

    const context: RequestContext = { requestId };
    response.setHeader(REQUEST_ID_HEADER, requestId);

    const startedAt = process.hrtime.bigint();

    runWithRequestContext(context, () => {
      response.on('finish', () => {
        const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
        const user = (request as Request & { user?: CurrentUserPayload }).user;

        const entry = {
          level: response.statusCode >= 500 ? 'error' : 'info',
          msg: 'request',
          requestId,
          method: request.method,
          // The matched route template, not the URL — see the file comment.
          route: routeTemplate(request),
          statusCode: response.statusCode,
          durationMs,
          userId: user?.userId ?? context.userId ?? null,
          companyId: user?.companyId ?? context.companyId ?? null,
        };

        if (this.json) {
          // Written straight to stdout: Nest's logger would wrap this in its
          // own prefix and the line would stop being parseable JSON.
          process.stdout.write(`${JSON.stringify({ ...entry, time: new Date().toISOString() })}\n`);
        } else {
          this.logger.log(
            `${entry.method} ${entry.route} ${entry.statusCode} ${entry.durationMs}ms` +
              `${entry.companyId ? ` company=${entry.companyId}` : ''}`,
          );
        }
      });

      next();
    });
  }
}

/**
 * Express only fills `req.route` once the router has matched, which has
 * happened by the time `finish` fires. `baseUrl` carries the controller's
 * prefix, so the two together are the full template.
 */
function routeTemplate(request: Request): string {
  const path = (request as Request & { route?: { path?: string } }).route?.path;
  if (!path) return 'unmatched';
  return `${request.baseUrl ?? ''}${path}` || path;
}
