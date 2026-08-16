import { CLIENTS, DRIVERS, TRIPS, USERS, VEHICLES, day, fuelDeviationBp, som } from './dataset';

/** The demo fuel threshold, i.e. what the seeded company falls back to. */
const THRESHOLD_BP = 700;

describe('the seed dataset', () => {
  it('gives every row a stable, unique id', () => {
    const ids = [...USERS, ...VEHICLES, ...DRIVERS, ...CLIENTS, ...TRIPS].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('seed-'))).toBe(true);
  });

  it('numbers the trips uniquely, the way the company would', () => {
    const numbers = TRIPS.map((trip) => trip.tripNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('points every trip at a vehicle, driver and client that exist', () => {
    for (const trip of TRIPS) {
      expect(VEHICLES.map((v) => v.id)).toContain(trip.vehicleId);
      expect(DRIVERS.map((d) => d.id)).toContain(trip.driverId);
      expect(CLIENTS.map((c) => c.id)).toContain(trip.clientId);
    }
  });

  it('covers all three salary rules, so the P&L screen shows each of them', () => {
    expect(new Set(DRIVERS.map((driver) => driver.salaryType))).toEqual(
      new Set(['PERCENT', 'PER_KM', 'FIXED']),
    );
  });

  it('covers the trip states the panel has to render', () => {
    expect(new Set(TRIPS.map((trip) => trip.status))).toEqual(
      new Set(['COMPLETED', 'IN_PROGRESS', 'ASSIGNED']),
    );
  });

  it('puts exactly one vehicle clearly over the fuel threshold', () => {
    const over = TRIPS.filter((trip) => (fuelDeviationBp(trip) ?? 0) > THRESHOLD_BP);
    expect(over.map((trip) => trip.tripNumber)).toEqual(['R-001']);
    // Clearly over, not marginally — a demo that hovers on the line teaches nothing.
    expect(fuelDeviationBp(over[0]!)).toBeGreaterThan(1000);
  });

  it('keeps the other trips clearly inside the norm', () => {
    const inNorm = TRIPS.filter((trip) => trip.litres && trip.tripNumber !== 'R-001');
    expect(inNorm.length).toBeGreaterThan(0);
    for (const trip of inNorm) {
      expect(`${trip.tripNumber}:${fuelDeviationBp(trip)! < THRESHOLD_BP}`).toBe(
        `${trip.tripNumber}:true`,
      );
    }
  });

  it('prices every trip above zero, with an advance no larger than the price', () => {
    for (const trip of TRIPS) {
      expect(trip.price).toBeGreaterThan(0n);
      expect(trip.advance).toBeLessThanOrEqual(trip.price);
    }
  });

  it('leaves one driver licence expiring soon, so the reminders are not empty', () => {
    const soon = DRIVERS.filter(
      (driver) => driver.licenseExpiry.getTime() - Date.now() < 15 * 24 * 3_600_000,
    );
    expect(soon).toHaveLength(1);
  });

  it('carries the depreciation inputs every vehicle needs for the P&L', () => {
    for (const vehicle of VEHICLES) {
      expect(vehicle.purchasePrice).toBeGreaterThan(0n);
      expect(vehicle.plannedTotalKm).toBeGreaterThan(0);
      expect(Number(vehicle.fuelNormPer100km)).toBeGreaterThan(0);
    }
  });
});

describe('the seed helpers', () => {
  it('writes money in tiyin', () => {
    expect(som(12_000)).toBe(1_200_000n);
  });

  it('anchors dates to now, so the data is never stale', () => {
    const yesterday = day(-1, 9);
    expect(yesterday.getUTCHours()).toBe(9);
    expect(Date.now() - yesterday.getTime()).toBeGreaterThan(0);
    expect(day(1).getTime()).toBeGreaterThan(Date.now());
  });
});
