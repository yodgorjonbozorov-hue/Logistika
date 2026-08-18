import { HttpStatus } from '@nestjs/common';
import { Prisma, type Trip } from '@prisma/client';
import { AppException } from './exceptions/app.exception';

/**
 * A vehicle, trailer or driver can only be on one trip at a time (TASK-3.10).
 *
 * Nothing stopped a second trip from starting on a truck that was already
 * halfway to Bukhara. Both trips then collected the same GPS track, the same
 * fuel and the same kilometres, and the per-trip profit of both was wrong in a
 * way no report could show.
 *
 * Being *assigned* to several trips stays legal: the logist schedules
 * tomorrow's run for the truck that is driving today, and that is ordinary
 * planning. Being *on* two trips is physically impossible, so the line is
 * drawn at IN_PROGRESS.
 *
 * The database enforces it with partial unique indexes, because two starts
 * arriving together both pass any check written in code. The check here exists
 * to name the trip that is in the way — "already in progress" is useful,
 * "unique constraint violated" is not.
 */

/** The subset of a tenant-scoped client this needs. */
interface TripLookup {
  trip: {
    findFirst(args: {
      where: Prisma.TripWhereInput;
      select: { id: true; tripNumber: true };
    }): Promise<{ id: string; tripNumber: string } | null>;
  };
}

const RESOURCES = [
  { field: 'driverId', code: 'DRIVER_BUSY' },
  { field: 'vehicleId', code: 'VEHICLE_BUSY' },
  { field: 'trailerId', code: 'VEHICLE_BUSY' },
] as const;

export interface BusyConflict {
  code: 'DRIVER_BUSY' | 'VEHICLE_BUSY';
  tripNumber: string;
  tripId: string;
  conflictOn: string;
}

/** The trip already under way that blocks this one, or null when nothing does. */
export async function inProgressElsewhere(
  db: TripLookup,
  trip: Trip,
): Promise<BusyConflict | null> {
  for (const { field, code } of RESOURCES) {
    const id = trip[field];
    if (!id) continue;

    const busy = await db.trip.findFirst({
      where: { [field]: id, status: 'IN_PROGRESS', id: { not: trip.id } },
      select: { id: true, tripNumber: true },
    });
    if (busy) {
      return { code, tripNumber: busy.tripNumber, tripId: busy.id, conflictOn: field };
    }
  }
  return null;
}

/**
 * Throws DRIVER_BUSY / VEHICLE_BUSY when something this trip uses is already
 * out on another one.
 */
export async function assertNothingElseInProgress(db: TripLookup, trip: Trip): Promise<void> {
  const busy = await inProgressElsewhere(db, trip);
  if (!busy) return;
  throw new AppException(
    busy.code,
    HttpStatus.CONFLICT,
    { tripNumber: busy.tripNumber },
    { tripId: busy.tripId, conflictOn: busy.conflictOn },
  );
}

/**
 * Turns the partial unique index into the same answer the check above gives.
 *
 * The index is what actually holds under concurrency, so its error has to
 * arrive as a sentence the logist can act on rather than as a 500.
 */
export function busyIndexError(error: unknown): AppException | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return null;
  }
  // Prisma names the *columns*, not the index — these partial indexes are not
  // in the schema for it to know about. Matching the exact column set keeps a
  // future unique index on the same table from being read as "busy".
  const target = (error.meta as { target?: string[] | string } | undefined)?.target;
  const columns = new Set(Array.isArray(target) ? target : [target ?? '']);
  if (columns.size !== 2 || !columns.has('company_id')) return null;

  const code = BUSY_BY_COLUMN[[...columns].find((column) => column !== 'company_id') ?? ''];
  if (!code) return null;

  // The winning trip's number is not in the error; the message degrades to the
  // resource rather than naming the wrong trip.
  return new AppException(code, HttpStatus.CONFLICT, { tripNumber: '' });
}

const BUSY_BY_COLUMN: Record<string, 'DRIVER_BUSY' | 'VEHICLE_BUSY' | undefined> = {
  driver_id: 'DRIVER_BUSY',
  vehicle_id: 'VEHICLE_BUSY',
  trailer_id: 'VEHICLE_BUSY',
};
