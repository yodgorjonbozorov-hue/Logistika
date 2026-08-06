import { HttpStatus } from '@nestjs/common';
import type { ErrorCode } from 'shared';

/**
 * The only exception type application code should throw for expected failures.
 * `code` is a machine-readable key; the client turns it into text via i18n.
 * The global filter converts it to `{ success:false, error:{ code, message, details } }`.
 */
export class AppException extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: HttpStatus,
    readonly params?: Record<string, string | number>,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'AppException';
  }
}
