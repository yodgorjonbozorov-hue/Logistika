import {
  MIN_TRIPS_FOR_RATING,
  PENALTY_CAP,
  rateDriver,
  ratingToDecimal,
  type DriverStats,
} from './rating.calc';

const CLEAN: DriverStats = {
  driverId: 'd1',
  driverName: 'Alisher',
  trips: 12,
  lateTrips: 0,
  breakdowns: 0,
  fuelDeviationBp: 300, // 3%, inside the 7% norm
};

const THRESHOLD_BP = 700;

describe('rateDriver', () => {
  it('gives a clean record the full five stars', () => {
    const rating = rateDriver(CLEAN, THRESHOLD_BP);
    expect(rating.ratingCentis).toBe(500);
    expect(rating.penalties).toEqual({ lateness: 0, fuel: 0, breakdowns: 0 });
  });

  it('says nothing until there are enough trips to judge', () => {
    const rating = rateDriver({ ...CLEAN, trips: MIN_TRIPS_FOR_RATING - 1 }, THRESHOLD_BP);
    expect(rating.ratingCentis).toBeNull();
    // The inputs are still reported — the driver can see why there is no score.
    expect(rating.trips).toBe(2);
  });

  it('charges lateness in proportion to how often it happens', () => {
    const quarter = rateDriver({ ...CLEAN, lateTrips: 3 }, THRESHOLD_BP); // 25%
    const always = rateDriver({ ...CLEAN, lateTrips: 12 }, THRESHOLD_BP);
    expect(quarter.penalties.lateness).toBe(Math.round(PENALTY_CAP.lateness / 4));
    expect(always.penalties.lateness).toBe(PENALTY_CAP.lateness);
    expect(quarter.lateShareBp).toBe(2500);
  });

  it('only counts fuel past the company threshold', () => {
    // The norm already allows for road, load and season.
    expect(rateDriver({ ...CLEAN, fuelDeviationBp: 700 }, THRESHOLD_BP).penalties.fuel).toBe(0);
    expect(rateDriver({ ...CLEAN, fuelDeviationBp: 1450 }, THRESHOLD_BP).penalties.fuel).toBe(100);
    expect(rateDriver({ ...CLEAN, fuelDeviationBp: 9000 }, THRESHOLD_BP).penalties.fuel).toBe(
      PENALTY_CAP.fuel,
    );
  });

  it('rewards a driver who burns less than the norm, by charging nothing', () => {
    expect(rateDriver({ ...CLEAN, fuelDeviationBp: -1200 }, THRESHOLD_BP).ratingCentis).toBe(500);
    expect(rateDriver({ ...CLEAN, fuelDeviationBp: null }, THRESHOLD_BP).penalties.fuel).toBe(0);
  });

  it('charges breakdowns by rate, not by count', () => {
    const busy = rateDriver({ ...CLEAN, trips: 40, breakdowns: 4 }, THRESHOLD_BP); // 1 in 10
    const rare = rateDriver({ ...CLEAN, trips: 10, breakdowns: 4 }, THRESHOLD_BP); // 1 in 2.5
    expect(busy.penalties.breakdowns).toBeLessThan(rare.penalties.breakdowns);
    expect(rare.penalties.breakdowns).toBe(PENALTY_CAP.breakdowns);
  });

  it('never falls below one star, however bad the record', () => {
    const worst = rateDriver(
      { ...CLEAN, lateTrips: 12, breakdowns: 12, fuelDeviationBp: 20_000 },
      THRESHOLD_BP,
    );
    expect(worst.ratingCentis).toBe(100);
  });

  it('shows the three penalties separately, so the score can be explained', () => {
    const rating = rateDriver(
      { ...CLEAN, lateTrips: 6, breakdowns: 1, fuelDeviationBp: 1200 },
      THRESHOLD_BP,
    );
    const total = rating.penalties.lateness + rating.penalties.fuel + rating.penalties.breakdowns;
    expect(rating.ratingCentis).toBe(500 - total);
  });

  it('stays an integer, so equal records always sort equally', () => {
    const a = rateDriver({ ...CLEAN, lateTrips: 1 }, THRESHOLD_BP);
    const b = rateDriver({ ...CLEAN, driverId: 'd2', lateTrips: 1 }, THRESHOLD_BP);
    expect(Number.isInteger(a.ratingCentis)).toBe(true);
    expect(a.ratingCentis).toBe(b.ratingCentis);
  });
});

describe('ratingToDecimal', () => {
  it('writes hundredths of a star the way they are stored and shown', () => {
    expect(ratingToDecimal(500)).toBe('5.00');
    expect(ratingToDecimal(435)).toBe('4.35');
    expect(ratingToDecimal(100)).toBe('1.00');
    expect(ratingToDecimal(405)).toBe('4.05');
    expect(ratingToDecimal(null)).toBeNull();
  });
});
