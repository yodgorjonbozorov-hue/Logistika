import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Marks an endpoint as requiring an `Idempotency-Key` header.
 *
 * Applied to anything that moves money or creates a document with a number:
 * these are exactly the requests a client will retry after a timeout, and the
 * ones where doing the work twice costs somebody real so'm.
 */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_KEY, true);
