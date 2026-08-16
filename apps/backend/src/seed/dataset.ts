/**
 * The pilot demo dataset (TZ §12.2).
 *
 * Kept apart from the seed runner so the numbers can be checked without a
 * database: the fuel figures, the trip prices and the salary rules are what
 * every screen shows on a first login, and a dataset that quietly stops making
 * sense makes the whole product look wrong.
 */

export const COMPANY_ID = 'seed-company-0000-0000-000000000001';

/** So'm → tiyin. Every amount below is written in so'm for readability. */
export const som = (value: number): bigint => BigInt(value) * 100n;

/** `days` ago at `hour` UTC — the dataset stays fresh whenever it is run. */
export function day(days: number, hour = 9): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

export const USERS = [
  { id: 'seed-user-owner', fullName: 'Jasur Karimov', email: 'boshliq@demo.uz', role: 'OWNER' },
  { id: 'seed-user-logist', fullName: 'Nodira Aliyeva', email: 'logist@demo.uz', role: 'LOGIST' },
  {
    id: 'seed-user-buxgalter',
    fullName: 'Shahnoza Rasulova',
    email: 'buxgalter@demo.uz',
    role: 'ACCOUNTANT',
  },
] as const;

export const VEHICLES = [
  {
    id: 'seed-vehicle-1',
    plateNumber: '01 A 123 AA',
    brand: 'MAN',
    model: 'TGX 18.440',
    year: 2019,
    fuelNormPer100km: '32.00',
    currentOdometer: 412_300,
    purchasePrice: som(900_000_000),
    plannedTotalKm: 1_000_000,
    nextServiceOdometer: 420_000,
  },
  {
    id: 'seed-vehicle-2',
    plateNumber: '01 B 456 BB',
    brand: 'Isuzu',
    model: 'FVR 34',
    year: 2021,
    fuelNormPer100km: '24.50',
    currentOdometer: 168_900,
    purchasePrice: som(520_000_000),
    plannedTotalKm: 800_000,
    nextServiceOdometer: 170_000,
  },
  {
    id: 'seed-vehicle-3',
    plateNumber: '01 C 789 CC',
    brand: 'KAMAZ',
    model: '5490',
    year: 2017,
    fuelNormPer100km: '35.00',
    currentOdometer: 601_400,
    purchasePrice: som(610_000_000),
    plannedTotalKm: 900_000,
    nextServiceOdometer: 605_000,
  },
] as const;

export const DRIVERS = [
  {
    id: 'seed-driver-1',
    fullName: 'Alisher Toshmatov',
    phone: '+998901112233',
    salaryType: 'PERCENT',
    salaryValue: 1000n, // 10% in basis points
    licenseExpiry: day(120),
  },
  {
    id: 'seed-driver-2',
    fullName: 'Bobur Ergashev',
    phone: '+998902223344',
    salaryType: 'PER_KM',
    salaryValue: som(800),
    licenseExpiry: day(12), // close enough to raise a document reminder
  },
  {
    id: 'seed-driver-3',
    fullName: 'Doniyor Sattorov',
    phone: '+998903334455',
    salaryType: 'FIXED',
    salaryValue: som(6_000_000),
    licenseExpiry: day(400),
  },
] as const;

export const CLIENTS = [
  { id: 'seed-client-1', name: 'Alfa Trans MChJ', paymentTerms: 14 },
  { id: 'seed-client-2', name: 'Bek Logistics', paymentTerms: 30 },
  { id: 'seed-client-3', name: 'Samarqand Tekstil', paymentTerms: 7 },
] as const;

export interface SeedTrip {
  id: string;
  tripNumber: string;
  clientId: string;
  vehicleId: string;
  driverId: string;
  cargoName: string;
  loading: [string, number, number];
  unloading: [string, number, number];
  distanceKm: string;
  price: bigint;
  advance: bigint;
  startedDaysAgo: number;
  finishedDaysAgo: number | null;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'ASSIGNED';
  /** Litres refuelled on this trip, so fuel control has something to compare. */
  litres?: string;
}

export const TRIPS: SeedTrip[] = [
  {
    id: 'seed-trip-1',
    tripNumber: 'R-001',
    clientId: 'seed-client-1',
    vehicleId: 'seed-vehicle-1',
    driverId: 'seed-driver-1',
    cargoName: 'Paxta tolasi',
    loading: ['Toshkent', 41.2995, 69.2401],
    unloading: ['Moskva', 55.7558, 37.6173],
    distanceKm: '3280.0',
    price: som(62_000_000),
    advance: som(8_000_000),
    startedDaysAgo: -26,
    finishedDaysAgo: -20,
    status: 'COMPLETED',
    litres: '1180.00', // 12% over the 32 l/100km norm — the fuel alert fires
  },
  {
    id: 'seed-trip-2',
    tripNumber: 'R-002',
    clientId: 'seed-client-2',
    vehicleId: 'seed-vehicle-2',
    driverId: 'seed-driver-2',
    cargoName: 'Qurilish materiallari',
    loading: ['Toshkent', 41.2995, 69.2401],
    unloading: ['Samarqand', 39.627, 66.975],
    distanceKm: '310.0',
    price: som(6_400_000),
    advance: som(1_000_000),
    startedDaysAgo: -18,
    finishedDaysAgo: -17,
    status: 'COMPLETED',
    litres: '77.00',
  },
  {
    id: 'seed-trip-3',
    tripNumber: 'R-003',
    clientId: 'seed-client-3',
    vehicleId: 'seed-vehicle-3',
    driverId: 'seed-driver-3',
    cargoName: 'Mato rulonlari',
    loading: ['Samarqand', 39.627, 66.975],
    unloading: ['Toshkent', 41.2995, 69.2401],
    distanceKm: '305.0',
    price: som(5_900_000),
    advance: 0n,
    startedDaysAgo: -12,
    finishedDaysAgo: -11,
    status: 'COMPLETED',
    litres: '109.00',
  },
  {
    id: 'seed-trip-4',
    tripNumber: 'R-004',
    clientId: 'seed-client-1',
    vehicleId: 'seed-vehicle-1',
    driverId: 'seed-driver-1',
    cargoName: 'Mevа konservasi',
    loading: ['Toshkent', 41.2995, 69.2401],
    unloading: ['Olmaota', 43.222, 76.8512],
    distanceKm: '960.0',
    price: som(18_500_000),
    advance: som(3_000_000),
    startedDaysAgo: -3,
    finishedDaysAgo: null,
    status: 'IN_PROGRESS',
  },
  {
    id: 'seed-trip-5',
    tripNumber: 'R-005',
    clientId: 'seed-client-2',
    vehicleId: 'seed-vehicle-2',
    driverId: 'seed-driver-2',
    cargoName: 'Uy jihozlari',
    loading: ['Toshkent', 41.2995, 69.2401],
    unloading: ['Buxoro', 39.7747, 64.4286],
    distanceKm: '580.0',
    price: som(9_200_000),
    advance: 0n,
    startedDaysAgo: 1,
    finishedDaysAgo: null,
    status: 'ASSIGNED',
  },
];

/**
 * Litres burnt against the vehicle norm on one trip, in basis points.
 * The seed uses it to keep the fuel-control screen honest: trip R-001 is meant
 * to sit clearly over the 7% threshold, and the rest clearly under it.
 */
export function fuelDeviationBp(trip: SeedTrip): number | null {
  if (!trip.litres) return null;
  const vehicle = VEHICLES.find((item) => item.id === trip.vehicleId);
  if (!vehicle) return null;
  const norm = (Number(trip.distanceKm) / 100) * Number(vehicle.fuelNormPer100km);
  return Math.round(((Number(trip.litres) - norm) / norm) * 10_000);
}
