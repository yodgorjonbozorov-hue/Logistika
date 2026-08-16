import { haversineKm, type GeoPoint } from '../../common/geo';

/**
 * Live watch detectors (TZ §4.1 W-2, §8.10 thresholds).
 *
 * Both answer a question the map can only hint at: has this truck actually
 * stopped, and is it actually off its route? Plain geometry over the GPS trail,
 * so the answer is the same every time it is asked.
 */
export interface WatchPoint extends GeoPoint {
  recordedAt: Date;
}

export interface IdleFinding {
  vehicleId: string;
  /** Whole hours the vehicle has been standing still. */
  hours: number;
}

/**
 * How far a parked truck may still wander in the GPS trace. Consumer receivers
 * drift by a couple of hundred metres, and a driver moving inside a truck stop
 * is still parked.
 */
export const IDLE_RADIUS_KM = 0.5;

/**
 * How far back the trail is read, as a multiple of the idle window. A vehicle
 * that drove for an hour and then stopped for two must still be found, so the
 * trail has to start before the stop did.
 */
export const IDLE_LOOKBACK_FACTOR = 2;

/**
 * A vehicle that has not left `IDLE_RADIUS_KM` for `idleHours`.
 *
 * The stop is measured backwards from the newest fix: how far back the trail
 * stays inside the radius is how long it has been standing. A vehicle whose
 * newest fix is itself older than the window is skipped — that one has been
 * proven silent, not still, which is a different problem and a different alert.
 */
export function detectIdle(
  trails: Array<{ vehicleId: string; points: WatchPoint[] }>,
  idleHours: number,
  now: Date,
): IdleFinding[] {
  const windowMs = idleHours * 3_600_000;
  const findings: IdleFinding[] = [];

  for (const trail of trails) {
    if (trail.points.length < 2) continue;
    const sorted = [...trail.points].sort(
      (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
    );
    const last = sorted[sorted.length - 1] as WatchPoint;
    if (now.getTime() - last.recordedAt.getTime() > windowMs) continue;

    let index = sorted.length - 1;
    while (index > 0 && haversineKm(last, sorted[index - 1] as WatchPoint) <= IDLE_RADIUS_KM) {
      index -= 1;
    }

    const standingMs =
      last.recordedAt.getTime() - (sorted[index] as WatchPoint).recordedAt.getTime();
    if (standingMs < windowMs) continue;

    findings.push({ vehicleId: trail.vehicleId, hours: Math.floor(standingMs / 3_600_000) });
  }
  return findings;
}

export interface DeviationFinding {
  vehicleId: string;
  deviationKm: number;
}

/**
 * Vehicles further from their loading→unloading corridor than the company
 * allows. The distance itself is computed by the live map query; this only
 * applies the threshold, so the alert and the map can never disagree.
 */
export function detectDeviation(
  rows: Array<{ vehicleId: string; deviationKm: number | null; onTrip: boolean }>,
  maxKm: number,
): DeviationFinding[] {
  return rows
    .filter((row) => row.onTrip && row.deviationKm !== null && row.deviationKm > maxKm)
    .map((row) => ({ vehicleId: row.vehicleId, deviationKm: row.deviationKm as number }));
}
