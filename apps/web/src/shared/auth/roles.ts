import { UserRole } from 'shared';
import type { User } from '../api/entities';

/**
 * Platform staff, not a tenant. They belong to no company, so every
 * company-scoped request they make comes back 403 — the app has to send them
 * somewhere else entirely rather than render a dashboard that cannot load.
 */
export function isPlatformAdmin(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === UserRole.SUPERADMIN;
}

/** Where a signed-in user belongs when no particular page was asked for. */
export function homePathFor(user: Pick<User, 'role'> | null | undefined): string {
  return isPlatformAdmin(user) ? '/admin' : '/overview';
}
