import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiResponse, ErrorCode } from 'shared';
import { AppException } from '../exceptions/app.exception';
import { I18nService } from '../../i18n/i18n.service';

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'AUTH_TOKEN_INVALID',
  [HttpStatus.FORBIDDEN]: 'AUTH_FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'FILE_TYPE_NOT_ALLOWED',
};

/**
 * Express middleware throws plain Errors carrying an HTTP status, not
 * HttpExceptions — body-parser's PayloadTooLargeError is the one that matters
 * in practice. Without this, posting a body over the limit answered 500
 * INTERNAL_ERROR, so a mobile client could not tell "you sent too much" from
 * "the server is broken" and kept retrying a request that can never succeed.
 */
function statusFromMiddlewareError(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const candidate = exception as { status?: unknown; statusCode?: unknown; type?: unknown };
  const status = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
  if (typeof status !== 'number' || status < 400 || status > 599) return null;
  return status;
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const locale = this.i18n.resolveLocale(request.headers['accept-language']);

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let details: unknown;
    let params: Record<string, string | number> | undefined;

    if (exception instanceof AppException) {
      status = exception.httpStatus;
      code = exception.code;
      details = exception.details;
      params = exception.params;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? 'INTERNAL_ERROR';
      const body = exception.getResponse();
      // ValidationPipe puts field errors into `message: string[]`.
      if (typeof body === 'object' && body !== null && 'message' in body) {
        const message = (body as { message: unknown }).message;
        if (Array.isArray(message)) details = message;
      }
    } else {
      const middlewareStatus = statusFromMiddlewareError(exception);
      if (middlewareStatus !== null) {
        status = middlewareStatus;
        code = STATUS_CODES[status] ?? 'INTERNAL_ERROR';
        // Expected client-side failures; logged at warn so they do not read as
        // application faults in the error budget.
        this.logger.warn(
          `${request.method} ${request.url} rejected with ${status}: ` +
            (exception instanceof Error ? exception.message : String(exception)),
        );
      } else {
        this.logger.error(
          `Unhandled exception on ${request.method} ${request.url}`,
          exception instanceof Error ? exception.stack : String(exception),
        );
      }
    }

    const body: ApiResponse<null> = {
      success: false,
      data: null,
      error: { code, message: this.i18n.translate(code, locale, params), details },
      meta: null,
    };
    response.status(status).json(body);
  }
}
