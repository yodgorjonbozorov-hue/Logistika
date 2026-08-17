import { HttpStatus } from '@nestjs/common';
import type { CurrentUserPayload, TenantActor } from 'shared';
import { AppException } from './exceptions/app.exception';

/**
 * Narrows a caller to one that acts inside a tenant.
 *
 * Tenant-scoped services need `companyId` as a plain string; casting it
 * (`actor.companyId as string`) hides the one case where it really is null —
 * SUPERADMIN — and turns a missing tenant into a silent `null` written to the
 * database. This turns it into an explicit 403 instead.
 */
export function requireTenantActor(actor: CurrentUserPayload): TenantActor {
  if (!actor.companyId) {
    throw new AppException('TENANT_MISSING', HttpStatus.FORBIDDEN);
  }
  return actor as TenantActor;
}
