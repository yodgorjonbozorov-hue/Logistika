// Demo mode (VITE_DEMO=1): the whole API is served from this in-memory
// dataset so the app can be shown as a static page without a backend.
// Money stays tiyin-strings, exactly like the real wire format.
import type { ApiResponse } from 'shared';
import type { RequestOptions } from './client';

const now = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (t: number) => new Date(t).toISOString();
/** so'm → tiyin string */
const som = (value: number) => String(Math.round(value) * 100);

const user = {
  id: 'u1',
  companyId: 'c1',
  fullName: 'Baxtiyor Ergashev',
  phone: '+998901234567',
  email: 'demo@truckcontrol.uz',
  role: 'OWNER',
  isActive: true,
  lastLogin: iso(now - HOUR),
};

const vehicles = [
  {
    id: 'v1',
    plateNumber: '01 A 123 AA',
    type: 'TRUCK',
    brand: 'MAN',
    model: 'TGX',
    year: 2019,
    vin: null,
    fuelType: 'dizel',
    fuelNormPer100km: '32',
    tankCapacity: '800',
    currentOdometer: 412300,
    purchasePrice: som(800_000_000),
    plannedTotalKm: 1_000_000,
    insuranceExpiry: iso(now + 12 * DAY),
    techInspectionExpiry: iso(now + 88 * DAY),
    nextServiceOdometer: 420000,
    isActive: true,
  },
  {
    id: 'v2',
    plateNumber: '01 B 456 BB',
    type: 'TRUCK',
    brand: 'Volvo',
    model: 'FH',
    year: 2021,
    vin: null,
    fuelType: 'dizel',
    fuelNormPer100km: '30',
    tankCapacity: '900',
    currentOdometer: 287100,
    purchasePrice: som(1_100_000_000),
    plannedTotalKm: 1_200_000,
    insuranceExpiry: iso(now + 140 * DAY),
    techInspectionExpiry: iso(now + 40 * DAY),
    nextServiceOdometer: 295000,
    isActive: true,
  },
  {
    id: 'v3',
    plateNumber: '01 C 789 CC',
    type: 'TRUCK',
    brand: 'Isuzu',
    model: 'Giga',
    year: 2018,
    vin: null,
    fuelType: 'dizel',
    fuelNormPer100km: '28',
    tankCapacity: '600',
    currentOdometer: 501200,
    purchasePrice: som(600_000_000),
    plannedTotalKm: 900_000,
    insuranceExpiry: iso(now + 200 * DAY),
    techInspectionExpiry: iso(now + 6 * DAY),
    nextServiceOdometer: 501900,
    isActive: true,
  },
  {
    id: 'v4',
    plateNumber: '01 D 321 DD',
    type: 'TRUCK',
    brand: 'KamAZ',
    model: '54901',
    year: 2022,
    vin: null,
    fuelType: 'dizel',
    fuelNormPer100km: '33',
    tankCapacity: '700',
    currentOdometer: 98000,
    purchasePrice: som(950_000_000),
    plannedTotalKm: 1_000_000,
    insuranceExpiry: iso(now + 300 * DAY),
    techInspectionExpiry: iso(now + 250 * DAY),
    nextServiceOdometer: 110000,
    isActive: true,
  },
  {
    id: 'v5',
    plateNumber: '01 E 654 EE',
    type: 'TRAILER',
    brand: 'Schmitz',
    model: 'SKO',
    year: 2020,
    vin: null,
    fuelType: null,
    fuelNormPer100km: null,
    tankCapacity: null,
    currentOdometer: null,
    purchasePrice: null,
    plannedTotalKm: null,
    insuranceExpiry: null,
    techInspectionExpiry: null,
    nextServiceOdometer: null,
    isActive: true,
  },
];

const drivers = [
  {
    id: 'd1',
    fullName: 'Alisher Abdullayev',
    phone: '+998901112233',
    birthDate: null,
    passport: null,
    licenseNumber: 'AF1234567',
    licenseExpiry: iso(now + 400 * DAY),
    hireDate: iso(now - 700 * DAY),
    salaryType: 'PERCENT',
    salaryValue: '1000',
    rating: '4.60',
    isActive: true,
  },
  {
    id: 'd2',
    fullName: 'Sherzod Karimov',
    phone: '+998902223344',
    birthDate: null,
    passport: null,
    licenseNumber: 'AF7654321',
    licenseExpiry: iso(now + 13 * DAY),
    hireDate: iso(now - 400 * DAY),
    salaryType: 'PER_KM',
    salaryValue: '150000',
    rating: '4.20',
    isActive: true,
  },
  {
    id: 'd3',
    fullName: 'Botir Raxmonov',
    phone: '+998903334455',
    birthDate: null,
    passport: null,
    licenseNumber: 'AF1112223',
    licenseExpiry: iso(now + 900 * DAY),
    hireDate: iso(now - 900 * DAY),
    salaryType: 'FIXED',
    salaryValue: som(8_000_000),
    rating: '4.90',
    isActive: true,
  },
  {
    id: 'd4',
    fullName: "Jasur To'rayev",
    phone: '+998904445566',
    birthDate: null,
    passport: null,
    licenseNumber: 'AF9998887',
    licenseExpiry: iso(now + 250 * DAY),
    hireDate: iso(now - 150 * DAY),
    salaryType: 'PERCENT',
    salaryValue: '800',
    rating: '4.40',
    isActive: true,
  },
];

const clients = [
  {
    id: 'k1',
    name: 'Uztrans Logistics',
    inn: '301234567',
    contactPerson: 'Dilshod aka',
    phone: '+998712001122',
    email: null,
    address: 'Toshkent',
    paymentTermsDays: 15,
    balance: '0',
  },
  {
    id: 'k2',
    name: 'Orient Cargo',
    inn: '305556677',
    contactPerson: 'Malika opa',
    phone: '+998712334455',
    email: null,
    address: 'Toshkent',
    paymentTermsDays: 30,
    balance: '0',
  },
  {
    id: 'k3',
    name: 'Samarqand Agro',
    inn: '204445566',
    contactPerson: 'Olim aka',
    phone: '+998662221133',
    email: null,
    address: 'Samarqand',
    paymentTermsDays: 10,
    balance: '0',
  },
];

const trips = [
  {
    id: 't1',
    tripNumber: 'T-2026-0142',
    clientId: 'k1',
    vehicleId: 'v1',
    trailerId: 'v5',
    driverId: 'd1',
    cargoName: 'Maishiy texnika',
    cargoWeight: '18.5',
    cargoVolume: null,
    loadingAddress: 'Toshkent',
    loadingDate: iso(now - 9 * DAY),
    unloadingAddress: 'Moskva',
    unloadingDate: iso(now - 4 * DAY),
    plannedDistanceKm: '3400',
    actualDistanceKm: '3412',
    agreedPrice: som(48_000_000),
    currency: 'UZS',
    driverAdvance: som(3_000_000),
    status: 'COMPLETED',
    startOdometer: 408800,
    endOdometer: 412212,
    startedAt: iso(now - 9 * DAY),
    finishedAt: iso(now - 4 * DAY),
    createdAt: iso(now - 10 * DAY),
  },
  {
    id: 't2',
    tripNumber: 'T-2026-0143',
    clientId: 'k2',
    vehicleId: 'v2',
    trailerId: null,
    driverId: 'd2',
    cargoName: 'Paxta tolasi',
    cargoWeight: '20',
    cargoVolume: null,
    loadingAddress: 'Buxoro',
    loadingDate: iso(now - 2 * DAY),
    unloadingAddress: 'Novosibirsk',
    unloadingDate: iso(now + 3 * DAY),
    plannedDistanceKm: '2980',
    actualDistanceKm: null,
    agreedPrice: som(52_000_000),
    currency: 'UZS',
    driverAdvance: som(4_000_000),
    status: 'IN_PROGRESS',
    startOdometer: 285100,
    endOdometer: null,
    startedAt: iso(now - 2 * DAY),
    finishedAt: null,
    createdAt: iso(now - 3 * DAY),
  },
  {
    id: 't3',
    tripNumber: 'T-2026-0144',
    clientId: 'k3',
    vehicleId: 'v3',
    trailerId: null,
    driverId: 'd3',
    cargoName: 'Meva-sabzavot',
    cargoWeight: '12',
    cargoVolume: null,
    loadingAddress: 'Samarqand',
    loadingDate: iso(now - 8 * HOUR),
    unloadingAddress: 'Toshkent',
    unloadingDate: iso(now + 10 * HOUR),
    plannedDistanceKm: '310',
    actualDistanceKm: null,
    agreedPrice: som(6_500_000),
    currency: 'UZS',
    driverAdvance: '0',
    status: 'IN_PROGRESS',
    startOdometer: 500890,
    endOdometer: null,
    startedAt: iso(now - 8 * HOUR),
    finishedAt: null,
    createdAt: iso(now - DAY),
  },
  {
    id: 't4',
    tripNumber: 'T-2026-0145',
    clientId: 'k1',
    vehicleId: 'v4',
    trailerId: null,
    driverId: 'd4',
    cargoName: 'Qurilish materiallari',
    cargoWeight: '22',
    cargoVolume: null,
    loadingAddress: 'Toshkent',
    loadingDate: iso(now + DAY),
    unloadingAddress: 'Andijon',
    unloadingDate: iso(now + 2 * DAY),
    plannedDistanceKm: '360',
    actualDistanceKm: null,
    agreedPrice: som(7_200_000),
    currency: 'UZS',
    driverAdvance: '0',
    status: 'ASSIGNED',
    startOdometer: null,
    endOdometer: null,
    startedAt: null,
    finishedAt: null,
    createdAt: iso(now - 5 * HOUR),
  },
  {
    id: 't5',
    tripNumber: 'T-2026-0139',
    clientId: 'k2',
    vehicleId: 'v1',
    trailerId: 'v5',
    driverId: 'd1',
    cargoName: 'Elektronika',
    cargoWeight: '15',
    cargoVolume: null,
    loadingAddress: 'Toshkent',
    loadingDate: iso(now - 24 * DAY),
    unloadingAddress: 'Olmaota',
    unloadingDate: iso(now - 22 * DAY),
    plannedDistanceKm: '780',
    actualDistanceKm: '792',
    agreedPrice: som(14_000_000),
    currency: 'UZS',
    driverAdvance: som(1_000_000),
    status: 'COMPLETED',
    startOdometer: 407900,
    endOdometer: 408692,
    startedAt: iso(now - 24 * DAY),
    finishedAt: iso(now - 22 * DAY),
    createdAt: iso(now - 25 * DAY),
  },
  {
    id: 't6',
    tripNumber: 'T-2026-0138',
    clientId: 'k3',
    vehicleId: 'v3',
    trailerId: null,
    driverId: 'd3',
    cargoName: 'Un',
    cargoWeight: '19',
    cargoVolume: null,
    loadingAddress: 'Qarshi',
    loadingDate: iso(now - 28 * DAY),
    unloadingAddress: 'Toshkent',
    unloadingDate: iso(now - 27 * DAY),
    plannedDistanceKm: '520',
    actualDistanceKm: '531',
    agreedPrice: som(8_800_000),
    currency: 'UZS',
    driverAdvance: '0',
    status: 'COMPLETED',
    startOdometer: 499800,
    endOdometer: 500331,
    startedAt: iso(now - 28 * DAY),
    finishedAt: iso(now - 27 * DAY),
    createdAt: iso(now - 29 * DAY),
  },
  {
    id: 't7',
    tripNumber: 'T-2026-0146',
    clientId: 'k1',
    vehicleId: null,
    trailerId: null,
    driverId: null,
    cargoName: 'Tekstil',
    cargoWeight: '16',
    cargoVolume: null,
    loadingAddress: 'Namangan',
    loadingDate: iso(now + 3 * DAY),
    unloadingAddress: 'Qozon',
    unloadingDate: iso(now + 8 * DAY),
    plannedDistanceKm: '2650',
    actualDistanceKm: null,
    agreedPrice: som(44_000_000),
    currency: 'UZS',
    driverAdvance: '0',
    status: 'DRAFT',
    startOdometer: null,
    endOdometer: null,
    startedAt: null,
    finishedAt: null,
    createdAt: iso(now - 2 * HOUR),
  },
];

const expenses = [
  {
    id: 'e1',
    tripId: 't1',
    vehicleId: 'v1',
    driverId: 'd1',
    category: 'FUEL',
    amount: som(14_200_000),
    currency: 'UZS',
    quantity: '1420',
    unitPrice: som(10_000),
    description: 'Dizel, 4 ta quyish',
    paymentMethod: 'cash',
    expenseDate: iso(now - 6 * DAY),
    isApproved: true,
  },
  {
    id: 'e2',
    tripId: 't1',
    vehicleId: 'v1',
    driverId: 'd1',
    category: 'TOLL',
    amount: som(4_150_000),
    currency: 'UZS',
    quantity: null,
    unitPrice: null,
    description: "Yo'l bojlari (RF)",
    paymentMethod: 'card',
    expenseDate: iso(now - 6 * DAY),
    isApproved: true,
  },
  {
    id: 'e3',
    tripId: 't1',
    vehicleId: 'v1',
    driverId: 'd1',
    category: 'CUSTOMS',
    amount: som(2_700_000),
    currency: 'UZS',
    quantity: null,
    unitPrice: null,
    description: 'Bojxona rasmiylashtiruvi',
    paymentMethod: 'transfer',
    expenseDate: iso(now - 8 * DAY),
    isApproved: true,
  },
  {
    id: 'e4',
    tripId: 't2',
    vehicleId: 'v2',
    driverId: 'd2',
    category: 'FUEL',
    amount: som(6_300_000),
    currency: 'UZS',
    quantity: '620',
    unitPrice: som(10_160),
    description: 'Dizel',
    paymentMethod: 'cash',
    expenseDate: iso(now - DAY),
    isApproved: false,
  },
  {
    id: 'e5',
    tripId: null,
    vehicleId: 'v3',
    driverId: null,
    category: 'REPAIR',
    amount: som(3_800_000),
    currency: 'UZS',
    quantity: null,
    unitPrice: null,
    description: 'Tormoz kolodkalari',
    paymentMethod: 'transfer',
    expenseDate: iso(now - 12 * DAY),
    isApproved: true,
  },
  {
    id: 'e6',
    tripId: 't3',
    vehicleId: 'v3',
    driverId: 'd3',
    category: 'PARKING',
    amount: som(150_000),
    currency: 'UZS',
    quantity: null,
    unitPrice: null,
    description: 'Tungi turargoh',
    paymentMethod: 'cash',
    expenseDate: iso(now - 5 * HOUR),
    isApproved: false,
  },
];

const incomes = [
  {
    id: 'i1',
    tripId: 't1',
    clientId: 'k1',
    amount: som(30_000_000),
    currency: 'UZS',
    paymentDate: iso(now - 3 * DAY),
    paymentMethod: 'transfer',
    invoiceNumber: 'INV-0142',
    status: 'PARTIAL',
    createdAt: iso(now - 3 * DAY),
  },
  {
    id: 'i2',
    tripId: 't5',
    clientId: 'k2',
    amount: som(14_000_000),
    currency: 'UZS',
    paymentDate: iso(now - 20 * DAY),
    paymentMethod: 'transfer',
    invoiceNumber: 'INV-0139',
    status: 'PAID',
    createdAt: iso(now - 20 * DAY),
  },
  {
    id: 'i3',
    tripId: 't6',
    clientId: 'k3',
    amount: som(8_800_000),
    currency: 'UZS',
    paymentDate: null,
    paymentMethod: null,
    invoiceNumber: 'INV-0138',
    status: 'OVERDUE',
    createdAt: iso(now - 27 * DAY),
  },
];

const fuelLogs = [
  {
    id: 'f1',
    tripId: 't1',
    vehicleId: 'v1',
    driverId: 'd1',
    liters: '452',
    pricePerLiter: som(10_000),
    totalAmount: som(4_520_000),
    stationName: 'Lukoil',
    odometer: 410100,
    receiptPhoto: null,
    refuelTime: iso(now - 7 * DAY),
  },
  {
    id: 'f2',
    tripId: 't2',
    vehicleId: 'v2',
    driverId: 'd2',
    liters: '310',
    pricePerLiter: som(10_160),
    totalAmount: som(3_149_600),
    stationName: 'UNG Petro',
    odometer: 286200,
    receiptPhoto: null,
    refuelTime: iso(now - DAY),
  },
  {
    id: 'f3',
    tripId: 't3',
    vehicleId: 'v3',
    driverId: 'd3',
    liters: '95',
    pricePerLiter: som(9_900),
    totalAmount: som(940_500),
    stationName: 'Lukoil',
    odometer: 501000,
    receiptPhoto: null,
    refuelTime: iso(now - 6 * HOUR),
  },
  {
    id: 'f4',
    tripId: null,
    vehicleId: 'v4',
    driverId: 'd4',
    liters: '120',
    pricePerLiter: som(10_050),
    totalAmount: som(1_206_000),
    stationName: 'Chevron Servis',
    odometer: 97800,
    receiptPhoto: null,
    refuelTime: iso(now - 3 * DAY),
  },
];

const events = [
  {
    id: 'ev1',
    tripId: 't3',
    eventType: 'START',
    eventTime: iso(now - 8 * HOUR),
    address: 'Samarqand',
    lat: 39.65,
    lng: 66.96,
    odometer: 500890,
    comment: null,
    photoUrls: null,
  },
  {
    id: 'ev2',
    tripId: 't3',
    eventType: 'LOADED',
    eventTime: iso(now - 7 * HOUR),
    address: 'Samarqand, bozor',
    lat: 39.66,
    lng: 66.98,
    odometer: 500902,
    comment: null,
    photoUrls: null,
  },
  {
    id: 'ev3',
    tripId: 't2',
    eventType: 'REFUEL',
    eventTime: iso(now - 26 * HOUR),
    address: 'Buxoro',
    lat: 39.77,
    lng: 64.42,
    odometer: 286200,
    comment: '310 l',
    photoUrls: null,
  },
  {
    id: 'ev4',
    tripId: 't2',
    eventType: 'REST',
    eventTime: iso(now - 5 * HOUR),
    address: 'Qizilorda yaqinida',
    lat: 44.85,
    lng: 65.5,
    odometer: null,
    comment: null,
    photoUrls: null,
  },
  {
    id: 'ev5',
    tripId: 't3',
    eventType: 'BREAKDOWN',
    eventTime: iso(now - 2 * HOUR),
    address: 'Jizzax',
    lat: 40.12,
    lng: 67.83,
    odometer: 501100,
    comment: 'Ballon yorildi',
    photoUrls: null,
  },
  {
    id: 'ev6',
    tripId: 't1',
    eventType: 'FINISH',
    eventTime: iso(now - 4 * DAY),
    address: 'Moskva',
    lat: 55.75,
    lng: 37.62,
    odometer: 412212,
    comment: null,
    photoUrls: null,
  },
];

const alerts = [
  {
    id: 'a1',
    type: 'FUEL_DEVIATION',
    title: 'FUEL_DEVIATION',
    message: JSON.stringify({
      plateNumber: '01 A 123 AA',
      diffLiters: 55.2,
      deviationPercent: 13.91,
    }),
    relatedType: 'Vehicle',
    relatedId: 'v1',
    isRead: false,
    createdAt: iso(now - 5 * HOUR),
  },
  {
    id: 'a2',
    type: 'DOC_EXPIRY',
    title: 'DOC_EXPIRY',
    message: JSON.stringify({ label: '01 C 789 CC', docType: 'texko‘rik', daysLeft: 6 }),
    relatedType: 'VEHICLE',
    relatedId: 'v3',
    isRead: false,
    createdAt: iso(now - 9 * HOUR),
  },
  {
    id: 'a3',
    type: 'PAYMENT_OVERDUE',
    title: 'PAYMENT_OVERDUE',
    message: JSON.stringify({
      clientName: 'Samarqand Agro',
      amount: som(8_800_000),
      invoiceNumber: 'INV-0138',
    }),
    relatedType: 'Income',
    relatedId: 'i3',
    isRead: false,
    createdAt: iso(now - DAY),
  },
  {
    id: 'a4',
    type: 'MAINTENANCE_DUE',
    title: 'MAINTENANCE_DUE',
    message: JSON.stringify({ plateNumber: '01 C 789 CC' }),
    relatedType: 'Vehicle',
    relatedId: 'v3',
    isRead: true,
    createdAt: iso(now - 2 * DAY),
  },
];

const liveVehicles = [
  {
    vehicleId: 'v1',
    plateNumber: '01 A 123 AA',
    status: 'IDLE',
    trip: null,
    driverName: null,
    lastPosition: { lat: 41.31, lng: 69.28, speed: 0, recordedAt: iso(now - 2 * DAY) },
    deviationKm: null,
  },
  {
    vehicleId: 'v2',
    plateNumber: '01 B 456 BB',
    status: 'RESTING',
    trip: { id: 't2', tripNumber: 'T-2026-0143', cargoName: 'Paxta tolasi' },
    driverName: 'Sherzod Karimov',
    lastPosition: { lat: 44.85, lng: 65.5, speed: 0, recordedAt: iso(now - 12 * 60 * 1000) },
    deviationKm: 1.2,
  },
  {
    vehicleId: 'v3',
    plateNumber: '01 C 789 CC',
    status: 'BREAKDOWN',
    trip: { id: 't3', tripNumber: 'T-2026-0144', cargoName: 'Meva-sabzavot' },
    driverName: 'Botir Raxmonov',
    lastPosition: { lat: 40.12, lng: 67.83, speed: 0, recordedAt: iso(now - 8 * 60 * 1000) },
    deviationKm: 0.4,
  },
  {
    vehicleId: 'v4',
    plateNumber: '01 D 321 DD',
    status: 'IDLE',
    trip: { id: 't4', tripNumber: 'T-2026-0145', cargoName: 'Qurilish materiallari' },
    driverName: "Jasur To'rayev",
    lastPosition: { lat: 41.29, lng: 69.2, speed: 0, recordedAt: iso(now - HOUR) },
    deviationKm: null,
  },
];

const fuelControl = [
  {
    vehicleId: 'v1',
    plateNumber: '01 A 123 AA',
    fuelNormPer100km: 32,
    distanceKm: 1240,
    normLiters: 396.8,
    actualLiters: 452,
    diffLiters: 55.2,
    avgPricePerLiter: som(10_000),
    lossAmount: som(552_000),
    deviationPercent: 13.91,
    overThreshold: true,
  },
  {
    vehicleId: 'v2',
    plateNumber: '01 B 456 BB',
    fuelNormPer100km: 30,
    distanceKm: 2980,
    normLiters: 894,
    actualLiters: 901,
    diffLiters: 7,
    avgPricePerLiter: som(10_160),
    lossAmount: som(71_120),
    deviationPercent: 0.78,
    overThreshold: false,
  },
  {
    vehicleId: 'v3',
    plateNumber: '01 C 789 CC',
    fuelNormPer100km: 28,
    distanceKm: 1730,
    normLiters: 484.4,
    actualLiters: 532,
    diffLiters: 47.6,
    avgPricePerLiter: som(9_900),
    lossAmount: som(471_240),
    deviationPercent: 9.83,
    overThreshold: true,
  },
  {
    vehicleId: 'v4',
    plateNumber: '01 D 321 DD',
    fuelNormPer100km: 33,
    distanceKm: 640,
    normLiters: 211.2,
    actualLiters: 208,
    diffLiters: -3.2,
    avgPricePerLiter: som(10_050),
    lossAmount: som(-32_160),
    deviationPercent: -1.52,
    overThreshold: false,
  },
];

const fuelStations = [
  {
    stationName: 'Lukoil',
    refuelCount: 9,
    liters: 2140,
    totalAmount: som(21_600_000),
    avgPricePerLiter: som(10_093),
  },
  {
    stationName: 'UNG Petro',
    refuelCount: 6,
    liters: 1480,
    totalAmount: som(15_050_000),
    avgPricePerLiter: som(10_169),
  },
  {
    stationName: 'Chevron Servis',
    refuelCount: 3,
    liters: 410,
    totalAmount: som(4_120_000),
    avgPricePerLiter: som(10_048),
  },
];

function monthKey(offset: number): string {
  const d = new Date(now);
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, 1));
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`;
}

const profitSeries = [42, 38, 51, 47, -8, 55, 61, 44, 58, 63, 49, 130].map((mln, index) => ({
  month: monthKey(11 - index),
  income: som(Math.abs(mln) * 2_600_000 + 180_000_000),
  expense: som(Math.abs(mln) * 2_600_000 + 180_000_000 - mln * 1_000_000),
  profit: som(mln * 1_000_000),
}));

const dashboard = {
  vehiclesOnRoute: 2,
  vehiclesTotal: 4,
  todayTrips: 3,
  monthIncome: som(340_000_000),
  monthExpense: som(210_000_000),
  monthProfit: som(130_000_000),
  unreadAlerts: alerts.filter((a) => !a.isRead).length,
  recentEvents: events
    .slice()
    .sort((a, b) => (a.eventTime < b.eventTime ? 1 : -1))
    .map((event) => ({
      id: event.id,
      eventType: event.eventType,
      eventTime: event.eventTime,
      address: event.address,
      driverName:
        drivers.find((d) => d.id === trips.find((t) => t.id === event.tripId)?.driverId)
          ?.fullName ?? null,
      tripNumber: trips.find((t) => t.id === event.tripId)?.tripNumber ?? null,
    })),
  profitSeries,
};

const profitRows: Record<string, Array<Record<string, unknown>>> = {
  trip: [
    {
      key: 't1',
      label: 'T-2026-0142',
      tripCount: 1,
      distanceKm: 3412,
      income: som(48_000_000),
      expenses: som(21_050_000),
      driverShare: som(4_800_000),
      amortization: som(2_730_000),
      totalCost: som(28_580_000),
      profit: som(19_420_000),
      costPerKm: som(8_377),
      roiPercent: 67.95,
    },
    {
      key: 't5',
      label: 'T-2026-0139',
      tripCount: 1,
      distanceKm: 792,
      income: som(14_000_000),
      expenses: som(6_900_000),
      driverShare: som(1_400_000),
      amortization: som(634_000),
      totalCost: som(8_934_000),
      profit: som(5_066_000),
      costPerKm: som(11_280),
      roiPercent: 56.71,
    },
    {
      key: 't6',
      label: 'T-2026-0138',
      tripCount: 1,
      distanceKm: 531,
      income: som(8_800_000),
      expenses: som(8_100_000),
      driverShare: '0',
      amortization: som(354_000),
      totalCost: som(8_454_000),
      profit: som(346_000),
      costPerKm: som(15_920),
      roiPercent: 4.09,
    },
  ],
  vehicle: [
    {
      key: 'v1',
      label: '01 A 123 AA',
      tripCount: 2,
      distanceKm: 4204,
      income: som(62_000_000),
      expenses: som(27_950_000),
      driverShare: som(6_200_000),
      amortization: som(3_364_000),
      totalCost: som(37_514_000),
      profit: som(24_486_000),
      costPerKm: som(8_923),
      roiPercent: 65.27,
    },
    {
      key: 'v3',
      label: '01 C 789 CC',
      tripCount: 1,
      distanceKm: 531,
      income: som(8_800_000),
      expenses: som(8_100_000),
      driverShare: '0',
      amortization: som(354_000),
      totalCost: som(8_454_000),
      profit: som(346_000),
      costPerKm: som(15_920),
      roiPercent: 4.09,
    },
  ],
  route: [
    {
      key: 'r1',
      label: 'Toshkent → Moskva',
      tripCount: 1,
      distanceKm: 3412,
      income: som(48_000_000),
      expenses: som(21_050_000),
      driverShare: som(4_800_000),
      amortization: som(2_730_000),
      totalCost: som(28_580_000),
      profit: som(19_420_000),
      costPerKm: som(8_377),
      roiPercent: 67.95,
    },
    {
      key: 'r2',
      label: 'Toshkent → Olmaota',
      tripCount: 1,
      distanceKm: 792,
      income: som(14_000_000),
      expenses: som(6_900_000),
      driverShare: som(1_400_000),
      amortization: som(634_000),
      totalCost: som(8_934_000),
      profit: som(5_066_000),
      costPerKm: som(11_280),
      roiPercent: 56.71,
    },
    {
      key: 'r3',
      label: 'Qarshi → Toshkent',
      tripCount: 1,
      distanceKm: 531,
      income: som(8_800_000),
      expenses: som(8_100_000),
      driverShare: '0',
      amortization: som(354_000),
      totalCost: som(8_454_000),
      profit: som(346_000),
      costPerKm: som(15_920),
      roiPercent: 4.09,
    },
  ],
  driver: [
    {
      key: 'd1',
      label: 'Alisher Abdullayev',
      tripCount: 2,
      distanceKm: 4204,
      income: som(62_000_000),
      expenses: som(27_950_000),
      driverShare: som(6_200_000),
      amortization: som(3_364_000),
      totalCost: som(37_514_000),
      profit: som(24_486_000),
      costPerKm: som(8_923),
      roiPercent: 65.27,
    },
    {
      key: 'd3',
      label: 'Botir Raxmonov',
      tripCount: 1,
      distanceKm: 531,
      income: som(8_800_000),
      expenses: som(8_100_000),
      driverShare: '0',
      amortization: som(354_000),
      totalCost: som(8_454_000),
      profit: som(346_000),
      costPerKm: som(15_920),
      roiPercent: 4.09,
    },
  ],
  client: [
    {
      key: 'k1',
      label: 'Uztrans Logistics',
      tripCount: 1,
      distanceKm: 3412,
      income: som(48_000_000),
      expenses: som(21_050_000),
      driverShare: som(4_800_000),
      amortization: som(2_730_000),
      totalCost: som(28_580_000),
      profit: som(19_420_000),
      costPerKm: som(8_377),
      roiPercent: 67.95,
    },
    {
      key: 'k2',
      label: 'Orient Cargo',
      tripCount: 1,
      distanceKm: 792,
      income: som(14_000_000),
      expenses: som(6_900_000),
      driverShare: som(1_400_000),
      amortization: som(634_000),
      totalCost: som(8_934_000),
      profit: som(5_066_000),
      costPerKm: som(11_280),
      roiPercent: 56.71,
    },
    {
      key: 'k3',
      label: 'Samarqand Agro',
      tripCount: 1,
      distanceKm: 531,
      income: som(8_800_000),
      expenses: som(8_100_000),
      driverShare: '0',
      amortization: som(354_000),
      totalCost: som(8_454_000),
      profit: som(346_000),
      costPerKm: som(15_920),
      roiPercent: 4.09,
    },
  ],
};

const expenseStructure = [
  { category: 'FUEL', amount: som(126_000_000), sharePercent: 60 },
  { category: 'TOLL', amount: som(29_400_000), sharePercent: 14 },
  { category: 'SALARY', amount: som(21_000_000), sharePercent: 10 },
  { category: 'CUSTOMS', amount: som(12_600_000), sharePercent: 6 },
  { category: 'REPAIR', amount: som(10_500_000), sharePercent: 5 },
  { category: 'OTHER', amount: som(10_500_000), sharePercent: 5 },
];

const receivables = [
  {
    clientId: 'k1',
    name: 'Uztrans Logistics',
    phone: '+998712001122',
    paymentTermsDays: 15,
    outstanding: som(18_000_000),
    overdue: '0',
    invoiceCount: 1,
  },
  {
    clientId: 'k3',
    name: 'Samarqand Agro',
    phone: '+998662221133',
    paymentTermsDays: 10,
    outstanding: som(8_800_000),
    overdue: som(8_800_000),
    invoiceCount: 1,
  },
];

const tripPnl: Record<string, unknown> = {
  tripId: 't1',
  tripNumber: 'T-2026-0142',
  status: 'COMPLETED',
  distanceKm: 3412,
  agreedPrice: som(48_000_000),
  receivedAmount: som(30_000_000),
  expensesByCategory: { FUEL: som(14_200_000), TOLL: som(4_150_000), CUSTOMS: som(2_700_000) },
  expensesTotal: som(21_050_000),
  driverShareSource: 'COMPUTED',
  driverShare: som(4_800_000),
  amortization: som(2_730_000),
  totalCost: som(28_580_000),
  profit: som(19_420_000),
  costPerKm: som(8_377),
};

function ok<T>(data: T, total?: number, page = 1): ApiResponse<T> {
  return {
    success: true,
    data,
    error: null,
    meta: total === undefined ? null : { pagination: { page, limit: 20, total } },
  };
}

function withRelations(trip: (typeof trips)[number]) {
  return {
    ...trip,
    client: clients.find((c) => c.id === trip.clientId) ?? null,
    vehicle: vehicles.find((v) => v.id === trip.vehicleId) ?? null,
    trailer: vehicles.find((v) => v.id === trip.trailerId) ?? null,
    driver: drivers.find((d) => d.id === trip.driverId) ?? null,
  };
}

let idSeq = 100;

/** Serves every API path the web app uses, entirely from memory. */
export function demoRequest<T>(path: string, options: RequestOptions): Promise<ApiResponse<T>> {
  const [route, queryString] = path.split('?');
  const query = new URLSearchParams(queryString ?? '');
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const method = options.method ?? 'GET';
  const respond = (payload: ApiResponse<unknown>) =>
    new Promise<ApiResponse<T>>((resolve) =>
      setTimeout(() => resolve(payload as ApiResponse<T>), 120),
    );

  // ---- auth ----
  if (route === '/auth/login')
    return respond(ok({ accessToken: 'demo-access', refreshToken: 'demo-refresh' }));
  if (route === '/auth/refresh')
    return respond(ok({ accessToken: 'demo-access', refreshToken: 'demo-refresh' }));
  if (route === '/auth/me') return respond(ok(user));
  if (route === '/auth/logout') return respond(ok({ loggedOut: true }));

  // ---- collections ----
  if (route === '/vehicles' && method === 'GET') return respond(ok(vehicles, vehicles.length));
  if (route === '/drivers' && method === 'GET') return respond(ok(drivers, drivers.length));
  if (route === '/clients' && method === 'GET') return respond(ok(clients, clients.length));
  if (route === '/clients/receivables') return respond(ok(receivables));

  if (route === '/trips' && method === 'GET') {
    const status = query.get('status');
    const list = trips.filter((t) => !status || t.status === status).map(withRelations);
    return respond(ok(list, list.length));
  }
  const tripMatch = /^\/trips\/([^/]+)$/.exec(route ?? '');
  if (tripMatch && method === 'GET') {
    const trip = trips.find((t) => t.id === tripMatch[1]) ?? trips[0]!;
    return respond(ok(withRelations(trip)));
  }
  if (/^\/trips\/[^/]+\/pnl$/.test(route ?? '')) {
    const id = (route ?? '').split('/')[2];
    const trip = trips.find((t) => t.id === id);
    return respond(
      ok({
        ...tripPnl,
        tripId: id,
        tripNumber: trip?.tripNumber ?? 'T-2026-0142',
        status: trip?.status ?? 'COMPLETED',
      }),
    );
  }
  if (/^\/trips\/[^/]+\/share-link$/.test(route ?? '')) {
    return respond(
      ok({ url: 'https://truckcontrol.uz/track/demo-token', expiresAt: iso(now + 3 * DAY) }),
    );
  }

  if (route === '/events') {
    const tripId = query.get('tripId');
    return respond(ok(events.filter((e) => !tripId || e.tripId === tripId)));
  }
  if (route === '/expenses' && method === 'GET') {
    const tripId = query.get('tripId');
    const list = expenses.filter((e) => !tripId || e.tripId === tripId);
    return respond(ok(list, list.length));
  }
  if (route === '/incomes' && method === 'GET') {
    const tripId = query.get('tripId');
    const list = incomes.filter((i) => !tripId || i.tripId === tripId);
    return respond(ok(list, list.length));
  }
  if (route === '/fuel' && method === 'GET') return respond(ok(fuelLogs, fuelLogs.length));
  if (route === '/fuel/control') return respond(ok(fuelControl));
  if (route === '/fuel/by-station') return respond(ok(fuelStations));
  if (route === '/tracking/live') return respond(ok(liveVehicles));
  if (/^\/tracking\/vehicles\/.+\/history/.test(route ?? '')) {
    return respond(
      ok([
        { lat: 39.65, lng: 66.96, speed: 62, recordedAt: iso(now - 8 * HOUR) },
        { lat: 39.9, lng: 67.2, speed: 74, recordedAt: iso(now - 6 * HOUR) },
        { lat: 40.12, lng: 67.83, speed: 0, recordedAt: iso(now - 2 * HOUR) },
      ]),
    );
  }

  if (route === '/reports/dashboard') return respond(ok(dashboard));
  if (route === '/reports/profit')
    return respond(ok(profitRows[query.get('groupBy') ?? 'trip'] ?? []));
  if (route === '/reports/expense-structure') return respond(ok(expenseStructure));

  if (route === '/alerts' && method === 'GET') {
    const unread = query.get('unread') === 'true';
    const list = alerts.filter((a) => !unread || !a.isRead);
    return respond(ok(list, list.length));
  }
  if (route === '/alerts/ack-all') {
    alerts.forEach((a) => (a.isRead = true));
    return respond(ok({ acknowledged: alerts.length }));
  }
  const ackMatch = /^\/alerts\/([^/]+)\/ack$/.exec(route ?? '');
  if (ackMatch) {
    const alert = alerts.find((a) => a.id === ackMatch[1]);
    if (alert) alert.isRead = true;
    return respond(ok(alert ?? {}));
  }

  // ---- mutations: create into memory so the demo feels alive ----
  if (method === 'POST' || method === 'PATCH') {
    const body = (options.body ?? {}) as Record<string, unknown>;
    idSeq += 1;
    const created: Record<string, unknown> = {
      id: `demo-${idSeq}`,
      createdAt: iso(now),
      isApproved: false,
      ...body,
    };
    const push = (list: unknown[], defaults: Record<string, unknown>) =>
      list.unshift({ ...defaults, ...created });
    if (route === '/expenses') push(expenses, { expenseDate: iso(now) });
    if (route === '/incomes') push(incomes, { status: 'PENDING' });
    if (route === '/fuel') push(fuelLogs, { refuelTime: iso(now) });
    if (route === '/trips') {
      push(trips, { ...withRelations(trips[0]!), status: 'DRAFT', tripNumber: `T-2026-0${idSeq}` });
    }
    return respond(ok(created));
  }

  return respond(ok([] as unknown));
}
