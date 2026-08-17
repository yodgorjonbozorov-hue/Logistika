import { HttpStatus } from '@nestjs/common';
import { AppException } from './exceptions/app.exception';

/** Foreign keys a tenant record may point at. */
export interface TenantRefs {
  tripId?: string | null;
  vehicleId?: string | null;
  trailerId?: string | null;
  driverId?: string | null;
  clientId?: string | null;
}

/** The subset of a tenant-scoped Prisma client this check needs. */
interface RefLookups {
  trip: { findUnique(args: { where: { id: string } }): Promise<unknown | null> };
  vehicle: { findUnique(args: { where: { id: string } }): Promise<unknown | null> };
  driver: { findUnique(args: { where: { id: string } }): Promise<unknown | null> };
  client: { findUnique(args: { where: { id: string } }): Promise<unknown | null> };
}

/**
 * Every referenced record must exist WITHIN the caller's tenant.
 *
 * Foreign keys are global (`trips(id)`), so the database happily accepts an
 * expense pointing at another company's trip; only a tenant-scoped lookup
 * catches it. The lookup runs through the scoped client, which makes a
 * cross-company id indistinguishable from a missing one — the caller learns
 * nothing about whether it exists elsewhere.
 */
export async function assertTenantRefs(db: RefLookups, refs: TenantRefs): Promise<void> {
  const checks: Array<[string | null | undefined, () => Promise<unknown | null>]> = [
    [refs.tripId, () => db.trip.findUnique({ where: { id: refs.tripId! } })],
    [refs.vehicleId, () => db.vehicle.findUnique({ where: { id: refs.vehicleId! } })],
    [refs.trailerId, () => db.vehicle.findUnique({ where: { id: refs.trailerId! } })],
    [refs.driverId, () => db.driver.findUnique({ where: { id: refs.driverId! } })],
    [refs.clientId, () => db.client.findUnique({ where: { id: refs.clientId! } })],
  ];

  const pending = checks.filter(([id]) => Boolean(id));
  const results = await Promise.all(pending.map(([, lookup]) => lookup()));

  const missingIndex = results.findIndex((found) => !found);
  if (missingIndex >= 0) {
    throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, undefined, {
      id: pending[missingIndex]![0],
    });
  }
}
