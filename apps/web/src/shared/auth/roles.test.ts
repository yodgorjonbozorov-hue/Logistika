import { UserRole } from 'shared';
import { describe, expect, it } from 'vitest';
import { homePathFor, isPlatformAdmin } from './roles';

describe('isPlatformAdmin', () => {
  it('is true only for the platform role', () => {
    expect(isPlatformAdmin({ role: UserRole.SUPERADMIN })).toBe(true);
    for (const role of [UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT, UserRole.DRIVER]) {
      expect(isPlatformAdmin({ role })).toBe(false);
    }
  });

  it('treats "not signed in yet" as not platform staff', () => {
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });
});

describe('homePathFor', () => {
  it('sends platform staff to the platform workspace', () => {
    expect(homePathFor({ role: UserRole.SUPERADMIN })).toBe('/admin');
  });

  it('sends everyone else — and an unknown visitor — to the dashboard', () => {
    expect(homePathFor({ role: UserRole.OWNER })).toBe('/overview');
    expect(homePathFor({ role: UserRole.DRIVER })).toBe('/overview');
    expect(homePathFor(null)).toBe('/overview');
  });
});
