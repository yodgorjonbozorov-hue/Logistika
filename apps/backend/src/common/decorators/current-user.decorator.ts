import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CurrentUserPayload } from 'shared';

/**
 * The ONLY source of userId/companyId in controllers (CLAUDE.md rule:
 * they must never be read from body or query).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: CurrentUserPayload }>();
    return request.user;
  },
);
