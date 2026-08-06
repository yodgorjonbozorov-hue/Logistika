import { distanceToSegmentKm, haversineKm } from './geo';

// Reference cities on the Tashkent–Samarkand corridor.
const TASHKENT = { lat: 41.2995, lng: 69.2401 };
const SAMARKAND = { lat: 39.627, lng: 66.975 };
const JIZZAKH = { lat: 40.1158, lng: 67.8422 }; // roughly on the corridor
const NUKUS = { lat: 42.4531, lng: 59.6103 }; // far off it

describe('geo helpers', () => {
  it('haversine matches known city distance (Tashkent–Samarkand ≈ 265–275 km)', () => {
    const distance = haversineKm(TASHKENT, SAMARKAND);
    expect(distance).toBeGreaterThan(255);
    expect(distance).toBeLessThan(285);
  });

  it('a point on the corridor deviates only a little', () => {
    expect(distanceToSegmentKm(JIZZAKH, TASHKENT, SAMARKAND)).toBeLessThan(25);
  });

  it('a far-away point deviates a lot', () => {
    expect(distanceToSegmentKm(NUKUS, TASHKENT, SAMARKAND)).toBeGreaterThan(400);
  });

  it('degenerate segment falls back to point distance', () => {
    expect(distanceToSegmentKm(SAMARKAND, TASHKENT, TASHKENT)).toBeCloseTo(
      haversineKm(SAMARKAND, TASHKENT),
      5,
    );
  });

  it('clamps beyond segment ends (before start / after end)', () => {
    const beyond = { lat: 42.5, lng: 70.5 }; // "past" Tashkent away from Samarkand
    const viaSegment = distanceToSegmentKm(beyond, TASHKENT, SAMARKAND);
    const toStart = haversineKm(beyond, TASHKENT);
    expect(Math.abs(viaSegment - toStart)).toBeLessThan(5);
  });
});
