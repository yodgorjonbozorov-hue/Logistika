import {
  detectExpensiveRepair,
  detectFrequentBreakdown,
  detectFuelOverrun,
  detectSlowTrip,
  type RepairInput,
} from './anomaly.detect';

describe('detectFuelOverrun', () => {
  const row = (over: Partial<Parameters<typeof detectFuelOverrun>[0][number]> = {}) => ({
    vehicleId: 'v1',
    plateNumber: '01 A 123 AA',
    deviationLitres: '180.0',
    deviationBp: 1200,
    lossTiyin: 210_000_000n,
    refuelCount: 4,
    exceedsThreshold: true,
    ...over,
  });

  it('reports only vehicles the fuel module already marked over threshold', () => {
    const findings = detectFuelOverrun(
      [row(), row({ vehicleId: 'v2', exceedsThreshold: false })],
      700,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.relatedId).toBe('v1');
    expect(findings[0]!.estimatedLoss).toBe(210_000_000n);
  });

  it('raises the severity the further past the threshold it is', () => {
    expect(detectFuelOverrun([row({ deviationBp: 900 })], 700)[0]!.severity).toBe('MEDIUM');
    expect(detectFuelOverrun([row({ deviationBp: 1500 })], 700)[0]!.severity).toBe('HIGH');
    expect(detectFuelOverrun([row({ deviationBp: 2200 })], 700)[0]!.severity).toBe('CRITICAL');
  });

  it('carries the measured figures, and only those', () => {
    const facts = detectFuelOverrun([row()], 700)[0]!.facts;
    expect(facts).toEqual({
      plate: '01 A 123 AA',
      deviationLitres: '180.0',
      deviationBp: 1200,
      thresholdBp: 700,
      refuelCount: 4,
    });
  });
});

describe('detectExpensiveRepair', () => {
  const repair = (id: string, amount: bigint): RepairInput => ({
    id,
    vehicleId: 'v1',
    plateNumber: '01 A 123 AA',
    amount,
    description: 'Tormoz kolodkalari',
    date: new Date('2026-08-01T00:00:00Z'),
  });

  const ORDINARY = [
    repair('e1', 100_000_000n),
    repair('e2', 110_000_000n),
    repair('e3', 90_000_000n),
    repair('e4', 105_000_000n),
    repair('e5', 95_000_000n),
  ];

  it('says nothing until there are enough repairs to average', () => {
    expect(detectExpensiveRepair(ORDINARY.slice(0, 4))).toEqual([]);
  });

  it('leaves ordinary repairs alone', () => {
    expect(detectExpensiveRepair(ORDINARY)).toEqual([]);
  });

  it('flags a repair 40% over what the others cost', () => {
    const findings = detectExpensiveRepair([...ORDINARY, repair('e6', 150_000_000n)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.relatedId).toBe('e6');
    expect(findings[0]!.severity).toBe('MEDIUM');
    // 150M against an average of 100M of the other five — 50% over.
    expect(findings[0]!.facts.average).toBe('100000000');
    expect(findings[0]!.facts.overBp).toBe(5000);
    expect(findings[0]!.estimatedLoss).toBe(50_000_000n);
  });

  it('compares against the others, so one huge bill cannot excuse itself', () => {
    const findings = detectExpensiveRepair([...ORDINARY, repair('e6', 900_000_000n)]);
    expect(findings[0]!.severity).toBe('HIGH');
    expect(findings[0]!.facts.sampleSize).toBe(5);
  });

  it('states how thin the evidence is', () => {
    const findings = detectExpensiveRepair([...ORDINARY, repair('e6', 200_000_000n)]);
    expect(findings[0]!.facts.sampleSize).toBe(5);
    expect(findings[0]!.facts.overBp).toBe(10_000); // exactly 100% over
  });
});

describe('detectFrequentBreakdown', () => {
  const fleet = [
    { driverId: 'd1', driverName: 'Alisher', breakdowns: 6, trips: 10 },
    { driverId: 'd2', driverName: 'Bobur', breakdowns: 1, trips: 12 },
    { driverId: 'd3', driverName: 'Doniyor', breakdowns: 1, trips: 14 },
  ];

  it('flags the driver breaking down far more often than the fleet', () => {
    const findings = detectFrequentBreakdown(fleet);
    expect(findings.map((f) => f.relatedId)).toEqual(['d1']);
    expect(findings[0]!.facts.breakdowns).toBe(6);
    // No downtime cost exists in the data, so none is claimed.
    expect(findings[0]!.estimatedLoss).toBeNull();
  });

  it('ignores a driver with too few breakdowns to mean anything', () => {
    const quiet = fleet.map((d) => (d.driverId === 'd1' ? { ...d, breakdowns: 2 } : d));
    expect(detectFrequentBreakdown(quiet)).toEqual([]);
  });

  it('says nothing about a fleet with no breakdowns at all', () => {
    expect(detectFrequentBreakdown(fleet.map((d) => ({ ...d, breakdowns: 0 })))).toEqual([]);
    expect(detectFrequentBreakdown([])).toEqual([]);
  });
});

describe('detectSlowTrip', () => {
  const run = (tripId: string, hours: number, route = 'Toshkent → Moskva') => ({
    tripId,
    tripNumber: tripId.toUpperCase(),
    route,
    hours,
  });

  it('needs a few runs on the route before it judges any of them', () => {
    expect(detectSlowTrip([run('t1', 60), run('t2', 200)])).toEqual([]);
  });

  it('flags the run half again longer than the route median', () => {
    // Four runs: the median is the mean of the middle two, 61 and 62.
    const findings = detectSlowTrip([run('t1', 60), run('t2', 62), run('t3', 61), run('t4', 95)]);
    expect(findings.map((f) => f.relatedId)).toEqual(['t4']);
    expect(findings[0]!.facts.medianHours).toBe('61.5');
  });

  it('uses the median, so two slow runs cannot hide behind each other', () => {
    // With a mean, 150 and 160 would drag the bar up and nothing would be flagged.
    const findings = detectSlowTrip([
      run('t1', 60),
      run('t2', 61),
      run('t3', 62),
      run('t4', 150),
      run('t5', 160),
    ]);
    expect(findings.map((f) => f.relatedId).sort()).toEqual(['t4', 't5']);
  });

  it('judges each route on its own history', () => {
    const findings = detectSlowTrip([
      run('t1', 60),
      run('t2', 61),
      run('t3', 62),
      run('s1', 8, 'Toshkent → Samarqand'),
      run('s2', 9, 'Toshkent → Samarqand'),
      run('s3', 20, 'Toshkent → Samarqand'),
    ]);
    expect(findings.map((f) => f.relatedId)).toEqual(['s3']);
    expect(findings[0]!.facts.route).toBe('Toshkent → Samarqand');
  });
});
