/**
 * The dashboard renders what the API sends and nothing else.
 *
 * The point of these cases is not that React draws a table — it is that no
 * number is recomputed on the way to the screen. The fixtures below are the
 * exact payloads the backend's finance-core e2e suite asserts, so if the page
 * ever starts summing rows in the browser, the figures here stop matching.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../shared/i18n';

/** Labels are asserted through i18n, so a renamed key fails here too. */
const label = (key: string): string => i18n.t(key);

const apiMock = vi.fn();
vi.mock('../../shared/api/client', () => ({
  api: (path: string, options?: unknown) => apiMock(path, options),
}));

const { DashboardPage } = await import('./DashboardPage');

const SUMMARY = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-09-01T00:00:00.000Z',
  revenue: '2300000000',
  invoiced: '0',
  received: '0',
  outstanding: '0',
  expenses: '760000000',
  fuelCost: '700000000',
  profit: '1540000000',
  marginBp: 6696,
  trips: { total: 4, completed: 3, cancelled: 0, inProgress: 1 },
  trucksDispatched: 2,
  routesUsed: 2,
  distanceKm: '1300.5',
  fuelLitres: '410.50',
  costPerKm: '584391',
  revenuePerKm: '1768551',
  profitPerKm: '1184160',
  profitPerTrip: '385000000',
  expensesByCategory: [
    { category: 'FUEL', amount: '700000000', shareBp: 9211 },
    { category: 'REPAIR', amount: '40000000', shareBp: 526 },
  ],
};

const ROUTES = [
  {
    routeId: 'route-1',
    routeName: 'Toshkent-Samarqand',
    trips: 2,
    completedTrips: 2,
    distanceKm: '1000.0',
    revenue: '1700000000',
    expenses: '570000000',
    profit: '1130000000',
    marginBp: 6647,
    profitPerTrip: '565000000',
    profitPerKm: '1130000',
  },
  {
    routeId: null,
    routeName: 'UNASSIGNED',
    trips: 1,
    completedTrips: 0,
    distanceKm: '0.0',
    revenue: '100000000',
    expenses: '0',
    profit: '100000000',
    marginBp: 10_000,
    profitPerTrip: '100000000',
    profitPerKm: null,
  },
];

const VEHICLES = [
  {
    vehicleId: 'vehicle-1',
    plateNumber: '01A123AA',
    trips: 2,
    distanceKm: '1000.0',
    revenue: '1700000000',
    expenses: '610000000',
    profit: '1090000000',
    marginBp: 6412,
    profitPerKm: '1090000',
    fuelLitres: '310.00',
    fuelCost: '550000000',
    consumption: '31.00',
    normConsumption: '30.00',
    deviationBp: 333,
  },
];

const FUEL = [
  {
    vehicleId: 'vehicle-1',
    plateNumber: '01A123AA',
    refuels: 2,
    litres: '310.00',
    cost: '550000000',
    distanceKm: '1000.0',
    consumption: '31.00',
    normConsumption: '30.00',
    deviationBp: 333,
    overNorm: false,
  },
  {
    vehicleId: 'vehicle-2',
    plateNumber: '01B456BB',
    refuels: 1,
    litres: '100.50',
    cost: '150000000',
    distanceKm: '300.5',
    consumption: '33.44',
    normConsumption: '25.00',
    deviationBp: 3376,
    overNorm: true,
  },
];

const MONTHLY = [
  {
    month: '2026-07',
    trips: 1,
    trucksDispatched: 1,
    routesUsed: 1,
    distanceKm: '400.0',
    revenue: '1000000000',
    expenses: '400000000',
    profit: '600000000',
    marginBp: 6000,
    revenueChangeBp: null,
    profitChangeBp: null,
  },
  {
    month: '2026-08',
    trips: 4,
    trucksDispatched: 2,
    routesUsed: 2,
    distanceKm: '1300.5',
    revenue: '2300000000',
    expenses: '760000000',
    profit: '1540000000',
    marginBp: 6696,
    revenueChangeBp: 13_000,
    profitChangeBp: 15_667,
  },
];

const TRIPS = [
  {
    tripId: 'trip-1',
    tripNumber: 'T-0001',
    status: 'COMPLETED',
    periodAt: '2026-08-10T12:00:00.000Z',
    routeId: 'route-1',
    routeName: 'Toshkent-Samarqand',
    vehicleId: 'vehicle-1',
    plateNumber: '01A123AA',
    driverName: 'Test Driver',
    clientName: 'Payer LLC',
    distanceKm: '500.0',
    revenue: '900000000',
    expenses: '320000000',
    fuelCost: '300000000',
    profit: '580000000',
    marginBp: 6444,
    profitPerKm: '1160000',
  },
];

function routeApi(path: string) {
  if (path === '/finance/summary') return Promise.resolve({ data: SUMMARY, meta: null });
  if (path === '/finance/routes') return Promise.resolve({ data: ROUTES, meta: null });
  if (path === '/finance/vehicles') return Promise.resolve({ data: VEHICLES, meta: null });
  if (path === '/finance/fuel') return Promise.resolve({ data: FUEL, meta: null });
  if (path === '/finance/monthly') return Promise.resolve({ data: MONTHLY, meta: null });
  if (path === '/finance/trips') {
    return Promise.resolve({ data: TRIPS, meta: { pagination: { page: 1, limit: 20, total: 1 } } });
  }
  throw new Error(`Unexpected request: ${path}`);
}

/** The KPI strip; several of its figures legitimately repeat in the tables. */
async function findKpis(): Promise<HTMLElement> {
  const revenueLabel = await screen.findByText(label('dashboard.revenue'), { selector: 'div' });
  return revenueLabel.closest('div.grid') as HTMLElement;
}

function renderPage(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/**
 * The formatters group with a non-breaking space, but Testing Library
 * normalises whitespace in the DOM before matching — so the queries below use
 * ordinary spaces on purpose.
 */
describe('DashboardPage', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => routeApi(path));
  });

  it('shows the headline figures exactly as the API sent them', async () => {
    renderPage(<DashboardPage />);
    const kpis = await findKpis();

    // 2 300 000 000 tiyin is 23 000 000 so'm — not 2 300 000 000, and not
    // rounded to the nearest thousand.
    expect(within(kpis).getByText('23 000 000')).toBeDefined();
    expect(within(kpis).getByText('7 600 000')).toBeDefined();
    expect(within(kpis).getByText('15 400 000')).toBeDefined();
    // The margin comes from the server's basis points, not a division here.
    expect(within(kpis).getByText(/67,0 %/)).toBeDefined();
    // Profit per trip: 1 540 000 000 / 4, computed server-side.
    expect(within(kpis).getByText('3 850 000')).toBeDefined();
  });

  it('shows the operational counters', async () => {
    renderPage(<DashboardPage />);
    const kpis = await findKpis();

    expect(within(kpis).getByText(label('dashboard.trucksDispatched'))).toBeDefined();
    expect(within(kpis).getByText(label('dashboard.routesUsed'))).toBeDefined();
    // Distance and volume keep the precision the server sent.
    expect(within(kpis).getByText('1 300,5 km')).toBeDefined();
    expect(within(kpis).getByText('410,50 l')).toBeDefined();
    expect(within(kpis).getByText('4')).toBeDefined(); // trips
    expect(within(kpis).getAllByText('2').length).toBe(2); // trucks, routes
  });

  it('labels a trip with no route rather than hiding it', async () => {
    renderPage(<DashboardPage />);
    // The API's UNASSIGNED sentinel becomes a translated label, and the row
    // keeps its money rather than being dropped from the table.
    const cell = await screen.findByText(label('dashboard.unassignedRoute'));
    const row = cell.closest('tr')!;
    expect(within(row).getAllByText('1 000 000').length).toBeGreaterThan(0);
    expect(screen.queryByText('UNASSIGNED')).toBeNull();
  });

  it('flags only the vehicle burning past its norm', async () => {
    renderPage(<DashboardPage />);
    await findKpis();

    const overNormRow = screen.getByText('01B456BB').closest('tr')!;
    expect(within(overNormRow).getByText(/33,44/)).toBeDefined();
    expect(within(overNormRow).getByText(/\+33,8 %/)).toBeDefined();

    // 3,33 % over the norm is under the 7 % alert line, so no badge.
    const withinNormRows = screen.getAllByText('01A123AA').map((el) => el.closest('tr')!);
    for (const row of withinNormRows) {
      expect(within(row).queryByText(label('dashboard.overNorm'))).toBeNull();
    }
  });

  it('renders the month-over-month change from the API, signed', async () => {
    renderPage(<DashboardPage />);
    expect(await screen.findByText('+130 %')).toBeDefined();
    // The first month of the series has nothing to compare against.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('asks the API for exactly one calendar month by default', async () => {
    renderPage(<DashboardPage />);
    await findKpis();

    const summaryCall = apiMock.mock.calls.find((call) => call[0] === '/finance/summary');
    const query = (summaryCall![1] as { query: { from: string; to: string } }).query;
    expect(query.from).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(query.to).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(new Date(query.to).getTime()).toBeGreaterThan(new Date(query.from).getTime());
  });

  it('surfaces an API failure instead of rendering zeroes', async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === '/finance/summary') return Promise.reject(new Error('Boom'));
      return routeApi(path);
    });
    renderPage(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('Boom')).toBeDefined());
    expect(screen.queryByText('23 000 000')).toBeNull();
  });
});
