/**
 * Demo dataset for the offline preview build (`pnpm build:demo`).
 *
 * It exists so the panel can be shown without a backend — during a sales demo,
 * a design review or a link someone opens on a phone. It never ships with the
 * production entry point, and nothing here is used by the real app.
 *
 * Money is tiyin as decimal strings, exactly as the API sends it; ratios are
 * basis points. The numbers are internally consistent: the dashboard totals are
 * the sum of the trips below, so the screens agree with each other.
 */

const som = (value: number): string => String(BigInt(value) * 100n);

export const DEMO_COMPANY = "Yo'lbars Logistika";

export const demoCompany = {
  id: 'c1',
  name: DEMO_COMPANY,
  inn: '301234567',
  address: "Toshkent sh., Yunusobod t., Amir Temur ko'chasi 108",
  phone: '+998 71 200 40 40',
  locale: 'uz-latn',
  timezone: 'Asia/Tashkent',
  tariffPlan: 'STANDARD',
  subscriptionUntil: null,
};

/** W-11 defaults, i.e. exactly what the backend falls back to (TZ §8.10). */
export const demoSettings = {
  fuelDeviationThresholdBp: 700,
  idleAlertHours: 2,
  routeDeviationKm: 20,
  digestTime: '20:00',
  voiceEnabled: true,
  ocrEnabled: true,
  chatEnabled: true,
  anomalyEnabled: true,
  monthlyLimitMicroUsd: '50000000',
  currentUsageMicroUsd: '0',
  usageMonth: '',
};

export const demoUser = {
  id: 'u1',
  companyId: 'c1',
  fullName: 'Jasur Karimov',
  phone: '+998901234567',
  email: 'boshliq@yolbars.uz',
  role: 'OWNER',
  isActive: true,
  lastLogin: iso(-2, 8),
};

/** ISO timestamp `days` ago at `hour` UTC — keeps the demo looking fresh. */
function iso(days: number, hour = 9, minute = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

export const demoVehicles = [
  {
    id: 'v1',
    plateNumber: '01 A 123 AA',
    type: 'TRUCK',
    brand: 'MAN',
    model: 'TGX 18.440',
    year: 2019,
    vin: 'WMA06XZZ7KM123456',
    fuelType: 'diesel',
    fuelNormPer100km: '32.00',
    tankCapacity: '700.00',
    currentOdometer: 486_200,
    purchasePrice: som(900_000_000),
    plannedTotalKm: 1_000_000,
    insuranceExpiry: iso(9, 0),
    techInspectionExpiry: iso(120, 0),
    nextServiceOdometer: 487_000,
    isActive: true,
  },
  {
    id: 'v2',
    plateNumber: '01 B 456 BB',
    type: 'TRUCK',
    brand: 'Isuzu',
    model: 'Forward 18',
    year: 2021,
    vin: 'JAANPR75L07100321',
    fuelType: 'diesel',
    fuelNormPer100km: '24.50',
    tankCapacity: '400.00',
    currentOdometer: 212_450,
    purchasePrice: som(520_000_000),
    plannedTotalKm: 900_000,
    insuranceExpiry: iso(240, 0),
    techInspectionExpiry: iso(-3, 0),
    nextServiceOdometer: 220_000,
    isActive: true,
  },
  {
    id: 'v3',
    plateNumber: '01 C 789 CC',
    type: 'TRUCK',
    brand: 'KAMAZ',
    model: '65207',
    year: 2017,
    vin: 'XTC652070H1234567',
    fuelType: 'diesel',
    fuelNormPer100km: '36.00',
    tankCapacity: '500.00',
    currentOdometer: 604_800,
    purchasePrice: som(410_000_000),
    plannedTotalKm: 1_200_000,
    insuranceExpiry: iso(64, 0),
    techInspectionExpiry: iso(31, 0),
    nextServiceOdometer: 610_000,
    isActive: true,
  },
  {
    id: 'v4',
    plateNumber: '01 T 555 TT',
    type: 'TRAILER',
    brand: 'Schmitz',
    model: 'SCS 24',
    year: 2018,
    vin: null,
    fuelType: null,
    fuelNormPer100km: null,
    tankCapacity: null,
    currentOdometer: null,
    purchasePrice: null,
    plannedTotalKm: null,
    insuranceExpiry: iso(150, 0),
    techInspectionExpiry: null,
    nextServiceOdometer: null,
    isActive: true,
  },
];

export const demoDrivers = [
  {
    id: 'd1',
    fullName: 'Alisher Abdullayev',
    phone: '+998901112233',
    birthDate: '1987-04-12T00:00:00.000Z',
    passport: 'AA1234567',
    licenseNumber: 'AD9876543',
    licenseExpiry: iso(-5, 0),
    hireDate: '2021-03-01T00:00:00.000Z',
    salaryType: 'PERCENT',
    salaryValue: '1000',
    rating: '4.60',
    isActive: true,
  },
  {
    id: 'd2',
    fullName: 'Bekzod Rahimov',
    phone: '+998902223344',
    birthDate: '1992-09-30T00:00:00.000Z',
    passport: 'AB7654321',
    licenseNumber: 'AD1122334',
    licenseExpiry: iso(400, 0),
    hireDate: '2022-07-15T00:00:00.000Z',
    salaryType: 'PER_KM',
    salaryValue: som(800),
    rating: '4.90',
    isActive: true,
  },
  {
    id: 'd3',
    fullName: 'Sardor Yusupov',
    phone: '+998903334455',
    birthDate: '1984-01-18T00:00:00.000Z',
    passport: 'AC1112223',
    licenseNumber: 'AD5566778',
    licenseExpiry: iso(220, 0),
    hireDate: '2020-02-10T00:00:00.000Z',
    salaryType: 'FIXED',
    salaryValue: som(6_000_000),
    rating: '4.20',
    isActive: true,
  },
];

export const demoClients = [
  {
    id: 'cl1',
    name: 'Oq Yo‘l Savdo MChJ',
    inn: '301234567',
    contactPerson: 'Dilshod Ergashev',
    phone: '+998712001020',
    email: 'logistika@oqyol.uz',
    address: 'Toshkent, Yunusobod',
    paymentTermsDays: 14,
    balance: som(-18_000_000),
  },
  {
    id: 'cl2',
    name: 'UzTex Group',
    inn: '302345678',
    contactPerson: 'Nodira Sattorova',
    phone: '+998712003040',
    email: 'export@uztex.uz',
    address: 'Toshkent, Chilonzor',
    paymentTermsDays: 30,
    balance: som(0),
  },
  {
    id: 'cl3',
    name: 'Alfa Import',
    inn: '303456789',
    contactPerson: 'Rustam Nazarov',
    phone: '+998712005060',
    email: 'info@alfaimport.uz',
    address: 'Samarqand',
    paymentTermsDays: 7,
    balance: som(-7_500_000),
  },
];

interface DemoTripSeed {
  id: string;
  tripNumber: string;
  clientId: string;
  vehicleId: string;
  driverId: string;
  cargoName: string;
  from: string;
  to: string;
  km: number;
  price: number;
  status: string;
  daysAgo: number;
}

const TRIP_SEEDS: DemoTripSeed[] = [
  {
    id: 't1',
    tripNumber: '128',
    clientId: 'cl1',
    vehicleId: 'v1',
    driverId: 'd1',
    cargoName: 'Paxta tolasi, 18 t',
    from: 'Toshkent',
    to: 'Moskva',
    km: 3_280,
    price: 62_000_000,
    status: 'COMPLETED',
    daysAgo: 12,
  },
  {
    id: 't2',
    tripNumber: '129',
    clientId: 'cl2',
    vehicleId: 'v2',
    driverId: 'd2',
    cargoName: 'Trikotaj mahsulot, 12 t',
    from: 'Toshkent',
    to: 'Almaty',
    km: 940,
    price: 21_000_000,
    status: 'COMPLETED',
    daysAgo: 9,
  },
  {
    id: 't3',
    tripNumber: '130',
    clientId: 'cl3',
    vehicleId: 'v3',
    driverId: 'd3',
    cargoName: 'Qurilish materiali, 22 t',
    from: 'Samarqand',
    to: 'Toshkent',
    km: 310,
    price: 6_400_000,
    status: 'COMPLETED',
    daysAgo: 6,
  },
  {
    id: 't4',
    tripNumber: '131',
    clientId: 'cl1',
    vehicleId: 'v1',
    driverId: 'd1',
    cargoName: 'Konserva, 16 t',
    from: 'Toshkent',
    to: 'Moskva',
    km: 3_280,
    price: 58_000_000,
    status: 'IN_PROGRESS',
    daysAgo: 2,
  },
  {
    id: 't5',
    tripNumber: '132',
    clientId: 'cl2',
    vehicleId: 'v2',
    driverId: 'd2',
    cargoName: 'Mato rulonlari, 10 t',
    from: 'Toshkent',
    to: 'Bishkek',
    km: 680,
    price: 15_500_000,
    status: 'IN_PROGRESS',
    daysAgo: 1,
  },
  {
    id: 't6',
    tripNumber: '133',
    clientId: 'cl3',
    vehicleId: 'v3',
    driverId: 'd3',
    cargoName: 'Sement, 24 t',
    from: 'Navoiy',
    to: 'Farg‘ona',
    km: 520,
    price: 9_200_000,
    status: 'ASSIGNED',
    daysAgo: 0,
  },
];

const CITY_POINTS: Record<string, [number, number]> = {
  Toshkent: [41.31, 69.28],
  Moskva: [55.75, 37.62],
  Almaty: [43.24, 76.89],
  Samarqand: [39.65, 66.96],
  Bishkek: [42.87, 74.59],
  Navoiy: [40.1, 65.37],
  'Farg‘ona': [40.39, 71.78],
};

export const demoTrips = TRIP_SEEDS.map((seed) => {
  const client = demoClients.find((c) => c.id === seed.clientId);
  const vehicle = demoVehicles.find((v) => v.id === seed.vehicleId);
  const driver = demoDrivers.find((d) => d.id === seed.driverId);
  const [loadingLat, loadingLng] = CITY_POINTS[seed.from] ?? [41.31, 69.28];
  const [unloadingLat, unloadingLng] = CITY_POINTS[seed.to] ?? [41.31, 69.28];
  const completed = seed.status === 'COMPLETED';

  return {
    id: seed.id,
    tripNumber: seed.tripNumber,
    clientId: seed.clientId,
    vehicleId: seed.vehicleId,
    trailerId: seed.km > 900 ? 'v4' : null,
    driverId: seed.driverId,
    cargoName: seed.cargoName,
    cargoWeight: '18.00',
    cargoVolume: null,
    loadingAddress: seed.from,
    loadingLat,
    loadingLng,
    loadingDate: iso(-seed.daysAgo - 1, 7),
    unloadingAddress: seed.to,
    unloadingLat,
    unloadingLng,
    unloadingDate: completed ? iso(-seed.daysAgo, 16) : null,
    plannedDistanceKm: `${seed.km}.0`,
    actualDistanceKm: completed ? `${seed.km}.0` : null,
    agreedPrice: som(seed.price),
    currency: 'UZS',
    driverAdvance: som(Math.round(seed.price * 0.08)),
    status: seed.status,
    startOdometer: null,
    endOdometer: null,
    startedAt: seed.status === 'ASSIGNED' ? null : iso(-seed.daysAgo - 1, 8),
    finishedAt: completed ? iso(-seed.daysAgo, 16) : null,
    createdAt: seed.daysAgo === 0 ? iso(0, 8) : iso(-seed.daysAgo - 2, 10),
    client: client ?? null,
    vehicle: vehicle ?? null,
    driver: driver ?? null,
    trailer: null,
    /** Not part of the API shape — the demo router uses it to build the P&L. */
    _seed: seed,
  };
});

export const demoExpenses = [
  expense('e1', 't1', 'v1', 'FUEL', 24_431_000, 'Uzbekneftgaz + Lukoil, 1 186 l', 11, true),
  expense('e2', 't1', 'v1', 'TOLL', 3_200_000, "Yo'l boji (RF)", 11, true),
  expense('e3', 't1', 'v1', 'CUSTOMS', 4_100_000, 'Bojxona rasmiylashtiruvi', 12, true),
  expense('e4', 't2', 'v2', 'FUEL', 5_270_000, 'AZS Sardor, 244 l', 9, true),
  expense('e5', 't2', 'v2', 'PARKING', 350_000, 'Chegara avtoturargoh', 8, true),
  expense('e6', 't3', 'v3', 'FUEL', 2_675_000, 'AZS Neft-Trans, 128 l', 6, true),
  expense('e7', 't3', 'v3', 'FINE', 600_000, 'Ortiqcha yuk shtrafi', 5, false),
  expense(
    'e8',
    't4',
    'v1',
    'FUEL',
    21_800_000,
    'AZS Neft-Trans, 1 040 l (reys tugamagan)',
    2,
    false,
  ),
  expense('e9', null, 'v2', 'REPAIR', 5_400_000, 'Tormoz kolodkalari almashtirildi', 4, true),
  expense('e10', null, null, 'TAX', 12_000_000, 'Oylik soliq', 3, true),
  expense('e11', null, null, 'INSURANCE', 3_800_000, 'Avtopark sug‘urtasi', 15, true),
];

function expense(
  id: string,
  tripId: string | null,
  vehicleId: string | null,
  category: string,
  amount: number,
  description: string,
  daysAgo: number,
  isApproved: boolean,
) {
  return {
    id,
    tripId,
    vehicleId,
    driverId: null,
    category,
    amount: som(amount),
    currency: 'UZS',
    quantity: null,
    unitPrice: null,
    description,
    paymentMethod: 'cash',
    expenseDate: iso(-daysAgo, 12),
    isApproved,
  };
}

export const demoIncomes = [
  income('i1', 't1', 'cl1', 62_000_000, 'PAID', 'INV-128', 10),
  income('i2', 't2', 'cl2', 21_000_000, 'PAID', 'INV-129', 7),
  income('i3', 't3', 'cl3', 6_400_000, 'OVERDUE', 'INV-130', 5),
  income('i4', 't4', 'cl1', 58_000_000, 'PENDING', 'INV-131', 1),
];

function income(
  id: string,
  tripId: string,
  clientId: string,
  amount: number,
  status: string,
  invoiceNumber: string,
  daysAgo: number,
) {
  return {
    id,
    tripId,
    clientId,
    amount: som(amount),
    currency: 'UZS',
    paymentDate: status === 'PAID' ? iso(-daysAgo, 11) : null,
    paymentMethod: 'bank',
    invoiceNumber,
    status,
    createdAt: iso(-daysAgo - 2, 9),
    client: demoClients.find((c) => c.id === clientId) ?? null,
  };
}

export const demoFuelLogs = [
  fuelLog('f1', 'v1', 't1', 950, 20_500, 'Uzbekneftgaz', 12),
  fuelLog('f2', 'v1', 't1', 236, 21_000, 'Lukoil (RF)', 11),
  fuelLog('f3', 'v2', 't2', 244, 21_600, 'AZS Sardor', 9),
  fuelLog('f4', 'v3', 't3', 128, 20_900, 'Neft-Trans', 6),
];

function fuelLog(
  id: string,
  vehicleId: string,
  tripId: string | null,
  liters: number,
  pricePerLiterSom: number,
  stationName: string,
  daysAgo: number,
) {
  const price = som(pricePerLiterSom);
  return {
    id,
    vehicleId,
    tripId,
    driverId: null,
    liters: liters.toFixed(2),
    pricePerLiter: price,
    totalAmount: String(BigInt(price) * BigInt(liters)),
    stationName,
    odometer: null,
    lat: null,
    lng: null,
    refuelTime: iso(-daysAgo, 13),
  };
}

export const demoEvents = [
  event('ev1', 't4', 'd1', 'START', 2, 8, 'Toshkent, bazadan chiqdi'),
  event('ev2', 't4', 'd1', 'LOADED', 2, 11, 'Toshkent, Sergeli ombori'),
  event('ev3', 't4', 'd1', 'CUSTOMS', 1, 6, "Qozog'iston chegarasi"),
  event('ev4', 't4', 'd1', 'REFUEL', 1, 14, 'AZS Neft-Trans'),
  event('ev5', 't5', 'd2', 'START', 1, 7, "Toshkent, Yangi Yo'l"),
  event('ev6', 't5', 'd2', 'REST', 0, 5, 'Chimkent yo‘lida'),
  event('ev7', 't5', 'd2', 'RESUME', 0, 7, 'Chimkent'),
  event('ev8', 't4', 'd1', 'BREAKDOWN', 0, 9, 'Jizzax, radiator qizidi'),
];

function event(
  id: string,
  tripId: string,
  driverId: string,
  eventType: string,
  daysAgo: number,
  hour: number,
  address: string,
) {
  return {
    id,
    tripId,
    driverId,
    eventType,
    eventTime: iso(-daysAgo, hour),
    lat: 41.0 + Math.random() * 0,
    lng: 69.0,
    address,
    odometer: null,
    comment: null,
    photoUrls: null,
  };
}

/** Live positions for the W-2 map — roughly along the real corridors. */
export const demoLive = [
  {
    vehicleId: 'v1',
    plateNumber: '01 A 123 AA',
    status: 'BREAKDOWN',
    trip: { id: 't4', tripNumber: '131', cargoName: 'Konserva, 16 t' },
    driverName: 'Alisher Abdullayev',
    lastPosition: { lat: 40.12, lng: 67.84, speed: 0, recordedAt: iso(0, 9, 20) },
    deviationKm: 2.4,
  },
  {
    vehicleId: 'v2',
    plateNumber: '01 B 456 BB',
    status: 'MOVING',
    trip: { id: 't5', tripNumber: '132', cargoName: 'Mato rulonlari, 10 t' },
    driverName: 'Bekzod Rahimov',
    lastPosition: { lat: 42.32, lng: 69.6, speed: 74, recordedAt: iso(0, 9, 25) },
    deviationKm: 0.8,
  },
  {
    vehicleId: 'v3',
    plateNumber: '01 C 789 CC',
    status: 'IDLE',
    trip: null,
    driverName: null,
    lastPosition: { lat: 41.29, lng: 69.24, speed: 0, recordedAt: iso(0, 8, 5) },
    deviationKm: null,
  },
];

export const demoAlerts = [
  alert('a1', 'FUEL_OVERRUN', 'alerts.fuelOverrun', 'Vehicle', 'v1', 0, {
    plate: '01 A 123 AA',
    litres: '136.40',
    percent: '13.0',
    days: 30,
  }),
  alert('a2', 'DOCUMENT_EXPIRING', 'alerts.documentExpired', 'Document', 'vehicle:v2', 1, {
    owner: '01 B 456 BB',
    docType: 'TECH_INSPECTION',
    daysLeft: 0,
    date: iso(-3, 0).slice(0, 10),
  }),
  alert('a3', 'DOCUMENT_EXPIRING', 'alerts.documentExpiring', 'Document', 'driver:d1', 1, {
    owner: 'Alisher Abdullayev',
    docType: 'DRIVER_LICENSE',
    daysLeft: 7,
    date: iso(-5, 0).slice(0, 10),
  }),
  alert('a4', 'MAINTENANCE_DUE', 'alerts.serviceDue', 'Vehicle', 'v1', 2, {
    plate: '01 A 123 AA',
    km: 800,
    odometer: 487_000,
  }),
  alert('a5', 'PAYMENT_OVERDUE', 'alerts.documentExpiring', 'Income', 'i3', 3, {
    owner: 'Alfa Import',
    docType: 'INVOICE',
    daysLeft: 0,
    date: iso(-5, 0).slice(0, 10),
  }),
];

function alert(
  id: string,
  type: string,
  keyBase: string,
  relatedType: string,
  relatedId: string,
  daysAgo: number,
  params: Record<string, string | number>,
) {
  return {
    id,
    type,
    title: `${keyBase}.title`,
    message: JSON.stringify({ key: `${keyBase}.message`, params }),
    relatedType,
    relatedId,
    isRead: false,
    createdAt: iso(-daysAgo, 6),
  };
}

export const demoExpiringDocuments = [
  {
    id: 'doc-v2-tech',
    ownerType: 'VEHICLE',
    ownerId: 'v2',
    ownerLabel: '01 B 456 BB',
    docType: 'TECH_INSPECTION',
    docNumber: null,
    expiryDate: iso(-3, 0),
    daysLeft: -3,
  },
  {
    id: 'doc-d1-license',
    ownerType: 'DRIVER',
    ownerId: 'd1',
    ownerLabel: 'Alisher Abdullayev',
    docType: 'DRIVER_LICENSE',
    docNumber: 'AD9876543',
    expiryDate: iso(-5, 0),
    daysLeft: -5,
  },
  {
    id: 'doc-v1-ins',
    ownerType: 'VEHICLE',
    ownerId: 'v1',
    ownerLabel: '01 A 123 AA',
    docType: 'INSURANCE',
    docNumber: 'SUG-2024-118',
    expiryDate: iso(9, 0),
    daysLeft: 9,
  },
];

export const demoServiceDue = [
  {
    vehicleId: 'v1',
    plateNumber: '01 A 123 AA',
    currentOdometer: 486_200,
    nextServiceOdometer: 487_000,
    kmLeft: 800,
    isOverdue: false,
    lastServiceDate: iso(-95, 0),
  },
  {
    vehicleId: 'v3',
    plateNumber: '01 C 789 CC',
    currentOdometer: 604_800,
    nextServiceOdometer: 604_000,
    kmLeft: -800,
    isOverdue: true,
    lastServiceDate: iso(-140, 0),
  },
];

export { iso, som };
