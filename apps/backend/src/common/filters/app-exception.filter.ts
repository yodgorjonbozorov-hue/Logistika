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
import { REQUEST_ID_HEADER } from '../observability/logging.module';
import { captureException } from '../observability/sentry';

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'AUTH_TOKEN_INVALID',
  [HttpStatus.FORBIDDEN]: 'AUTH_FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMIT_EXCEEDED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

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
      // ValidationPipe puts field errors into `message: string[]`; other
      // structured payloads (health checks name the failing dependency) are
      // carried through as-is instead of collapsing into a bare status code.
      if (typeof body === 'object' && body !== null) {
        const message = (body as { message?: unknown }).message;
        if (Array.isArray(message)) {
          details = message;
        } else if (!('statusCode' in body) || Object.keys(body).length > 2) {
          details = body;
        }
      }
    } else {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // Only genuinely unexpected failures are reported: an AppException is a
      // handled outcome, and reporting those would bury the real ones.
      captureException(exception, {
        method: request.method,
        path: request.url,
        requestId: request.headers[REQUEST_ID_HEADER],
      });
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
