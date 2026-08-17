import { SetMetadata } from '@nestjs/common';
import { UserRole } from 'shared';

export const ROLES_KEY = 'roles';

/**
 * Roles allowed on a controller or route. Required on every authenticated
 * endpoint — `RolesGuard` denies anything that does not declare them, so a
 * forgotten decorator fails closed rather than opening a screen to drivers.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Every signed-in role. For endpoints a driver legitimately shares. */
export const ANY_ROLE: UserRole[] = [
  UserRole.SUPERADMIN,
  UserRole.OWNER,
  UserRole.LOGIST,
  UserRole.ACCOUNTANT,
  UserRole.DRIVER,
];
