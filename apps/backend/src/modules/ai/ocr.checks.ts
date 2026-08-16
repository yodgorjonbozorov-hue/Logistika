import { divRound } from '../../common/money';
import { haversineKm, type GeoPoint } from '../../common/geo';

/**
 * The automatic checks TZ §8.3 requires after OCR.
 *
 * Every one of them is plain deterministic code: the model reads the paper, the
 * arithmetic that decides whether the paper is trustworthy is ours (TZ §8.12
 * rule 7). A check never blocks the entry — it is shown next to the proposal so
 * the person confirming can see what does not add up.
 */
export const OCR_CHECK_CODES = [
  'AMOUNT_MISMATCH',
  'DATE_OUT_OF_TRIP',
  'LOCATION_MISMATCH',
  'LOCATION_UNVERIFIED',
  'DUPLICATE_RECEIPT',
  'LOW_CONFIDENCE',
] as const;
export type OcrCheckCode = (typeof OCR_CHECK_CODES)[number];

export interface OcrCheck {
  code: OcrCheckCode;
  /** ERROR is a red flag for the boss; WARNING only asks the user to look. */
  severity: 'WARNING' | 'ERROR';
  params: Record<string, string | number>;
}

/** Sum may differ from litres × price by 1% — rounding on the till (TZ §8.3). */
export const AMOUNT_TOLERANCE_BP = 100;
/** Below this the answer is not offered as filled-in data (TZ §8.2). */
export const MIN_CONFIDENCE_BP = 7000;
/** A receipt may be dated a day outside the trip window without being wrong. */
export const DATE_GRACE_HOURS = 24;
/** How far from the receipt time we look for a GPS fix to compare against. */
export const LOCATION_WINDOW_HOURS = 2;

const HOUR_MS = 3_600_000;
const CENTILITRE = 100n;

/**
 * total ≈ litres × price per litre.
 * `litresCl` is centilitres and `pricePerLitre`/`total` are tiyin, so the whole
 * comparison stays in integers.
 */
export function checkAmount(
  litresCl: bigint | null,
  pricePerLitre: bigint | null,
  total: bigint | null,
): OcrCheck | null {
  if (litresCl === null || pricePerLitre === null || total === null) return null;
  if (litresCl <= 0n || pricePerLitre <= 0n || total <= 0n) return null;

  const expected = divRound(litresCl * pricePerLitre, CENTILITRE);
  if (expected <= 0n) return null;
  const diff = expected > total ? expected - total : total - expected;
  // diff / expected > 1% — multiplied out, so no division and no float is needed.
  if (diff * 10_000n <= BigInt(AMOUNT_TOLERANCE_BP) * expected) return null;

  return {
    code: 'AMOUNT_MISMATCH',
    severity: 'WARNING',
    params: { expected: expected.toString(), actual: total.toString() },
  };
}

export interface TripWindow {
  startedAt: Date | null;
  finishedAt: Date | null;
  loadingDate: Date | null;
  unloadingDate: Date | null;
}

/** The period a receipt of this trip may plausibly be dated in. */
export function tripWindow(trip: TripWindow, now: Date): { from: Date; to: Date } | null {
  const start = trip.startedAt ?? trip.loadingDate;
  if (!start) return null;
  const end = trip.finishedAt ?? trip.unloadingDate ?? now;
  const grace = DATE_GRACE_HOURS * HOUR_MS;
  return { from: new Date(start.getTime() - grace), to: new Date(end.getTime() + grace) };
}

export function checkDate(
  receiptDate: Date | null,
  trip: TripWindow | null,
  now: Date,
): OcrCheck | null {
  if (!receiptDate || !trip) return null;
  const window = tripWindow(trip, now);
  if (!window) return null;
  if (receiptDate >= window.from && receiptDate <= window.to) return null;
  return {
    code: 'DATE_OUT_OF_TRIP',
    severity: 'WARNING',
    params: {
      date: receiptDate.toISOString(),
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    },
  };
}

export interface TrackPoint extends GeoPoint {
  recordedAt: Date;
}

/**
 * Was the vehicle where the receipt was photographed?
 *
 * `capture` is the position the phone reported when the photo was taken. We
 * compare it with the vehicle's own GPS fix closest in time; with no fix nearby
 * nothing is claimed either way — the check reports that it could not verify,
 * which is different from reporting a mismatch.
 */
export function checkLocation(
  capture: GeoPoint | null,
  receiptTime: Date | null,
  track: TrackPoint[],
  maxKm: number,
): OcrCheck | null {
  if (!capture || !receiptTime) return null;

  const windowMs = LOCATION_WINDOW_HOURS * HOUR_MS;
  let nearest: TrackPoint | null = null;
  let nearestGap = Number.POSITIVE_INFINITY;
  for (const point of track) {
    const gap = Math.abs(point.recordedAt.getTime() - receiptTime.getTime());
    if (gap <= windowMs && gap < nearestGap) {
      nearest = point;
      nearestGap = gap;
    }
  }
  if (!nearest) {
    return { code: 'LOCATION_UNVERIFIED', severity: 'WARNING', params: {} };
  }

  const distanceKm = haversineKm(capture, nearest);
  if (distanceKm <= maxKm) return null;
  return {
    code: 'LOCATION_MISMATCH',
    severity: 'ERROR',
    params: { distanceKm: distanceKm.toFixed(1), limitKm: maxKm },
  };
}

export function checkConfidence(confidenceBp: number | null): OcrCheck | null {
  if (confidenceBp === null || confidenceBp >= MIN_CONFIDENCE_BP) return null;
  return {
    code: 'LOW_CONFIDENCE',
    severity: 'WARNING',
    params: { confidenceBp, minBp: MIN_CONFIDENCE_BP },
  };
}

export function duplicateCheck(previousRequestId: string): OcrCheck {
  return {
    code: 'DUPLICATE_RECEIPT',
    severity: 'ERROR',
    params: { requestId: previousRequestId },
  };
}
