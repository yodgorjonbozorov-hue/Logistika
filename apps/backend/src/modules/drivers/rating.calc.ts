/**
 * Driver rating (TZ §4.1 W-6 / §3.2 E-7): lateness, fuel deviation, breakdowns.
 *
 * The score is kept in hundredths of a star as an integer, so a rating is never
 * a float and two drivers with the same record always sort the same way. Every
 * penalty is proportional and capped, and the inputs travel with the result —
 * a rating a driver cannot see the reason for is a rating they will dispute.
 */
export const MAX_RATING_CENTIS = 500; // 5.00
export const MIN_RATING_CENTIS = 100; // 1.00

/** Below this a rating would say more about the sample than about the driver. */
export const MIN_TRIPS_FOR_RATING = 3;

/** Most a single dimension can cost, in hundredths of a star. */
export const PENALTY_CAP = {
  lateness: 150,
  fuel: 200,
  breakdowns: 150,
} as const;

/** Fuel deviation at or above this over the norm costs the full penalty. */
export const FUEL_PENALTY_FULL_BP = 1500; // 15%
/** One breakdown every this many trips costs the full penalty. */
export const BREAKDOWN_PENALTY_FULL_RATE_BP = 2000; // 1 in 5

export interface DriverStats {
  driverId: string;
  driverName: string;
  trips: number;
  /** Trips finished after the agreed unloading date. */
  lateTrips: number;
  breakdowns: number;
  /** Fuel burnt over the vehicle norm on this driver's trips, in basis points. */
  fuelDeviationBp: number | null;
}

export interface DriverRating extends DriverStats {
  /** 1.00–5.00 in hundredths; null until there are enough trips to judge. */
  ratingCentis: number | null;
  penalties: { lateness: number; fuel: number; breakdowns: number };
  lateShareBp: number;
  breakdownRateBp: number;
}

/** `value / full` of `cap`, rounded half-up, never past the cap or below zero. */
function penalty(value: number, full: number, cap: number): number {
  if (value <= 0 || full <= 0) return 0;
  return Math.min(cap, Math.round((value * cap) / full));
}

export function rateDriver(stats: DriverStats, fuelThresholdBp: number): DriverRating {
  const lateShareBp = stats.trips === 0 ? 0 : Math.round((stats.lateTrips * 10_000) / stats.trips);
  const breakdownRateBp =
    stats.trips === 0 ? 0 : Math.round((stats.breakdowns * 10_000) / stats.trips);

  // Only deviation past the company's own threshold counts against a driver:
  // the norm already allows for road, load and season.
  const overThresholdBp = Math.max(0, (stats.fuelDeviationBp ?? 0) - fuelThresholdBp);

  const penalties = {
    lateness: penalty(lateShareBp, 10_000, PENALTY_CAP.lateness),
    fuel: penalty(overThresholdBp, FUEL_PENALTY_FULL_BP, PENALTY_CAP.fuel),
    breakdowns: penalty(breakdownRateBp, BREAKDOWN_PENALTY_FULL_RATE_BP, PENALTY_CAP.breakdowns),
  };

  const scored = MAX_RATING_CENTIS - penalties.lateness - penalties.fuel - penalties.breakdowns;

  return {
    ...stats,
    lateShareBp,
    breakdownRateBp,
    penalties,
    ratingCentis: stats.trips < MIN_TRIPS_FOR_RATING ? null : Math.max(MIN_RATING_CENTIS, scored),
  };
}

/** "4.35" — the rating as it is stored and shown, from the integer. */
export function ratingToDecimal(ratingCentis: number | null): string | null {
  if (ratingCentis === null) return null;
  return `${Math.floor(ratingCentis / 100)}.${String(ratingCentis % 100).padStart(2, '0')}`;
}
