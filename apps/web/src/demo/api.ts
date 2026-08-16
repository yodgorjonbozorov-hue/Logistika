/**
 * Offline API for the demo build. It answers the same paths the real backend
 * does, with the same `{ success, data, error, meta }` envelope, so the panel
 * runs unchanged — no component knows it is looking at fixtures.
 *
 * The money math mirrors the backend formulas (TZ §6) on the demo dataset, so
 * the dashboard, the trip P&L and the reports agree with each other.
 */
import i18n from '../shared/i18n';
import {
  demoAlerts,
  demoClients,
  demoDrivers,
  demoEvents,
  demoExpenses,
  demoExpiringDocuments,
  demoFuelLogs,
  demoIncomes,
  demoLive,
  demoServiceDue,
  demoTrips,
  demoCompany,
  demoSettings,
  demoUser,
  demoVehicles,
  iso,
} from './dataset';

type Json = Record<string, unknown>;

const store = {
  trips: [...demoTrips],
  vehicles: [...demoVehicles],
  drivers: [...demoDrivers],
  clients: [...demoClients],
  expenses: [...demoExpenses],
  incomes: [...demoIncomes],
  fuel: [...demoFuelLogs],
  alerts: [...demoAlerts],
};

// ---------- money helpers (BigInt tiyin, basis points) ----------

const big = (value: unknown): bigint => BigInt(String(value ?? '0'));

function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const quotient = (2n * a + b) / (2n * b);
  return negative ? -quotient : quotient;
}

const ratioBp = (part: bigint, whole: bigint): number | null =>
  whole === 0n ? null : Number(divRound(part * 10_000n, whole));

type DemoTrip = (typeof demoTrips)[number];

interface TripFinance {
  income: bigint;
  expensesTotal: bigint;
  byCategory: Record<string, bigint>;
  driverShare: bigint;
  depreciation: bigint;
  costTotal: bigint;
  profit: bigint;
  km: number;
}

/** Trip P&L — the same shape the finance module produces. */
function financeOf(trip: DemoTrip): TripFinance {
  const income = big(trip.agreedPrice);
  const km = Number(trip.actualDistanceKm ?? trip.plannedDistanceKm ?? 0);
  const byCategory: Record<string, bigint> = {};
  let expensesTotal = 0n;

  for (const expense of store.expenses.filter((e) => e.tripId === trip.id)) {
    if (expense.category === 'SALARY') continue;
    byCategory[expense.category] = (byCategory[expense.category] ?? 0n) + big(expense.amount);
    expensesTotal += big(expense.amount);
  }

  const driver = store.drivers.find((d) => d.id === trip.driverId);
  let driverShare = 0n;
  if (driver?.salaryType === 'PERCENT') {
    driverShare = divRound(income * big(driver.salaryValue), 10_000n);
  } else if (driver?.salaryType === 'PER_KM') {
    driverShare = big(driver.salaryValue) * BigInt(Math.round(km));
  }

  const vehicle = store.vehicles.find((v) => v.id === trip.vehicleId);
  const depreciation =
    vehicle?.purchasePrice && vehicle.plannedTotalKm
      ? divRound(
          big(vehicle.purchasePrice) * BigInt(Math.round(km * 10)),
          BigInt(vehicle.plannedTotalKm) * 10n,
        )
      : 0n;

  const costTotal = expensesTotal + driverShare + depreciation;
  return {
    income,
    expensesTotal,
    byCategory,
    driverShare,
    depreciation,
    costTotal,
    profit: income - costTotal,
    km,
  };
}

const completedTrips = () => store.trips.filter((trip) => trip.status === 'COMPLETED');

/** Company totals: trip accrual plus the expenses that belong to no trip. */
function summary() {
  const byCategory: Record<string, bigint> = {};
  let revenue = 0n;
  let tripCost = 0n;
  let km = 0;

  for (const trip of completedTrips()) {
    const finance = financeOf(trip);
    revenue += finance.income;
    tripCost += finance.costTotal;
    km += finance.km;
    for (const [category, amount] of Object.entries(finance.byCategory)) {
      byCategory[category] = (byCategory[category] ?? 0n) + amount;
    }
    if (finance.driverShare > 0n) {
      byCategory.SALARY = (byCategory.SALARY ?? 0n) + finance.driverShare;
    }
  }

  let overhead = 0n;
  for (const expense of store.expenses.filter((e) => !e.tripId)) {
    overhead += big(expense.amount);
    byCategory[expense.category] = (byCategory[expense.category] ?? 0n) + big(expense.amount);
  }

  const cost = tripCost + overhead;
  const profit = revenue - cost;
  return {
    from: iso(-30, 0),
    to: iso(0, 23),
    revenue: String(revenue),
    tripCost: String(tripCost),
    overhead: String(overhead),
    cost: String(cost),
    profit: String(profit),
    marginBp: ratioBp(profit, revenue),
    tripCount: completedTrips().length,
    distanceKm: km.toFixed(1),
    costPerKm: km === 0 ? null : String(divRound(cost, BigInt(Math.round(km)))),
    expensesByCategory: Object.fromEntries(
      Object.entries(byCategory).map(([key, value]) => [key, String(value)]),
    ),
  };
}

function fleetEconomics() {
  return store.vehicles
    .filter((vehicle) => vehicle.type !== 'TRAILER')
    .map((vehicle) => {
      let revenue = 0n;
      let cost = 0n;
      let depreciation = 0n;
      let km = 0;
      let tripCount = 0;

      for (const trip of completedTrips().filter((t) => t.vehicleId === vehicle.id)) {
        const finance = financeOf(trip);
        revenue += finance.income;
        cost += finance.costTotal;
        depreciation += finance.depreciation;
        km += finance.km;
        tripCount += 1;
      }
      for (const expense of store.expenses.filter((e) => !e.tripId && e.vehicleId === vehicle.id)) {
        cost += big(expense.amount);
      }

      return {
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        tripCount,
        distanceKm: km === 0 ? null : km.toFixed(1),
        revenue: String(revenue),
        cost: String(cost),
        profit: String(revenue - cost),
        depreciation: String(depreciation),
        costPerKm: km === 0 ? null : String(divRound(cost, BigInt(Math.round(km)))),
        roiBp: ratioBp(revenue - cost, cost),
      };
    });
}

/** W-8: norm vs actual per vehicle over the whole demo period. */
function fuelControl() {
  return store.vehicles
    .filter((vehicle) => vehicle.type !== 'TRAILER')
    .map((vehicle) => {
      const km = completedTrips()
        .filter((trip) => trip.vehicleId === vehicle.id)
        .reduce((sum, trip) => sum + Number(trip.actualDistanceKm ?? 0), 0);
      const logs = store.fuel.filter((log) => log.vehicleId === vehicle.id);
      const litres = logs.reduce((sum, log) => sum + Number(log.liters), 0);
      const amount = logs.reduce((sum, log) => sum + Number(big(log.totalAmount ?? '0')), 0);
      const norm = vehicle.fuelNormPer100km ? (km / 100) * Number(vehicle.fuelNormPer100km) : 0;
      const deviation = litres - norm;
      const avgPrice = litres > 0 ? Math.round(amount / litres) : null;

      return {
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        normPer100km: vehicle.fuelNormPer100km,
        distanceKm: km === 0 ? null : km.toFixed(1),
        normLitres: norm.toFixed(2),
        actualLitres: litres.toFixed(2),
        deviationLitres: deviation.toFixed(2),
        deviationBp: norm === 0 ? null : Math.round((deviation / norm) * 10_000),
        avgPricePerLitre: avgPrice === null ? null : String(avgPrice),
        lossTiyin: avgPrice === null ? null : String(Math.round(deviation * avgPrice)),
        refuelCount: logs.length,
        exceedsThreshold: norm > 0 && deviation / norm > 0.07,
      };
    });
}

function fuelStations() {
  const control = fuelControl();
  const byStation = new Map<
    string,
    { refuelCount: number; litres: number; amount: number; overrun: number }
  >();

  for (const log of store.fuel) {
    const name = log.stationName?.trim() || '—';
    const row = byStation.get(name) ?? { refuelCount: 0, litres: 0, amount: 0, overrun: 0 };
    const litres = Number(log.liters);
    row.refuelCount += 1;
    row.litres += litres;
    row.amount += Number(big(log.totalAmount ?? '0'));

    const vehicle = control.find((v) => v.vehicleId === log.vehicleId);
    const vehicleOverrun = Number(vehicle?.deviationLitres ?? 0);
    const vehicleLitres = Number(vehicle?.actualLitres ?? 0);
    if (vehicleOverrun > 0 && vehicleLitres > 0) {
      row.overrun += (vehicleOverrun * litres) / vehicleLitres;
    }
    byStation.set(name, row);
  }

  return [...byStation.entries()]
    .map(([stationName, row]) => ({
      stationName,
      refuelCount: row.refuelCount,
      litres: row.litres.toFixed(2),
      totalAmount: String(Math.round(row.amount)),
      avgPricePerLitre: row.litres > 0 ? String(Math.round(row.amount / row.litres)) : null,
      attributedOverrunLitres: row.overrun.toFixed(2),
    }))
    .sort((a, b) => Number(b.totalAmount) - Number(a.totalAmount));
}

function dashboard() {
  const active = store.trips.filter((trip) => trip.status === 'IN_PROGRESS');
  const today = iso(0, 0).slice(0, 10);
  return {
    vehiclesOnRoad: new Set(active.map((trip) => trip.vehicleId)).size,
    vehiclesTotal: store.vehicles.filter((vehicle) => vehicle.type !== 'TRAILER').length,
    tripsToday: store.trips.filter((trip) => trip.createdAt.slice(0, 10) === today).length,
    month: summary(),
    unreadAlerts: store.alerts.filter((alert) => !alert.isRead).length,
    recentEvents: [...demoEvents]
      .sort((a, b) => (a.eventTime < b.eventTime ? 1 : -1))
      .slice(0, 10)
      .map((event) => ({
        id: event.id,
        eventType: event.eventType,
        eventTime: event.eventTime,
        address: event.address,
        driverName: store.drivers.find((d) => d.id === event.driverId)?.fullName ?? null,
        tripNumber: store.trips.find((t) => t.id === event.tripId)?.tripNumber ?? null,
      })),
    profitTrend: profitTrend(),
  };
}

/** Twelve months ending on the current one, which carries the real demo total. */
function profitTrend() {
  const totals = summary();
  const now = new Date();
  const shape = [0.42, 0.55, 0.38, 0.61, 0.72, -0.18, 0.64, 0.81, 0.58, 0.77, 0.86, 1];

  return shape.map((factor, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - index), 1));
    const revenue = divRound(
      big(totals.revenue) * BigInt(Math.round(Math.abs(factor) * 100)),
      100n,
    );
    const profit = divRound(big(totals.profit) * BigInt(Math.round(factor * 100)), 100n);
    return {
      month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
      revenue: String(revenue),
      cost: String(revenue - profit),
      profit: String(profit),
    };
  });
}

function receivables() {
  const byClient = new Map<string, { pending: bigint; overdue: bigint; oldest: string }>();
  for (const item of store.incomes.filter((i) => i.status !== 'PAID')) {
    const key = item.clientId ?? '—';
    const row = byClient.get(key) ?? { pending: 0n, overdue: 0n, oldest: item.createdAt };
    if (item.status === 'OVERDUE') row.overdue += big(item.amount);
    else row.pending += big(item.amount);
    if (item.createdAt < row.oldest) row.oldest = item.createdAt;
    byClient.set(key, row);
  }
  return [...byClient.entries()]
    .map(([clientId, row]) => ({
      clientId,
      clientName: store.clients.find((c) => c.id === clientId)?.name ?? null,
      pending: String(row.pending),
      overdue: String(row.overdue),
      total: String(row.pending + row.overdue),
      oldestDate: row.oldest,
    }))
    .sort((a, b) => Number(big(b.total) - big(a.total)));
}

// ---------- W-9 reports ----------

type Cell = string | number | null;
interface ReportTable {
  key: string;
  titleKey: string;
  columns: Array<{ key: string; labelKey: string; type: string }>;
  rows: Array<Record<string, Cell>>;
  totals?: Record<string, Cell>;
}

const column = (key: string, labelKey: string, type: string) => ({ key, labelKey, type });

/** W-6 rating on the demo dataset — the same shape the backend produces. */
function driverRatings() {
  return store.drivers
    .map((driver) => {
      const trips = completedTrips().filter((trip) => trip.driverId === driver.id);
      const lateTrips = trips.filter(
        (trip) => trip.unloadingDate && trip.finishedAt && trip.finishedAt > trip.unloadingDate,
      ).length;
      const breakdowns = demoEvents.filter(
        (event) => event.driverId === driver.id && event.eventType === 'BREAKDOWN',
      ).length;
      const lateShareBp = trips.length === 0 ? 0 : Math.round((lateTrips * 10_000) / trips.length);
      const breakdownRateBp =
        trips.length === 0 ? 0 : Math.round((breakdowns * 10_000) / trips.length);
      const penalties = {
        lateness: Math.min(150, Math.round((lateShareBp * 150) / 10_000)),
        fuel: 0,
        breakdowns: Math.min(150, Math.round((breakdownRateBp * 150) / 2_000)),
      };
      const scored = 500 - penalties.lateness - penalties.fuel - penalties.breakdowns;

      return {
        driverId: driver.id,
        driverName: driver.fullName,
        trips: trips.length,
        lateTrips,
        breakdowns,
        fuelDeviationBp: null,
        ratingCentis: trips.length < 3 ? null : Math.max(100, scored),
        penalties,
        lateShareBp,
        breakdownRateBp,
      };
    })
    .sort((a, b) => (b.ratingCentis ?? -1) - (a.ratingCentis ?? -1));
}

function reportTable(key: string): ReportTable {
  const trips = completedTrips();

  if (key === 'vehicles') {
    const fleet = fleetEconomics();
    const revenue = fleet.reduce((sum, row) => sum + big(row.revenue), 0n);
    const cost = fleet.reduce((sum, row) => sum + big(row.cost), 0n);
    return {
      key,
      titleKey: 'reports.vehicles.title',
      columns: [
        column('plateNumber', 'reports.column.vehicle', 'text'),
        column('tripCount', 'reports.column.trips', 'number'),
        column('distanceKm', 'reports.column.distance', 'km'),
        column('revenue', 'reports.column.revenue', 'money'),
        column('cost', 'reports.column.cost', 'money'),
        column('profit', 'reports.column.profit', 'money'),
        column('costPerKm', 'reports.column.costPerKm', 'money'),
        column('roiBp', 'reports.column.roi', 'percent'),
      ],
      rows: fleet.map((row) => ({
        ...row,
        distanceKm: row.distanceKm ? Number(row.distanceKm) : null,
      })),
      totals: {
        plateNumber: 'Σ',
        revenue: String(revenue),
        cost: String(cost),
        profit: String(revenue - cost),
        roiBp: ratioBp(revenue - cost, cost),
      },
    };
  }

  if (key === 'routes' || key === 'drivers' || key === 'clients') {
    return groupedReport(key, trips);
  }

  if (key === 'expenses') {
    const totals = summary();
    const entries = Object.entries(totals.expensesByCategory);
    const total = entries.reduce((sum, [, amount]) => sum + big(amount), 0n);
    return {
      key,
      titleKey: 'reports.expenses.title',
      columns: [
        column('category', 'reports.column.category', 'text'),
        column('amount', 'reports.column.amount', 'money'),
        column('shareBp', 'reports.column.share', 'percent'),
      ],
      rows: entries
        .map(([category, amount]) => ({
          category,
          amount,
          shareBp: ratioBp(big(amount), total),
        }))
        .sort((a, b) => Number(big(b.amount) - big(a.amount))),
      totals: { category: 'Σ', amount: String(total), shareBp: 10_000 },
    };
  }

  // trips
  let revenue = 0n;
  let cost = 0n;
  const rows = trips.map((trip) => {
    const finance = financeOf(trip);
    revenue += finance.income;
    cost += finance.costTotal;
    return {
      tripNumber: trip.tripNumber,
      date: trip.finishedAt,
      client: trip.client?.name ?? null,
      vehicle: trip.vehicle?.plateNumber ?? null,
      driver: trip.driver?.fullName ?? null,
      route: `${trip.loadingAddress} → ${trip.unloadingAddress}`,
      distanceKm: finance.km,
      revenue: String(finance.income),
      cost: String(finance.costTotal),
      profit: String(finance.profit),
      marginBp: ratioBp(finance.profit, finance.income),
    };
  });

  return {
    key: 'trips',
    titleKey: 'reports.trips.title',
    columns: [
      column('tripNumber', 'reports.column.tripNumber', 'text'),
      column('date', 'reports.column.date', 'date'),
      column('client', 'reports.column.client', 'text'),
      column('vehicle', 'reports.column.vehicle', 'text'),
      column('driver', 'reports.column.driver', 'text'),
      column('route', 'reports.column.route', 'text'),
      column('distanceKm', 'reports.column.distance', 'km'),
      column('revenue', 'reports.column.revenue', 'money'),
      column('cost', 'reports.column.cost', 'money'),
      column('profit', 'reports.column.profit', 'money'),
      column('marginBp', 'reports.column.margin', 'percent'),
    ],
    rows,
    totals: {
      tripNumber: 'Σ',
      revenue: String(revenue),
      cost: String(cost),
      profit: String(revenue - cost),
      marginBp: ratioBp(revenue - cost, revenue),
    },
  };
}

function groupedReport(key: string, trips: DemoTrip[]): ReportTable {
  const groups = new Map<
    string,
    { label: string; tripCount: number; km: number; revenue: bigint; profit: bigint; share: bigint }
  >();

  for (const trip of trips) {
    const finance = financeOf(trip);
    const label =
      key === 'routes'
        ? `${trip.loadingAddress} → ${trip.unloadingAddress}`
        : key === 'drivers'
          ? (trip.driver?.fullName ?? '—')
          : (trip.client?.name ?? '—');
    const groupKey = key === 'clients' ? (trip.clientId ?? '—') : label;
    const row = groups.get(groupKey) ?? {
      label,
      tripCount: 0,
      km: 0,
      revenue: 0n,
      profit: 0n,
      share: 0n,
    };
    row.tripCount += 1;
    row.km += finance.km;
    row.revenue += finance.income;
    row.profit += finance.profit;
    row.share += finance.driverShare;
    groups.set(groupKey, row);
  }

  const debts = new Map(receivables().map((row) => [row.clientId, row.total]));

  if (key === 'routes') {
    return {
      key,
      titleKey: 'reports.routes.title',
      columns: [
        column('route', 'reports.column.route', 'text'),
        column('tripCount', 'reports.column.trips', 'number'),
        column('distanceKm', 'reports.column.distance', 'km'),
        column('revenue', 'reports.column.revenue', 'money'),
        column('cost', 'reports.column.cost', 'money'),
        column('profit', 'reports.column.profit', 'money'),
        column('profitPerKm', 'reports.column.profitPerKm', 'money'),
        column('marginBp', 'reports.column.margin', 'percent'),
      ],
      rows: [...groups.values()]
        .map((row) => ({
          route: row.label,
          tripCount: row.tripCount,
          distanceKm: row.km,
          revenue: String(row.revenue),
          cost: String(row.revenue - row.profit),
          profit: String(row.profit),
          profitPerKm: row.km ? String(divRound(row.profit, BigInt(Math.round(row.km)))) : null,
          marginBp: ratioBp(row.profit, row.revenue),
        }))
        .sort((a, b) => Number(big(b.profit) - big(a.profit))),
    };
  }

  if (key === 'drivers') {
    return {
      key,
      titleKey: 'reports.drivers.title',
      columns: [
        column('driver', 'reports.column.driver', 'text'),
        column('tripCount', 'reports.column.trips', 'number'),
        column('distanceKm', 'reports.column.distance', 'km'),
        column('revenue', 'reports.column.revenue', 'money'),
        column('driverShare', 'reports.column.driverShare', 'money'),
        column('profit', 'reports.column.profit', 'money'),
      ],
      rows: [...groups.values()].map((row) => ({
        driver: row.label,
        tripCount: row.tripCount,
        distanceKm: row.km,
        revenue: String(row.revenue),
        driverShare: String(row.share),
        profit: String(row.profit),
      })),
    };
  }

  return {
    key: 'clients',
    titleKey: 'reports.clients.title',
    columns: [
      column('client', 'reports.column.client', 'text'),
      column('tripCount', 'reports.column.trips', 'number'),
      column('revenue', 'reports.column.revenue', 'money'),
      column('profit', 'reports.column.profit', 'money'),
      column('debt', 'reports.column.debt', 'money'),
    ],
    rows: [...groups.entries()].map(([groupKey, row]) => ({
      client: row.label,
      tripCount: row.tripCount,
      revenue: String(row.revenue),
      profit: String(row.profit),
      debt: debts.get(groupKey) ?? '0',
    })),
  };
}

/** The export endpoint returns a file, so the demo builds the same CSV. */
export function reportCsv(key: string): string {
  const table = reportTable(key);
  const cell = (value: Cell, type: string): string => {
    if (value === null || value === undefined) return '';
    if (type === 'money') return (Number(value) / 100).toFixed(2);
    if (type === 'percent') return (Number(value) / 100).toFixed(2);
    if (type === 'date') return String(value).slice(0, 10);
    return String(value);
  };
  const lines = [table.columns.map((c) => i18n.t(c.labelKey)).join(';')];
  for (const row of table.rows) {
    lines.push(table.columns.map((c) => cell(row[c.key] ?? null, c.type)).join(';'));
  }
  if (table.totals) {
    lines.push(table.columns.map((c) => cell(table.totals?.[c.key] ?? null, c.type)).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// ---------- routing ----------

const page = <T>(items: T[], query: URLSearchParams) => {
  const limit = Number(query.get('limit') ?? 20);
  const current = Number(query.get('page') ?? 1);
  return {
    data: items.slice((current - 1) * limit, current * limit),
    meta: { pagination: { page: current, limit, total: items.length } },
  };
};

const LIST_RESOURCES: Record<string, keyof typeof store> = {
  trips: 'trips',
  vehicles: 'vehicles',
  drivers: 'drivers',
  clients: 'clients',
  expenses: 'expenses',
  incomes: 'incomes',
  fuel: 'fuel',
};

export interface DemoResult {
  data: unknown;
  meta?: Json | null;
}

/** Resolves one API call against the fixtures. Returns null when unmatched. */
export function resolve(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Json,
): DemoResult | null {
  const parts = path.replace(/^\/+/, '').split('/');
  const [head, second, third] = parts;

  if (path === '/auth/me') return { data: demoUser };

  // W-11 settings. The demo accepts a save and echoes it back so the form
  // behaves; nothing persists past a reload, and nothing pretends to.
  if (path === '/company') {
    if (method === 'PATCH') Object.assign(demoCompany, body);
    return { data: demoCompany };
  }
  if (path === '/company/settings') {
    if (method === 'PATCH') {
      const { monthlyLimitUsd, ...rest } = body as { monthlyLimitUsd?: number };
      Object.assign(demoSettings, rest);
      if (monthlyLimitUsd !== undefined) {
        demoSettings.monthlyLimitMicroUsd = String(BigInt(monthlyLimitUsd) * 1_000_000n);
      }
    }
    return { data: demoSettings };
  }
  // No bot in a static demo, so the Telegram card hides itself.
  if (path === '/notifications/telegram') return { data: { linked: false, available: false } };
  // Nothing has run the nightly scan in a static demo, so there is nothing
  // to show — better an empty card than invented anomalies.
  if (path === '/ai/insights') return { data: [] };
  if (path === '/drivers/ratings') return { data: driverRatings() };
  // The demo has no backend and no API key, so AI is off: the receipt-scan
  // button hides itself rather than pretending to read a photo.
  if (path === '/ai/status') {
    return {
      data: {
        available: false,
        configured: false,
        month: new Date().toISOString().slice(0, 7),
        usedMicroUsd: '0',
        limitMicroUsd: '50000000',
      },
    };
  }
  if (path === '/auth/login') return { data: { accessToken: 'demo', refreshToken: 'demo' } };
  if (path === '/auth/logout') return { data: {} };

  if (head === 'reports') {
    if (second === 'dashboard') return { data: dashboard() };
    if (second === 'trend') return { data: profitTrend() };
    if (second) return { data: reportTable(second) };
  }

  if (head === 'finance') {
    if (second === 'summary') return { data: summary() };
    if (second === 'receivables') return { data: receivables() };
    if (second === 'vehicles') return { data: fleetEconomics() };
    if (second === 'trips' && third) {
      const trip = store.trips.find((t) => t.id === third);
      if (!trip) return null;
      const finance = financeOf(trip);
      return {
        data: {
          tripId: trip.id,
          tripNumber: trip.tripNumber,
          income: String(finance.income),
          expensesByCategory: Object.fromEntries(
            Object.entries(finance.byCategory).map(([k, v]) => [k, String(v)]),
          ),
          expensesTotal: String(finance.expensesTotal),
          driverShare: String(finance.driverShare),
          depreciation: String(finance.depreciation),
          costTotal: String(finance.costTotal),
          profit: String(finance.profit),
          marginBp: ratioBp(finance.profit, finance.income),
          profitPerKm: finance.km
            ? String(divRound(finance.profit, BigInt(Math.round(finance.km))))
            : null,
          distanceKm: finance.km ? finance.km.toFixed(1) : null,
        },
      };
    }
  }

  if (head === 'fuel' && second === 'control') return { data: fuelControl() };
  if (head === 'fuel' && second === 'stations') return { data: fuelStations() };
  if (head === 'tracking' && second === 'live') return { data: demoLive };
  if (head === 'tracking' && second === 'vehicles') return { data: [] };
  if (head === 'documents' && second === 'expiring') return { data: demoExpiringDocuments };
  if (head === 'maintenance' && second === 'due') return { data: demoServiceDue };
  if (head === 'events') {
    return { data: demoEvents.filter((e) => e.tripId === query.get('tripId')) };
  }

  if (head === 'alerts') {
    if (method === 'POST' && second === 'read-all') {
      store.alerts = store.alerts.map((alert) => ({ ...alert, isRead: true }));
      return { data: { updated: store.alerts.length } };
    }
    if (method === 'POST' && third === 'read') {
      store.alerts = store.alerts.map((alert) =>
        alert.id === second ? { ...alert, isRead: true } : alert,
      );
      return { data: { updated: 1 } };
    }
    const unreadOnly = query.get('unreadOnly') === 'true';
    const list = unreadOnly ? store.alerts.filter((alert) => !alert.isRead) : store.alerts;
    const paged = page(list, query);
    return {
      data: paged.data,
      meta: { ...paged.meta, unread: store.alerts.filter((a) => !a.isRead).length },
    };
  }

  if (head === 'trips' && second && method === 'GET' && !third) {
    const trip = store.trips.find((t) => t.id === second);
    return trip ? { data: trip } : null;
  }
  if (head === 'trips' && second && method === 'POST' && third) {
    if (third === 'share-link') {
      return { data: { url: `${window.location.origin}/track/demo-token`, expiresAt: iso(7, 0) } };
    }
    const statuses: Record<string, string> = {
      assign: 'ASSIGNED',
      start: 'IN_PROGRESS',
      complete: 'COMPLETED',
      cancel: 'CANCELLED',
    };
    store.trips = store.trips.map((trip) =>
      trip.id === second ? { ...trip, status: statuses[third] ?? trip.status } : trip,
    );
    return { data: store.trips.find((t) => t.id === second) };
  }

  const resource = LIST_RESOURCES[head ?? ''];
  if (resource) {
    if (method === 'GET') {
      let items = store[resource] as Json[];
      const tripId = query.get('tripId');
      if (tripId) items = items.filter((item) => item.tripId === tripId);
      const status = query.get('status');
      if (status) items = items.filter((item) => item.status === status);
      const paged = page(items, query);
      return { data: paged.data, meta: paged.meta };
    }
    if (method === 'POST' && !second) {
      // New rows land at the top so the demo reacts to what you just typed.
      const created = { id: `demo-${Date.now()}`, createdAt: new Date().toISOString(), ...body };
      (store[resource] as Json[]).unshift(created);
      return { data: created };
    }
    if (method === 'PATCH' && second) {
      const items = store[resource] as Json[];
      const index = items.findIndex((item) => item.id === second);
      if (index >= 0) items[index] = { ...items[index], ...body };
      return { data: items[index] ?? body };
    }
    if (method === 'DELETE' && second) {
      (store as Record<string, Json[]>)[resource] = (store[resource] as Json[]).filter(
        (item) => item.id !== second,
      );
      return { data: { deleted: true } };
    }
  }

  return null;
}
