import { detectDeviation, detectIdle, type WatchPoint } from './watch.detect';

const NOW = new Date('2026-08-16T12:00:00Z');
const PARKED = { lat: 41.3111, lng: 69.2797 };

/** A fix `minutesAgo` before NOW, `metres` away from the parking spot. */
function fix(minutesAgo: number, metres = 0): WatchPoint {
  return {
    lat: PARKED.lat + metres / 111_000,
    lng: PARKED.lng,
    recordedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
  };
}

/** GPS arrives every 3 minutes (TZ §3.3), so a stop is a run of near-identical fixes. */
function standing(minutes: number, metres = 30): WatchPoint[] {
  const points: WatchPoint[] = [];
  for (let ago = minutes; ago >= 0; ago -= 3) points.push(fix(ago, ago % 2 === 0 ? metres : 0));
  return points;
}

describe('detectIdle', () => {
  it('flags a vehicle standing longer than the threshold', () => {
    const findings = detectIdle([{ vehicleId: 'v1', points: standing(150) }], 2, NOW);
    expect(findings).toEqual([{ vehicleId: 'v1', hours: 2 }]);
  });

  it('leaves a shorter stop alone', () => {
    expect(detectIdle([{ vehicleId: 'v1', points: standing(90) }], 2, NOW)).toEqual([]);
  });

  it('tolerates GPS drift around a parked truck', () => {
    // 400 m of wander is a receiver drifting, not a truck driving.
    const findings = detectIdle([{ vehicleId: 'v1', points: standing(150, 400) }], 2, NOW);
    expect(findings).toHaveLength(1);
  });

  it('measures the stop backwards, so driving before it does not hide it', () => {
    const drove = [fix(240, 40_000), fix(230, 25_000), fix(220, 9_000)];
    const findings = detectIdle(
      [{ vehicleId: 'v1', points: [...drove, ...standing(140)] }],
      2,
      NOW,
    );
    expect(findings).toEqual([{ vehicleId: 'v1', hours: 2 }]);
  });

  it('says nothing about a truck that only stopped reporting', () => {
    // Newest fix is older than the window: proven silent, not proven still.
    const stale = [fix(400), fix(390), fix(380)];
    expect(detectIdle([{ vehicleId: 'v1', points: stale }], 2, NOW)).toEqual([]);
  });

  it('needs more than one fix to claim anything', () => {
    expect(detectIdle([{ vehicleId: 'v1', points: [fix(0)] }], 2, NOW)).toEqual([]);
    expect(detectIdle([{ vehicleId: 'v1', points: [] }], 2, NOW)).toEqual([]);
  });

  it('does not care what order the trail arrives in', () => {
    const shuffled = [...standing(150)].reverse();
    expect(detectIdle([{ vehicleId: 'v1', points: shuffled }], 2, NOW)).toHaveLength(1);
  });

  it('honours a company that set its own hours', () => {
    const trail = [{ vehicleId: 'v1', points: standing(250) }];
    expect(detectIdle(trail, 2, NOW)).toHaveLength(1);
    expect(detectIdle(trail, 5, NOW)).toEqual([]);
  });
});

describe('detectDeviation', () => {
  const rows = [
    { vehicleId: 'v1', deviationKm: 45.2, onTrip: true },
    { vehicleId: 'v2', deviationKm: 3.1, onTrip: true },
    { vehicleId: 'v3', deviationKm: null, onTrip: true },
    { vehicleId: 'v4', deviationKm: 60, onTrip: false },
  ];

  it('flags only vehicles on a trip that are past the company limit', () => {
    expect(detectDeviation(rows, 20)).toEqual([{ vehicleId: 'v1', deviationKm: 45.2 }]);
  });

  it('claims nothing when the corridor is unknown', () => {
    expect(detectDeviation([rows[2]!], 1)).toEqual([]);
  });

  it('follows the threshold the company set', () => {
    expect(detectDeviation(rows, 50)).toEqual([]);
    expect(detectDeviation(rows, 2)).toHaveLength(2);
  });
});
