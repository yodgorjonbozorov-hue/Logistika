import { UserRole } from 'shared';
import type { IconName } from '../shared/ui/icons';

export interface NavItem {
  to: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Navigation per role (TZ §17). This hides what a role has no business seeing —
 * it is NOT the security boundary: the backend guards stay the source of truth,
 * and `ROUTE_ROLES` mirrors them for the router.
 */
export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  [UserRole.OWNER]: [
    { to: '/dashboard', labelKey: 'nav.dashboard', icon: 'dashboard' },
    { to: '/trips', labelKey: 'nav.trips', icon: 'trips' },
    { to: '/tracking', labelKey: 'nav.tracking', icon: 'map' },
    { to: '/drivers', labelKey: 'nav.drivers', icon: 'drivers' },
    { to: '/vehicles', labelKey: 'nav.vehicles', icon: 'vehicles' },
    { to: '/clients', labelKey: 'nav.clients', icon: 'clients' },
    { to: '/finance', labelKey: 'nav.finance', icon: 'finance' },
    { to: '/reports', labelKey: 'nav.reports', icon: 'reports' },
    { to: '/settings', labelKey: 'nav.settings', icon: 'settings' },
  ],
  [UserRole.LOGIST]: [
    { to: '/dashboard', labelKey: 'nav.dashboard', icon: 'dashboard' },
    { to: '/trips', labelKey: 'nav.trips', icon: 'trips' },
    { to: '/tracking', labelKey: 'nav.tracking', icon: 'map' },
    { to: '/drivers', labelKey: 'nav.drivers', icon: 'drivers' },
    { to: '/vehicles', labelKey: 'nav.vehicles', icon: 'vehicles' },
    { to: '/clients', labelKey: 'nav.clients', icon: 'clients' },
    { to: '/settings', labelKey: 'nav.settings', icon: 'settings' },
  ],
  [UserRole.ACCOUNTANT]: [
    { to: '/dashboard', labelKey: 'nav.dashboard', icon: 'dashboard' },
    { to: '/finance', labelKey: 'nav.finance', icon: 'finance' },
    { to: '/clients', labelKey: 'nav.clients', icon: 'clients' },
    { to: '/reports', labelKey: 'nav.reports', icon: 'reports' },
    { to: '/settings', labelKey: 'nav.settings', icon: 'settings' },
  ],
  [UserRole.SUPERADMIN]: [
    { to: '/admin', labelKey: 'nav.adminDashboard', icon: 'admin' },
    { to: '/admin/companies', labelKey: 'nav.adminCompanies', icon: 'building' },
  ],
  [UserRole.DRIVER]: [
    { to: '/driver', labelKey: 'nav.driverTrip', icon: 'trips' },
    { to: '/driver/profile', labelKey: 'nav.driverProfile', icon: 'user' },
  ],
};

/** Where a role lands after login (TZ §23). */
export function homePathFor(role: UserRole | undefined): string {
  switch (role) {
    case UserRole.SUPERADMIN:
      return '/admin';
    case UserRole.DRIVER:
      return '/driver';
    case UserRole.OWNER:
    case UserRole.LOGIST:
    case UserRole.ACCOUNTANT:
      return '/dashboard';
    default:
      return '/login';
  }
}
