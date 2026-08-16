import { divRound, ratioBp } from '../../common/money';

/**
 * AI-4 detectors (TZ §8.5).
 *
 * Every anomaly here is found by plain arithmetic on figures the system already
 * has — TZ §8.12 rule 7 is explicit that AI does not compute. What AI adds
 * afterwards is the sentence a boss can act on; the `facts` of a finding are the
 * only numbers that sentence may contain.
 */
export type AnomalyType =
  'FUEL_OVERRUN' | 'EXPENSIVE_REPAIR' | 'FREQUENT_BREAKDOWN' | 'TRIP_TOO_LONG';

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AnomalyFinding {
  type: AnomalyType;
  severity: AnomalySeverity;
  relatedType: 'Vehicle' | 'Driver' | 'Trip' | 'Expense';
  relatedId: string;
  /** Money at stake in tiyin, when it can be stated honestly. */
  estimatedLoss: bigint | null;
  /** The deterministic figures behind the finding; nothing else is claimed. */
  facts: Record<string, string | number>;
}

/** A repair must cost 40% over the average to count as expensive (TZ §8.5). */
export const REPAIR_OVER_AVERAGE_BP = 4000;
/** Averages below this many samples say nothing, so nothing is reported. */
export const MIN_SAMPLES = 5;
/** A driver breaking down twice as often as the fleet is the signal. */
export const BREAKDOWN_RATE_FACTOR_BP = 20_000;
export const MIN_BREAKDOWNS = 3;
/** A trip half again longer than the usual run on that route. */
export const TRIP_DURATION_FACTOR_BP = 15_000;
export const MIN_ROUTE_TRIPS = 3;

/** Severity grows with how far past its own threshold a deviation is. */
function severityForOverrun(deviationBp: number, thresholdBp: number): AnomalySeverity {
  if (thresholdBp <= 0) return 'MEDIUM';
  if (deviationBp >= thresholdBp * 3) return 'CRITICAL';
  if (deviationBp >= thresholdBp * 2) return 'HIGH';
  return 'MEDIUM';
}

export interface FuelOverrunInput {
  vehicleId: string;
  plateNumber: string;
  deviationLitres: string;
  deviationBp: number | null;
  lossTiyin: bigint | null;
  refuelCount: number;
  exceedsThreshold: boolean;
}

/** Fuel burnt above the vehicle's own norm — the W-8 control table, as findings. */
export function detectFuelOverrun(rows: FuelOverrunInput[], thresholdBp: number): AnomalyFinding[] {
  return rows
    .filter((row) => row.exceedsThreshold && row.deviationBp !== null)
    .map((row) => ({
      type: 'FUEL_OVERRUN' as const,
      severity: severityForOverrun(row.deviationBp as number, thresholdBp),
      relatedType: 'Vehicle' as const,
      relatedId: row.vehicleId,
      estimatedLoss: row.lossTiyin,
      facts: {
        plate: row.plateNumber,
        deviationLitres: row.deviationLitres,
        deviationBp: row.deviationBp as number,
        thresholdBp,
        refuelCount: row.refuelCount,
      },
    }));
}

export interface RepairInput {
  id: string;
  vehicleId: string;
  plateNumber: string;
  amount: bigint;
  description: string | null;
  date: Date;
}

/**
 * A repair well above what this company usually pays.
 *
 * The comparison is against the average of all other repairs — not "the same
 * work", which TZ describes but no field in the data identifies. The sample
 * size travels with the finding so the explanation can say how thin it is.
 */
export function detectExpensiveRepair(repairs: RepairInput[]): AnomalyFinding[] {
  if (repairs.length < MIN_SAMPLES) return [];

  const total = repairs.reduce((sum, repair) => sum + repair.amount, 0n);
  return repairs.flatMap((repair) => {
    const others = repairs.length - 1;
    if (others < MIN_SAMPLES - 1) return [];
    const average = divRound(total - repair.amount, BigInt(others));
    if (average <= 0n) return [];
    const overBp = ratioBp(repair.amount - average, average);
    if (overBp === null || overBp < REPAIR_OVER_AVERAGE_BP) return [];

    return [
      {
        type: 'EXPENSIVE_REPAIR' as const,
        severity: overBp >= REPAIR_OVER_AVERAGE_BP * 2 ? ('HIGH' as const) : ('MEDIUM' as const),
        relatedType: 'Expense' as const,
        relatedId: repair.id,
        estimatedLoss: repair.amount - average,
        facts: {
          plate: repair.plateNumber,
          amount: repair.amount.toString(),
          average: average.toString(),
          overBp,
          sampleSize: others,
          description: repair.description ?? '',
          date: repair.date.toISOString(),
        },
      },
    ];
  });
}

export interface DriverBreakdownInput {
  driverId: string;
  driverName: string;
  breakdowns: number;
  trips: number;
}

/** One driver reporting breakdowns far more often than the rest of the fleet. */
export function detectFrequentBreakdown(drivers: DriverBreakdownInput[]): AnomalyFinding[] {
  const fleetBreakdowns = drivers.reduce((sum, driver) => sum + driver.breakdowns, 0);
  const fleetTrips = drivers.reduce((sum, driver) => sum + driver.trips, 0);
  if (fleetTrips === 0 || fleetBreakdowns === 0) return [];
  const fleetRateBp = ratioBp(BigInt(fleetBreakdowns), BigInt(fleetTrips));
  if (fleetRateBp === null || fleetRateBp === 0) return [];

  return drivers.flatMap((driver) => {
    if (driver.breakdowns < MIN_BREAKDOWNS || driver.trips === 0) return [];
    const rateBp = ratioBp(BigInt(driver.breakdowns), BigInt(driver.trips));
    if (rateBp === null || rateBp * 10_000 < fleetRateBp * BREAKDOWN_RATE_FACTOR_BP) return [];

    return [
      {
        type: 'FREQUENT_BREAKDOWN' as const,
        severity: driver.breakdowns >= MIN_BREAKDOWNS * 2 ? ('HIGH' as const) : ('MEDIUM' as const),
        relatedType: 'Driver' as const,
        relatedId: driver.driverId,
        // Downtime cost is not in the data; claiming a figure would be a guess.
        estimatedLoss: null,
        facts: {
          driver: driver.driverName,
          breakdowns: driver.breakdowns,
          trips: driver.trips,
          rateBp,
          fleetRateBp,
        },
      },
    ];
  });
}

export interface RouteTripInput {
  tripId: string;
  tripNumber: string;
  route: string;
  hours: number;
}

/** A run that took much longer than this route usually takes. */
export function detectSlowTrip(trips: RouteTripInput[]): AnomalyFinding[] {
  const byRoute = new Map<string, RouteTripInput[]>();
  for (const trip of trips) {
    const bucket = byRoute.get(trip.route) ?? [];
    bucket.push(trip);
    byRoute.set(trip.route, bucket);
  }

  const findings: AnomalyFinding[] = [];
  for (const [route, runs] of byRoute) {
    if (runs.length < MIN_ROUTE_TRIPS) continue;
    const sorted = [...runs].map((run) => run.hours).sort((a, b) => a - b);
    // Median, not mean: one very slow run must not raise the bar it is judged by.
    const middle = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 1
        ? (sorted[middle] as number)
        : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
    if (median <= 0) continue;

    for (const run of runs) {
      const overBp = Math.round((run.hours / median) * 10_000);
      if (overBp < TRIP_DURATION_FACTOR_BP) continue;
      findings.push({
        type: 'TRIP_TOO_LONG',
        severity: overBp >= TRIP_DURATION_FACTOR_BP * 1.5 ? 'HIGH' : 'MEDIUM',
        relatedType: 'Trip',
        relatedId: run.tripId,
        estimatedLoss: null,
        facts: {
          tripNumber: run.tripNumber,
          route,
          hours: run.hours.toFixed(1),
          medianHours: median.toFixed(1),
          overBp,
          sampleSize: runs.length,
        },
      });
    }
  }
  return findings;
}
