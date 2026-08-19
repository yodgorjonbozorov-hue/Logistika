import { AlertSeverity, AlertType, type AlertView } from 'shared';

/**
 * W-10 rules — pure functions over already-fetched rows. The API never sends
 * a sentence: it sends a code plus parameters, and the client renders it in
 * the user's language (same contract as error codes).
 */

/** A service is due once the vehicle is within this many km of the plan. */
export const SERVICE_DUE_KM = 1000;

/** A vehicle on an active trip that has not reported for this long is stuck. */
export const SILENCE_HOURS = 2;

/** Kilometres off the planned corridor before the deviation is worth telling. */
export const DEVIATION_KM = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `now` to `date`; negative once the date has passed. */
export function daysUntil(date: Date, now: Date): number {
  return Math.floor((date.getTime() - now.getTime()) / DAY_MS);
}

/**
 * TZ §4.1 W-10 asks for reminders at 15, 7 and 1 day; each step is a rung on
 * this ladder. Already expired or the last day is critical, a week out is a
 * warning, the first reminder is informational — and anything further away
 * raises nothing at all, because an alert centre that always has entries is
 * one nobody reads.
 */
export function expirySeverity(days: number): AlertSeverity | null {
  if (days <= 1) return AlertSeverity.CRITICAL;
  if (days <= 7) return AlertSeverity.WARNING;
  if (days <= 15) return AlertSeverity.INFO;
  return null;
}

export interface ExpiringDocument {
  /** `insurance`, `techInspection`, `license`, or a `documents.doc_type`. */
  docType: string;
  expiryDate: Date;
  subject: string;
  entity: AlertView['entity'];
}

export function documentAlerts(documents: ExpiringDocument[], now: Date): AlertView[] {
  const alerts: AlertView[] = [];
  for (const document of documents) {
    const days = daysUntil(document.expiryDate, now);
    const severity = expirySeverity(days);
    if (!severity) continue;
    alerts.push({
      id: `${AlertType.DOCUMENT_EXPIRING}:${document.entity.kind}:${document.entity.id}:${document.docType}`,
      type: AlertType.DOCUMENT_EXPIRING,
      severity,
      subject: document.subject,
      entity: document.entity,
      at: document.expiryDate.toISOString(),
      params: { docType: document.docType, days },
    });
  }
  return alerts;
}

export interface ServiceCandidate {
  vehicleId: string;
  plateNumber: string;
  currentOdometer: number | null;
  nextServiceOdometer: number | null;
}

export function serviceAlerts(vehicles: ServiceCandidate[]): AlertView[] {
  const alerts: AlertView[] = [];
  for (const vehicle of vehicles) {
    if (vehicle.currentOdometer === null || vehicle.nextServiceOdometer === null) continue;
    const remaining = vehicle.nextServiceOdometer - vehicle.currentOdometer;
    if (remaining > SERVICE_DUE_KM) continue;
    alerts.push({
      id: `${AlertType.SERVICE_DUE}:${vehicle.vehicleId}`,
      type: AlertType.SERVICE_DUE,
      // Past the planned odometer the service is overdue, not merely near.
      severity: remaining <= 0 ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
      subject: vehicle.plateNumber,
      entity: { kind: 'vehicle', id: vehicle.vehicleId },
      params: { remainingKm: remaining, nextServiceOdometer: vehicle.nextServiceOdometer },
    });
  }
  return alerts;
}

export interface OverdueIncome {
  id: string;
  amount: bigint;
  status: string;
  /** When the invoice was raised — the clock for the client's payment terms. */
  createdAt: Date;
  clientName: string | null;
  clientId: string | null;
  paymentTermsDays: number | null;
}

/**
 * An invoice is late either because someone marked it OVERDUE or because the
 * client's agreed terms have run out. Both are the same problem to an owner.
 */
export function paymentAlerts(incomes: OverdueIncome[], now: Date): AlertView[] {
  const alerts: AlertView[] = [];
  for (const income of incomes) {
    const termDays = income.paymentTermsDays ?? null;
    const dueDate =
      termDays === null ? null : new Date(income.createdAt.getTime() + termDays * DAY_MS);
    const daysLate = dueDate ? -daysUntil(dueDate, now) : 0;
    const flagged = income.status === 'OVERDUE';
    if (!flagged && daysLate <= 0) continue;

    alerts.push({
      id: `${AlertType.PAYMENT_OVERDUE}:${income.id}`,
      type: AlertType.PAYMENT_OVERDUE,
      severity: daysLate > 7 || flagged ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
      subject: income.clientName ?? '—',
      entity: income.clientId
        ? { kind: 'client', id: income.clientId }
        : { kind: 'income', id: income.id },
      at: dueDate?.toISOString(),
      params: { amount: income.amount.toString(), daysLate: Math.max(daysLate, 0) },
    });
  }
  return alerts;
}

export interface FleetSignal {
  vehicleId: string;
  plateNumber: string;
  status: string;
  lastPositionAt: Date | null;
  deviationKm: number | null;
  hasActiveTrip: boolean;
}

export function fleetAlerts(signals: FleetSignal[], now: Date): AlertView[] {
  const alerts: AlertView[] = [];
  for (const signal of signals) {
    if (signal.hasActiveTrip) {
      const silentHours = signal.lastPositionAt
        ? Math.floor((now.getTime() - signal.lastPositionAt.getTime()) / (60 * 60 * 1000))
        : null;
      if (silentHours !== null && silentHours >= SILENCE_HOURS) {
        alerts.push({
          id: `${AlertType.VEHICLE_SILENT}:${signal.vehicleId}`,
          type: AlertType.VEHICLE_SILENT,
          severity:
            silentHours >= SILENCE_HOURS * 2 ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
          subject: signal.plateNumber,
          entity: { kind: 'vehicle', id: signal.vehicleId },
          at: signal.lastPositionAt?.toISOString(),
          params: { hours: silentHours },
        });
      }
    }

    if (signal.deviationKm !== null && signal.deviationKm > DEVIATION_KM) {
      alerts.push({
        id: `${AlertType.ROUTE_DEVIATION}:${signal.vehicleId}`,
        type: AlertType.ROUTE_DEVIATION,
        severity: AlertSeverity.WARNING,
        subject: signal.plateNumber,
        entity: { kind: 'vehicle', id: signal.vehicleId },
        params: { deviationKm: signal.deviationKm },
      });
    }

    if (signal.status === 'BREAKDOWN') {
      alerts.push({
        id: `${AlertType.BREAKDOWN}:${signal.vehicleId}`,
        type: AlertType.BREAKDOWN,
        severity: AlertSeverity.CRITICAL,
        subject: signal.plateNumber,
        entity: { kind: 'vehicle', id: signal.vehicleId },
        at: signal.lastPositionAt?.toISOString(),
        params: {},
      });
    }
  }
  return alerts;
}

export interface FuelSignal {
  vehicleId: string;
  plateNumber: string;
  diffBp: number;
  lossTiyin: string;
  overThreshold: boolean;
}

export function fuelAlerts(rows: FuelSignal[]): AlertView[] {
  return rows
    .filter((row) => row.overThreshold)
    .map((row) => ({
      id: `${AlertType.FUEL_OVERRUN}:${row.vehicleId}`,
      type: AlertType.FUEL_OVERRUN,
      severity: AlertSeverity.WARNING,
      subject: row.plateNumber,
      entity: { kind: 'vehicle' as const, id: row.vehicleId },
      params: { diffBp: row.diffBp, loss: row.lossTiyin },
    }));
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  [AlertSeverity.CRITICAL]: 0,
  [AlertSeverity.WARNING]: 1,
  [AlertSeverity.INFO]: 2,
};

/** Worst first, then the nearest deadline — the order an owner reads in. */
export function sortAlerts(alerts: AlertView[]): AlertView[] {
  return [...alerts].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.at && b.at) return a.at.localeCompare(b.at);
    return a.at ? -1 : b.at ? 1 : a.subject.localeCompare(b.subject);
  });
}

export function countBySeverity(alerts: AlertView[]): Record<AlertSeverity, number> {
  return {
    [AlertSeverity.CRITICAL]: alerts.filter((a) => a.severity === AlertSeverity.CRITICAL).length,
    [AlertSeverity.WARNING]: alerts.filter((a) => a.severity === AlertSeverity.WARNING).length,
    [AlertSeverity.INFO]: alerts.filter((a) => a.severity === AlertSeverity.INFO).length,
  };
}
