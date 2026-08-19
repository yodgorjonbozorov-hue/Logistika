import { AlertSeverity, AlertType } from 'shared';
import {
  countBySeverity,
  daysUntil,
  documentAlerts,
  expirySeverity,
  fleetAlerts,
  fuelAlerts,
  paymentAlerts,
  serviceAlerts,
  sortAlerts,
} from './alerts.rules';

const NOW = new Date('2026-08-19T10:00:00Z');
const inDays = (days: number): Date => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

describe('expiry ladder (TZ W-10: 15 / 7 / 1 kun)', () => {
  it('counts whole days to the deadline', () => {
    expect(daysUntil(inDays(15), NOW)).toBe(15);
    expect(daysUntil(inDays(-3), NOW)).toBe(-3);
  });

  it('escalates as the deadline approaches and stays critical after it passes', () => {
    expect(expirySeverity(20)).toBeNull();
    expect(expirySeverity(15)).toBe(AlertSeverity.INFO);
    expect(expirySeverity(7)).toBe(AlertSeverity.WARNING);
    expect(expirySeverity(1)).toBe(AlertSeverity.CRITICAL);
    expect(expirySeverity(-10)).toBe(AlertSeverity.CRITICAL);
  });

  it('says nothing about a document that is nowhere near expiring', () => {
    const alerts = documentAlerts(
      [
        {
          docType: 'insurance',
          expiryDate: inDays(60),
          subject: '01 A 447 EA',
          entity: { kind: 'vehicle', id: 'v1' },
        },
      ],
      NOW,
    );
    expect(alerts).toEqual([]);
  });

  it('carries the code and its parameters, never a sentence', () => {
    const [alert] = documentAlerts(
      [
        {
          docType: 'techInspection',
          expiryDate: inDays(5),
          subject: '01 A 447 EA',
          entity: { kind: 'vehicle', id: 'v1' },
        },
      ],
      NOW,
    );
    expect(alert).toMatchObject({
      type: AlertType.DOCUMENT_EXPIRING,
      severity: AlertSeverity.WARNING,
      subject: '01 A 447 EA',
      entity: { kind: 'vehicle', id: 'v1' },
      params: { docType: 'techInspection', days: 5 },
    });
    expect(Object.values(alert!.params).every((value) => typeof value !== 'object')).toBe(true);
  });

  it('gives an alert a stable id, so a refresh does not duplicate the row', () => {
    const args = [
      {
        docType: 'insurance',
        expiryDate: inDays(3),
        subject: '01 A 447 EA',
        entity: { kind: 'vehicle' as const, id: 'v1' },
      },
    ];
    expect(documentAlerts(args, NOW)[0]!.id).toBe(documentAlerts(args, NOW)[0]!.id);
  });
});

describe('serviceAlerts', () => {
  const vehicle = { vehicleId: 'v1', plateNumber: '01 A 447 EA' };

  it('warns inside the last 1 000 km and escalates once the plan is passed', () => {
    expect(
      serviceAlerts([{ ...vehicle, currentOdometer: 411_500, nextServiceOdometer: 412_000 }])[0],
    ).toMatchObject({ severity: AlertSeverity.WARNING, params: { remainingKm: 500 } });

    expect(
      serviceAlerts([{ ...vehicle, currentOdometer: 413_000, nextServiceOdometer: 412_000 }])[0],
    ).toMatchObject({ severity: AlertSeverity.CRITICAL, params: { remainingKm: -1000 } });
  });

  it('stays quiet while the service is far off or unplanned', () => {
    expect(
      serviceAlerts([{ ...vehicle, currentOdometer: 400_000, nextServiceOdometer: 412_000 }]),
    ).toEqual([]);
    expect(
      serviceAlerts([{ ...vehicle, currentOdometer: 400_000, nextServiceOdometer: null }]),
    ).toEqual([]);
    expect(
      serviceAlerts([{ ...vehicle, currentOdometer: null, nextServiceOdometer: 412_000 }]),
    ).toEqual([]);
  });
});

describe('paymentAlerts', () => {
  const base = {
    id: 'i1',
    amount: 1_250_000_000n,
    status: 'PENDING',
    clientId: 'c1',
    clientName: 'Uzbek Cement',
  };

  it('raises an invoice once the client’s own terms have run out', () => {
    const [alert] = paymentAlerts([{ ...base, createdAt: inDays(-20), paymentTermsDays: 14 }], NOW);
    expect(alert).toMatchObject({
      type: AlertType.PAYMENT_OVERDUE,
      severity: AlertSeverity.WARNING, // six days late
      subject: 'Uzbek Cement',
      params: { amount: '1250000000', daysLate: 6 },
    });
  });

  it('escalates once the invoice is more than a week past its terms', () => {
    const [alert] = paymentAlerts([{ ...base, createdAt: inDays(-25), paymentTermsDays: 14 }], NOW);
    expect(alert).toMatchObject({
      severity: AlertSeverity.CRITICAL,
      params: { daysLate: 11 },
    });
  });

  it('keeps quiet while the invoice is still inside the terms', () => {
    expect(paymentAlerts([{ ...base, createdAt: inDays(-3), paymentTermsDays: 14 }], NOW)).toEqual(
      [],
    );
  });

  it('trusts an explicit OVERDUE flag even without agreed terms', () => {
    const [alert] = paymentAlerts(
      [{ ...base, status: 'OVERDUE', createdAt: inDays(-1), paymentTermsDays: null }],
      NOW,
    );
    expect(alert?.severity).toBe(AlertSeverity.CRITICAL);
  });
});

describe('fleetAlerts', () => {
  const vehicle = {
    vehicleId: 'v1',
    plateNumber: '01 A 447 EA',
    status: 'MOVING',
    deviationKm: null,
    hasActiveTrip: true,
  };

  it('reports a truck that has been silent for two hours on an active trip', () => {
    const [alert] = fleetAlerts(
      [{ ...vehicle, lastPositionAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) }],
      NOW,
    );
    expect(alert).toMatchObject({ type: AlertType.VEHICLE_SILENT, params: { hours: 3 } });
  });

  it('says nothing about a parked truck with no trip', () => {
    expect(
      fleetAlerts(
        [
          {
            ...vehicle,
            status: 'IDLE',
            hasActiveTrip: false,
            lastPositionAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000),
          },
        ],
        NOW,
      ),
    ).toEqual([]);
  });

  it('flags a route deviation past the corridor and a breakdown outright', () => {
    const alerts = fleetAlerts(
      [{ ...vehicle, status: 'BREAKDOWN', lastPositionAt: NOW, deviationKm: 34 }],
      NOW,
    );
    expect(alerts.map((alert) => alert.type)).toEqual([
      AlertType.ROUTE_DEVIATION,
      AlertType.BREAKDOWN,
    ]);
    expect(alerts.find((a) => a.type === AlertType.BREAKDOWN)?.severity).toBe(
      AlertSeverity.CRITICAL,
    );
  });
});

describe('fuelAlerts', () => {
  it('passes through only the rows the fuel module already flagged', () => {
    const alerts = fuelAlerts([
      {
        vehicleId: 'v1',
        plateNumber: '01 A 447 EA',
        diffBp: 1391,
        lossTiyin: '55200000',
        overThreshold: true,
      },
      {
        vehicleId: 'v2',
        plateNumber: '30 B 210 CA',
        diffBp: 293,
        lossTiyin: '3680000',
        overThreshold: false,
      },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type: AlertType.FUEL_OVERRUN,
      params: { diffBp: 1391, loss: '55200000' },
    });
  });
});

describe('sorting and counting', () => {
  const alert = (severity: AlertSeverity, at?: string, subject = 'x') => ({
    id: `${severity}:${at ?? subject}`,
    type: AlertType.DOCUMENT_EXPIRING,
    severity,
    subject,
    entity: { kind: 'vehicle' as const, id: 'v1' },
    at,
    params: {},
  });

  it('puts the worst first and the nearest deadline before the rest', () => {
    const sorted = sortAlerts([
      alert(AlertSeverity.INFO, '2026-08-25T00:00:00.000Z'),
      alert(AlertSeverity.CRITICAL, '2026-08-30T00:00:00.000Z'),
      alert(AlertSeverity.CRITICAL, '2026-08-20T00:00:00.000Z'),
    ]);
    expect(sorted.map((item) => [item.severity, item.at])).toEqual([
      [AlertSeverity.CRITICAL, '2026-08-20T00:00:00.000Z'],
      [AlertSeverity.CRITICAL, '2026-08-30T00:00:00.000Z'],
      [AlertSeverity.INFO, '2026-08-25T00:00:00.000Z'],
    ]);
  });

  it('counts each severity for the dashboard badge', () => {
    const counts = countBySeverity([
      alert(AlertSeverity.CRITICAL),
      alert(AlertSeverity.CRITICAL, undefined, 'y'),
      alert(AlertSeverity.WARNING),
    ]);
    expect(counts).toEqual({ CRITICAL: 2, WARNING: 1, INFO: 0 });
  });
});
