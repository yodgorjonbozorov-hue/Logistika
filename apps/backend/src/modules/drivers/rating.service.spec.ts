import { ACTOR, createTenantDbMock } from '../../test-utils/tenant-db.mock';
import { RatingService } from './rating.service';

const NOW = new Date('2026-08-16T12:00:00Z');

/** One 1000 km trip at a 30 l/100km norm — 300 l is exactly the norm. */
const TRIP = {
  id: 't1',
  driverId: 'd1',
  vehicleId: 'v1',
  finishedAt: new Date('2026-08-10T18:00:00Z'),
  unloadingDate: new Date('2026-08-11T18:00:00Z'),
  actualDistanceKm: '1000.0',
  plannedDistanceKm: '1000.0',
  vehicle: { fuelNormPer100km: '30.00' },
};

function setup(
  options: {
    trips?: unknown[];
    fuel?: unknown[];
    breakdowns?: unknown[];
    drivers?: unknown[];
  } = {},
) {
  const { prisma, db, forCompany } = createTenantDbMock(['driver', 'trip', 'tripEvent', 'fuelLog']);
  (prisma as unknown as { company: Record<string, jest.Mock> }).company = {
    findMany: jest.fn().mockResolvedValue([{ id: 'company-a' }]),
  };

  db.driver!.findMany!.mockResolvedValue(options.drivers ?? [{ id: 'd1', fullName: 'Alisher' }]);
  db.trip!.findMany!.mockResolvedValue(
    options.trips ?? [TRIP, { ...TRIP, id: 't2' }, { ...TRIP, id: 't3' }],
  );
  db.tripEvent!.groupBy!.mockResolvedValue(options.breakdowns ?? []);
  db.fuelLog!.findMany!.mockResolvedValue(
    options.fuel ?? [
      { tripId: 't1', liters: '300.00' },
      { tripId: 't2', liters: '300.00' },
      { tripId: 't3', liters: '300.00' },
    ],
  );
  db.driver!.update!.mockResolvedValue({});

  const settings = {
    thresholds: jest.fn().mockResolvedValue({ fuelDeviationThresholdBp: 700 }),
  };
  return { service: new RatingService(prisma, settings as never), db, prisma, forCompany };
}

describe('RatingService.ratings', () => {
  it('gives a driver on norm and on time the full score', async () => {
    const { service, forCompany } = setup();

    const [rating] = await service.ratings(ACTOR, NOW);

    expect(rating!.driverName).toBe('Alisher');
    expect(rating!.trips).toBe(3);
    expect(rating!.fuelDeviationBp).toBe(0);
    expect(rating!.ratingCentis).toBe(500);
    expect(forCompany).toHaveBeenCalledWith('company-a');
  });

  it('counts a trip finished after the agreed date as late', async () => {
    const { service } = setup({
      trips: [
        { ...TRIP, finishedAt: new Date('2026-08-12T18:00:00Z') }, // a day late
        { ...TRIP, id: 't2' },
        { ...TRIP, id: 't3' },
      ],
    });

    const [rating] = await service.ratings(ACTOR, NOW);

    expect(rating!.lateTrips).toBe(1);
    expect(rating!.penalties.lateness).toBeGreaterThan(0);
  });

  it('measures fuel against the vehicle norm, in exact integers', async () => {
    const { service } = setup({
      fuel: [
        { tripId: 't1', liters: '345.00' }, // 15% over 300 l
        { tripId: 't2', liters: '300.00' },
        { tripId: 't3', liters: '300.00' },
      ],
    });

    const [rating] = await service.ratings(ACTOR, NOW);

    // 945 l against a 900 l norm across the three trips — exactly 5%.
    expect(rating!.fuelDeviationBp).toBe(500);
    expect(rating!.penalties.fuel).toBe(0); // still inside the 7% threshold
  });

  it('judges nobody on a missing norm or a missing distance', async () => {
    const { service } = setup({
      trips: [
        { ...TRIP, vehicle: { fuelNormPer100km: null } },
        { ...TRIP, id: 't2', actualDistanceKm: null, plannedDistanceKm: null },
        { ...TRIP, id: 't3' },
      ],
      fuel: [{ tripId: 't3', liters: '400.00' }],
    });

    const [rating] = await service.ratings(ACTOR, NOW);

    // Only t3 had both a norm and a distance: 400 l against 300 l.
    expect(rating!.fuelDeviationBp).toBe(3333);
  });

  it('reports no deviation at all when nothing can be measured', async () => {
    const { service } = setup({ fuel: [] });
    const [rating] = await service.ratings(ACTOR, NOW);
    expect(rating!.fuelDeviationBp).toBeNull();
    expect(rating!.penalties.fuel).toBe(0);
  });

  it('counts breakdowns per driver', async () => {
    const { service } = setup({ breakdowns: [{ driverId: 'd1', _count: { _all: 2 } }] });
    const [rating] = await service.ratings(ACTOR, NOW);
    expect(rating!.breakdowns).toBe(2);
    expect(rating!.penalties.breakdowns).toBeGreaterThan(0);
  });

  it('sorts the best driver first, and the unrated last', async () => {
    const { service } = setup({
      drivers: [
        { id: 'd1', fullName: 'Alisher' },
        { id: 'd2', fullName: 'Yangi haydovchi' },
      ],
    });

    const ratings = await service.ratings(ACTOR, NOW);

    expect(ratings.map((r) => r.driverName)).toEqual(['Alisher', 'Yangi haydovchi']);
    expect(ratings[1]!.ratingCentis).toBeNull();
  });
});

describe('RatingService.refresh', () => {
  it('caches the score on the driver as a decimal', async () => {
    const { service, db } = setup();

    expect(await service.refresh('company-a', NOW)).toBe(1);

    const call = db.driver!.update!.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'd1' });
    expect(String(call.data.rating)).toBe('5');
  });

  it('clears the cached score when there is not enough to judge', async () => {
    const { service, db } = setup({ trips: [TRIP] });

    await service.refresh('company-a', NOW);

    expect(db.driver!.update!.mock.calls[0][0].data).toEqual({ rating: null });
  });

  it('keeps going when one company fails', async () => {
    const { service, prisma, db } = setup();
    (prisma as unknown as { company: { findMany: jest.Mock } }).company.findMany.mockResolvedValue([
      { id: 'company-a' },
      { id: 'company-b' },
    ]);
    db.driver!.update!.mockRejectedValueOnce(new Error('database is on fire'));

    await service.refreshAllCompanies(NOW);

    expect(db.driver!.update).toHaveBeenCalledTimes(2);
  });
});
