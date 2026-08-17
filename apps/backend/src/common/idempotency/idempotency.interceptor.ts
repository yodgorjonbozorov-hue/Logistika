import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { firstValueFrom, of, type Observable } from 'rxjs';
import type { Request, Response } from 'express';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { IDEMPOTENT_KEY } from './idempotent.decorator';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** statusCode 0 marks a claimed key whose request is still running. */
const IN_PROGRESS = 0;
/** How long a second, concurrent request waits for the first one's answer. */
const WAIT_TIMEOUT_MS = 5000;
const WAIT_INTERVAL_MS = 50;

/**
 * Replay protection for money endpoints (TASK-3.2).
 *
 * Retries are not optional here: the driver app resends whatever it could not
 * confirm, and forms get double-clicked. Without a key the second attempt
 * creates a second 1,000,000 so'm expense, and nothing in the database says
 * the two are the same event.
 *
 * The key is *claimed* before the handler runs, not after. Checking first and
 * writing afterwards leaves a window where two simultaneous submits both find
 * nothing and both do the work — which is precisely the double-click case this
 * exists to stop. The unique constraint on (companyId, key) decides the winner;
 * the loser waits for the answer and replays it.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const required = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return next.handle();

    const request = context.switchToHttp().getRequest<Request & { user?: CurrentUserPayload }>();
    const response = context.switchToHttp().getResponse<Response>();
    const rawKey = request.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const companyId = request.user?.companyId;

    if (!key || key.length < 8 || key.length > 200) {
      throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
        `${IDEMPOTENCY_HEADER} header is required (8-200 characters) for this endpoint`,
      ]);
    }
    // No tenant means no scope to store the key under; the guards reject these
    // requests anyway, so this is only a safety net.
    if (!companyId) return next.handle();

    const endpoint = `${request.method} ${request.route?.path ?? request.path}`;
    const requestHash = this.hashBody(request.body);

    const claimed = await this.claim(companyId, key, endpoint, requestHash);
    if (!claimed) {
      const stored = await this.awaitStored(companyId, key, endpoint, requestHash);
      response.status(stored.statusCode);
      return of(stored.responseBody);
    }

    try {
      const result = await firstValueFrom(next.handle());
      await this.prisma.idempotencyKey.update({
        where: { companyId_key: { companyId, key } },
        data: {
          statusCode: response.statusCode,
          responseBody: JSON.parse(JSON.stringify(result, bigintSafe)) as Prisma.InputJsonValue,
        },
      });
      return of(result);
    } catch (error) {
      // A failed request must not burn the key: the client corrects the payload
      // and retries with the same one.
      await this.prisma.idempotencyKey
        .deleteMany({ where: { companyId, key, statusCode: IN_PROGRESS } })
        .catch((cleanupError: unknown) => {
          this.logger.warn(
            `Could not release idempotency key ${key}: ${
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            }`,
          );
        });
      throw error;
    }
  }

  /** Takes ownership of the key, or reports that somebody else already has it. */
  private async claim(
    companyId: string,
    key: string,
    endpoint: string,
    requestHash: string,
  ): Promise<boolean> {
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          companyId,
          key,
          endpoint,
          requestHash,
          statusCode: IN_PROGRESS,
          responseBody: {},
        },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Waits for the request that owns this key to finish, then hands back its
   * answer. A key held by a different payload is a client bug and fails loudly:
   * replaying the old answer would silently discard this request.
   */
  private async awaitStored(
    companyId: string,
    key: string,
    endpoint: string,
    requestHash: string,
  ): Promise<{ statusCode: number; responseBody: Prisma.JsonValue }> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;

    for (;;) {
      const stored = await this.prisma.idempotencyKey.findUnique({
        where: { companyId_key: { companyId, key } },
      });

      // The owner failed and released the key — treat it as a fresh request.
      if (!stored) {
        throw new AppException('IDEMPOTENCY_KEY_REUSED', HttpStatus.CONFLICT, undefined, {
          reason: 'the original request failed; retry with the same key',
        });
      }
      if (stored.requestHash !== requestHash || stored.endpoint !== endpoint) {
        throw new AppException('IDEMPOTENCY_KEY_REUSED', HttpStatus.CONFLICT);
      }
      if (stored.statusCode !== IN_PROGRESS) return stored;

      if (Date.now() > deadline) {
        this.logger.warn(`Idempotency key ${key} still in progress after ${WAIT_TIMEOUT_MS}ms`);
        throw new AppException('IDEMPOTENCY_KEY_REUSED', HttpStatus.CONFLICT, undefined, {
          reason: 'a request with this key is still running',
        });
      }
      await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
    }
  }

  private hashBody(body: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(body ?? {}, stableStringify))
      .digest('hex');
  }
}

/** Key order must not change the hash: clients serialise objects differently. */
function stableStringify(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return value;
}

/** Money is BigInt in this system and JSON has no BigInt. */
function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
