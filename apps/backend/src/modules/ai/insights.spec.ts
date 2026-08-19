import { buildInsights, type InsightInput } from './insights';

/** Money is grouped with a non-breaking space, like everywhere else. */
const NBSP = '\u00A0';

const summary = (over: Partial<InsightInput['summary']> = {}): InsightInput['summary'] =>
  ({
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-09-01T00:00:00.000Z',
    revenue: '900000000',
    invoiced: '0',
    received: '0',
    outstanding: '0',
    expenses: '300000000',
    fuelCost: '300000000',
    profit: '600000000',
    marginBp: 6667,
    trips: { total: 3, completed: 3, cancelled: 0, inProgress: 0 },
    trucksDispatched: 2,
    routesUsed: 2,
    distanceKm: '500.0',
    fuelLitres: '200.00',
    costPerKm: null,
    revenuePerKm: null,
    profitPerKm: null,
    profitPerTrip: null,
    expensesByCategory: [],
    ...over,
  }) as InsightInput['summary'];

const month = (over: Partial<InsightInput['monthly'][number]>) =>
  ({
    month: '2026-08',
    trips: 3,
    trucksDispatched: 2,
    routesUsed: 2,
    distanceKm: '500.0',
    revenue: '900000000',
    expenses: '300000000',
    profit: '600000000',
    marginBp: 6667,
    revenueChangeBp: null,
    profitChangeBp: null,
    ...over,
  }) as InsightInput['monthly'][number];

const route = (over: Partial<InsightInput['routes'][number]>) =>
  ({
    routeId: 'route-1',
    routeName: 'Toshkent-Samarqand',
    trips: 2,
    completedTrips: 2,
    distanceKm: '500.0',
    revenue: '900000000',
    expenses: '300000000',
    profit: '600000000',
    marginBp: 6667,
    profitPerTrip: null,
    profitPerKm: null,
    ...over,
  }) as InsightInput['routes'][number];

const vehicle = (over: Partial<InsightInput['vehicles'][number]>) =>
  ({
    vehicleId: 'v1',
    plateNumber: '01A111AA',
    trips: 2,
    distanceKm: '500.0',
    revenue: '900000000',
    expenses: '300000000',
    profit: '600000000',
    marginBp: 6667,
    profitPerKm: null,
    fuelLitres: '200.00',
    fuelCost: '300000000',
    consumption: '40.00',
    normConsumption: '30.00',
    deviationBp: 3333,
    ...over,
  }) as InsightInput['vehicles'][number];

const fuelRow = (over: Partial<InsightInput['fuel'][number]>) =>
  ({
    vehicleId: 'v1',
    plateNumber: '01A111AA',
    refuels: 2,
    litres: '200.00',
    cost: '300000000',
    distanceKm: '500.0',
    consumption: '40.00',
    normConsumption: '30.00',
    deviationBp: 3333,
    overNorm: true,
    ...over,
  }) as InsightInput['fuel'][number];

const base: InsightInput = {
  summary: summary(),
  monthly: [month({})],
  routes: [],
  vehicles: [],
  fuel: [],
};

const kinds = (input: InsightInput) => buildInsights(input).map((i) => i.kind);

describe('buildInsights', () => {
  it('says NO_DATA and nothing else when nothing ran', () => {
    const result = buildInsights({
      ...base,
      summary: summary({ trips: { total: 0, completed: 0, cancelled: 0, inProgress: 0 } }),
    });
    expect(result).toEqual([{ kind: 'NO_DATA', severity: 'info', params: {} }]);
  });

  it('reports a material revenue move and ignores a trivial one', () => {
    expect(kinds({ ...base, monthly: [month({ revenueChangeBp: 1800 })] })).toContain('REVENUE_UP');
    expect(kinds({ ...base, monthly: [month({ revenueChangeBp: -1800 })] })).toContain(
      'REVENUE_DOWN',
    );
    // 3 % month over month is noise, not news.
    expect(kinds({ ...base, monthly: [month({ revenueChangeBp: 300 })] })).not.toContain(
      'REVENUE_UP',
    );
  });

  it('formats the change as a percentage, not basis points', () => {
    const [insight] = buildInsights({ ...base, monthly: [month({ revenueChangeBp: 1800 })] });
    expect(insight!.params.change).toBe('18 %');
  });

  it('puts a loss-making period first, whatever else is on the card', () => {
    const result = kinds({
      ...base,
      summary: summary({ profit: '-200000000', marginBp: -2222 }),
      monthly: [month({ revenueChangeBp: 1800 })],
    });
    expect(result[0]).toBe('LOSS_PERIOD');
  });

  it('names the most profitable route and ignores the unassigned bucket', () => {
    const result = buildInsights({
      ...base,
      routes: [
        route({ routeId: null, routeName: 'UNASSIGNED', profit: '900000000' }),
        route({ routeId: 'r2', routeName: 'Toshkent-Buxoro', profit: '500000000' }),
      ],
    });
    const top = result.find((i) => i.kind === 'TOP_ROUTE');
    expect(top?.params.route).toBe('Toshkent-Buxoro');
  });

  it('flags a route that lost money', () => {
    const result = buildInsights({
      ...base,
      routes: [route({ routeId: 'r3', routeName: 'Loss lane', profit: '-100000000' })],
    });
    expect(result.find((i) => i.kind === 'LOSS_ROUTE')?.params.profit).toBe(
      `-1${NBSP}000${NBSP}000`,
    );
  });

  it('does not call a truck a heavy spender in a two-truck fleet', () => {
    // With two vehicles one of them is always "most of the expenses"; the
    // observation only means something once there is a fleet to compare with.
    const two = [vehicle({}), vehicle({ vehicleId: 'v2', plateNumber: '01B222BB' })];
    expect(kinds({ ...base, vehicles: two })).not.toContain('HIGH_EXPENSE_VEHICLE');

    const three = [...two, vehicle({ vehicleId: 'v3', plateNumber: '01C333CC', expenses: '0' })];
    expect(kinds({ ...base, vehicles: three })).toContain('HIGH_EXPENSE_VEHICLE');
  });

  it('flags one over-norm vehicle, not every one of them', () => {
    const result = buildInsights({
      ...base,
      fuel: [fuelRow({}), fuelRow({ vehicleId: 'v2', plateNumber: '01B222BB' })],
    });
    expect(result.filter((i) => i.kind === 'FUEL_ANOMALY')).toHaveLength(1);
  });

  it('renders the fuel figures with one decimal convention', () => {
    const [insight] = buildInsights({ ...base, fuel: [fuelRow({})] }).filter(
      (i) => i.kind === 'FUEL_ANOMALY',
    );
    expect(insight!.params).toMatchObject({
      plate: '01A111AA',
      deviation: '33 %',
      consumption: '40,00',
      norm: '30,00',
    });
  });

  it('says nothing about fuel when every truck is within its norm', () => {
    expect(kinds({ ...base, fuel: [fuelRow({ overNorm: false })] })).not.toContain('FUEL_ANOMALY');
  });
});
