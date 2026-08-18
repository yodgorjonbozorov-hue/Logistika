import { UserRole } from 'shared';

/**
 * Who may open which page (TASK-5.1, M-13).
 *
 * `ProtectedRoute` only asked whether *someone* was logged in, so a DRIVER who
 * opened the web app saw every screen in the menu and got a wall of 403s from
 * the API — the guard was real, the interface simply lied about what was
 * available.
 *
 * One table, used by both the router and the sidebar, because a menu that
 * offers a page the router refuses is the same bug in a nicer shape. The roles
 * here mirror the controllers' `@Roles` exactly; the comment on each line names
 * the endpoint the page cannot work without.
 */
export const ALL_ROLES = [
  UserRole.SUPERADMIN,
  UserRole.OWNER,
  UserRole.LOGIST,
  UserRole.ACCOUNTANT,
  UserRole.DRIVER,
] as const;

/** Everyone with a desk. Drivers work in the mobile app, not here. */
const OFFICE = [UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT] as const;

export interface AppRoute {
  path: string;
  /** Undefined means "any signed-in user". */
  roles?: readonly UserRole[];
  /** i18n key for the sidebar; absent means the page is not in the menu. */
  navKey?: string;
}

export const ROUTES: readonly AppRoute[] = [
  // GET /tracking/live — OWNER, LOGIST, ACCOUNTANT
  { path: '/map', roles: OFFICE, navKey: 'nav.map' },
  // GET /trips — OWNER, LOGIST, ACCOUNTANT (drivers use GET /trips/my)
  { path: '/trips', roles: OFFICE, navKey: 'nav.trips' },
  { path: '/trips/:id', roles: OFFICE },
  // GET /vehicles — OWNER, LOGIST, ACCOUNTANT
  { path: '/vehicles', roles: OFFICE, navKey: 'nav.vehicles' },
  // GET /drivers — OWNER, LOGIST, ACCOUNTANT
  { path: '/drivers', roles: OFFICE, navKey: 'nav.drivers' },
  // GET /clients — OWNER, LOGIST, ACCOUNTANT
  { path: '/clients', roles: OFFICE, navKey: 'nav.clients' },
  // GET /expenses, /incomes — OWNER, LOGIST, ACCOUNTANT
  { path: '/finance', roles: OFFICE, navKey: 'nav.finance' },
  // GET /audit-logs — OWNER, SUPERADMIN
  { path: '/audit-logs', roles: [UserRole.OWNER, UserRole.SUPERADMIN], navKey: 'nav.audit' },
  // POST /auth/change-password — anyone with an account, including a driver
  // who happens to be signed in here.
  { path: '/change-password' },
];

export const canOpen = (route: AppRoute, role: UserRole | undefined): boolean =>
  route.roles === undefined || (role !== undefined && route.roles.includes(role));

/**
 * Where to send someone who lands on `/`.
 *
 * Not a constant `/trips`: for a DRIVER that is a 403 page as a landing screen.
 * The first page they are actually allowed to see is a better answer, and
 * "none of them" is a real possibility worth handling rather than looping.
 */
export function homePathFor(role: UserRole | undefined): string {
  const first = ROUTES.find((route) => route.navKey && canOpen(route, role));
  return first?.path ?? '/change-password';
}
