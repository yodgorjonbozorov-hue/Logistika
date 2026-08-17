import { HttpStatus } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { AppException } from './exceptions/app.exception';

/** The tenant-scoped client `PrismaService.forCompany` hands out. */
export type TenantClient = ReturnType<PrismaService['forCompany']>;

/** Foreign keys a write may carry in from the request body. */
export interface TenantRefs {
  tripId?: string;
  vehicleId?: string;
  trailerId?: string;
  driverId?: string;
  clientId?: string;
}

/**
 * An id in a request body is a claim, not a fact — nothing stops a caller from
 * sending a UUID that belongs to another company.
 *
 * The tenant extension cannot catch this on a `create`: it stamps company_id on
 * the new row, so the row lands in the right tenant while its foreign key points
 * across the boundary. The other company then picks the row up through its own
 * relations (a stranger's expense would join their trip's P&L), which is exactly
 * the leak CLAUDE.md's «har bir so'rov company_id bo'yicha» rule exists to stop.
 *
 * Looking each id up through the tenant client first makes a foreign id look
 * simply missing — the same 404 an id that never existed gets, so the answer
 * also tells the caller nothing about other tenants (docs/SECURITY.md F-3).
 */
export async function assertRefsInCompany(db: TenantClient, refs: TenantRefs): Promise<void> {
  const lookups: Array<[string | undefined, () => Promise<unknown | null>]> = [
    [refs.tripId, () => db.trip.findUnique({ where: { id: refs.tripId as string } })],
    [refs.vehicleId, () => db.vehicle.findUnique({ where: { id: refs.vehicleId as string } })],
    [refs.trailerId, () => db.vehicle.findUnique({ where: { id: refs.trailerId as string } })],
    [refs.driverId, () => db.driver.findUnique({ where: { id: refs.driverId as string } })],
    [refs.clientId, () => db.client.findUnique({ where: { id: refs.clientId as string } })],
  ];
  for (const [id, lookup] of lookups) {
    if (id && !(await lookup())) {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, undefined, { id });
    }
  }
}
