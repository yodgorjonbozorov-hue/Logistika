import { describe, expect, it } from 'vitest';
import { UserRole } from 'shared';
import { ALL_ROLES, canOpen, homePathFor, ROUTES } from './routes';

/**
 * The route table is the only place that says who may open what (M-13,
 * TASK-5.1), and it has to keep saying the same thing as the controllers'
 * `@Roles`. These tests pin the pairs that matter; the comment on each names
 * the endpoint the page cannot work without.
 */

const routeFor = (path: string) => {
  const route = ROUTES.find((entry) => entry.path === path);
  if (!route) throw new Error(`no route for ${path}`);
  return route;
};

describe('route roles mirror the API', () => {
  it.each([
    ['/map', 'GET /tracking/live'],
    ['/trips', 'GET /trips'],
    ['/vehicles', 'GET /vehicles'],
    ['/drivers', 'GET /drivers'],
    ['/clients', 'GET /clients'],
    ['/finance', 'GET /expenses'],
  ])('%s is the office trio, like %s', (path) => {
    expect(routeFor(path).roles).toEqual([UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT]);
  });

  it('the audit log is owner and platform staff only, like GET /audit-logs', () => {
    expect(routeFor('/audit-logs').roles).toEqual([UserRole.OWNER, UserRole.SUPERADMIN]);
  });

  it('changing your own password needs no role at all', () => {
    // A driver signed in here must still be able to change their password.
    expect(routeFor('/change-password').roles).toBeUndefined();
    for (const role of ALL_ROLES) {
      expect(canOpen(routeFor('/change-password'), role)).toBe(true);
    }
  });
});

describe('canOpen', () => {
  it('lets an allowed role through', () => {
    expect(canOpen(routeFor('/trips'), UserRole.LOGIST)).toBe(true);
  });

  it('keeps a driver out of the office pages', () => {
    // The whole of M-13: a DRIVER used to see every screen and collect a 403
    // from the API on each one.
    for (const path of ['/map', '/trips', '/vehicles', '/drivers', '/clients', '/finance']) {
      expect(canOpen(routeFor(path), UserRole.DRIVER)).toBe(false);
    }
  });

  it('keeps a logist and an accountant out of the audit log', () => {
    expect(canOpen(routeFor('/audit-logs'), UserRole.LOGIST)).toBe(false);
    expect(canOpen(routeFor('/audit-logs'), UserRole.ACCOUNTANT)).toBe(false);
  });

  it('refuses a guarded page when the role is not known yet', () => {
    // Better a 403 than a flash of a page the answer may forbid.
    expect(canOpen(routeFor('/trips'), undefined)).toBe(false);
  });
});

describe('the sidebar and the router agree', () => {
  it.each(ALL_ROLES)('offers %s nothing it cannot open', (role) => {
    const menu = ROUTES.filter((route) => route.navKey && canOpen(route, role));
    for (const item of menu) {
      expect(canOpen(item, role)).toBe(true);
    }
  });

  it('shows a driver no menu items at all', () => {
    // Drivers work in the mobile app; an empty sidebar is the honest answer.
    expect(ROUTES.filter((r) => r.navKey && canOpen(r, UserRole.DRIVER))).toHaveLength(0);
  });

  it('shows an owner every menu item', () => {
    const menu = ROUTES.filter((route) => route.navKey);
    expect(menu.filter((r) => canOpen(r, UserRole.OWNER))).toHaveLength(menu.length);
  });

  it('gives every menu entry a translation key', () => {
    for (const route of ROUTES.filter((r) => r.navKey)) {
      expect(route.navKey).toMatch(/^nav\./);
    }
  });
});

describe('homePathFor', () => {
  it('sends office roles to their first allowed page', () => {
    expect(homePathFor(UserRole.OWNER)).toBe('/map');
    expect(homePathFor(UserRole.ACCOUNTANT)).toBe('/map');
  });

  it('never sends a driver to a page that will refuse them', () => {
    // `/` used to be a fixed redirect to /trips, which for a driver makes the
    // landing screen of the whole app a 403.
    const target = homePathFor(UserRole.DRIVER);
    const route = ROUTES.find((entry) => entry.path === target);
    expect(route && canOpen(route, UserRole.DRIVER)).toBe(true);
  });

  it('has an answer even before the user is known', () => {
    expect(homePathFor(undefined)).toBe('/change-password');
  });
});
