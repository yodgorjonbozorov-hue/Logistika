import { UserRole } from 'shared';

/**
 * UI mirrors of the backend @Roles() guards. They decide which buttons are
 * rendered — the API still rejects anything a role may not do, so this is
 * convenience, never protection.
 */
const RULES = {
  createTrip: [UserRole.OWNER, UserRole.LOGIST],
  editTrip: [UserRole.OWNER, UserRole.LOGIST],
  manageFleet: [UserRole.OWNER, UserRole.LOGIST],
  deactivate: [UserRole.OWNER],
  approveExpense: [UserRole.OWNER, UserRole.ACCOUNTANT],
  manageMoney: [UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT],
  manageUsers: [UserRole.OWNER],
  editCompany: [UserRole.OWNER],
  shareTripLink: [UserRole.OWNER, UserRole.LOGIST],
} as const;

export type Permission = keyof typeof RULES;

export function can(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (RULES[permission] as readonly UserRole[]).includes(role);
}
