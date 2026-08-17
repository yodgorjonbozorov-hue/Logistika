import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CurrentUserPayload, UserRole } from 'shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppException } from '../exceptions/app.exception';

/**
 * Default deny (docs/SECURITY.md F-9).
 *
 * An endpoint that declares no roles is refused rather than allowed: forgetting
 * `@Roles` on a new controller used to open it to every signed-in user,
 * drivers included. `@Public` routes never reach this guard's check.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const { user } = context.switchToHttp().getRequest<{ user?: CurrentUserPayload }>();

    if (!required || required.length === 0 || !user || !required.includes(user.role)) {
      throw new AppException('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
