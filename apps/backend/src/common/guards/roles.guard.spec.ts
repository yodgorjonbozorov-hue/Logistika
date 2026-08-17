import { Reflector } from '@nestjs/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { UserRole } from 'shared';
import { AppException } from '../exceptions/app.exception';
import { RolesGuard } from './roles.guard';

/** A context whose reflector answers with the metadata a route would carry. */
function contextWith(metadata: { roles?: UserRole[]; isPublic?: boolean; role?: UserRole }) {
  const reflector = {
    getAllAndOverride: (key: string) => (key === 'roles' ? metadata.roles : metadata.isPublic),
  } as unknown as Reflector;

  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => (metadata.role ? { user: { role: metadata.role } } : {}),
    }),
  } as never;

  return { guard: new RolesGuard(reflector), context };
}

describe('RolesGuard', () => {
  it('lets an allowed role through', () => {
    const { guard, context } = contextWith({
      roles: [UserRole.OWNER, UserRole.LOGIST],
      role: UserRole.LOGIST,
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('refuses a role the route did not list', () => {
    const { guard, context } = contextWith({ roles: [UserRole.OWNER], role: UserRole.DRIVER });
    expect(() => guard.canActivate(context)).toThrow(AppException);
  });

  it('refuses a route that declares no roles at all', () => {
    // The point of F-9: a forgotten decorator must fail closed, not open the
    // endpoint to every signed-in user.
    const { guard, context } = contextWith({ role: UserRole.DRIVER });
    expect(() => guard.canActivate(context)).toThrow(AppException);

    const empty = contextWith({ roles: [], role: UserRole.OWNER });
    expect(() => empty.guard.canActivate(empty.context)).toThrow(AppException);
  });

  it('lets a public route past without a user', () => {
    const { guard, context } = contextWith({ isPublic: true });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('refuses an authenticated route when there is no user on the request', () => {
    const { guard, context } = contextWith({ roles: [UserRole.OWNER] });
    expect(() => guard.canActivate(context)).toThrow(AppException);
  });
});

/**
 * The guard fails closed, so a controller without `@Roles` is not a security
 * hole any more — it is a broken screen. This catches that at build time
 * instead of on the first request.
 */
describe('every controller declares its roles', () => {
  const SRC = join(__dirname, '..', '..');

  function controllers(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) found.push(...controllers(path));
      else if (entry.name.endsWith('.controller.ts')) found.push(path);
    }
    return found;
  }

  it('has @Roles on every route that is not @Public', () => {
    const offenders = controllers(SRC).filter((path) => {
      const source = readFileSync(path, 'utf8');
      if (/@Roles\(/.test(source)) return false;
      // A controller may skip roles only when every one of its routes is public.
      const routes = source.match(/@(Get|Post|Patch|Put|Delete)\(/g) ?? [];
      const publicRoutes = source.match(/@Public\(\)/g) ?? [];
      return routes.length !== publicRoutes.length;
    });
    expect(offenders).toEqual([]);
  });
});
