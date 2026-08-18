// Response shapes from the backend. Money fields arrive as decimal strings of
// tiyin (BigInt is JSON-serialized to string), dates as ISO strings (UTC).
import type {
  Currency,
  ExpenseCategory,
  LiveStatus,
  PaymentStatus,
  SalaryType,
  TripEventType,
  TripStatus,
  UserRole,
  VehicleType,
} from 'shared';

export interface User {
  id: string;
  companyId: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  lastLogin: string | null;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  type: VehicleType;
  brand: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  fuelType: string | null;
  fuelNormPer100km: string | null;
  tankCapacity: string | null;
  currentOdometer: number | null;
  insuranceExpiry: string | null;
  techInspectionExpiry: string | null;
  nextServiceOdometer: number | null;
  isActive: boolean;
}

export interface Driver {
  id: string;
  fullName: string;
  phone: string | null;
  birthDate: string | null;
  passport: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  hireDate: string | null;
  salaryType: SalaryType | null;
  salaryValue: string | null;
  rating: string | null;
  isActive: boolean;
}

export interface Client {
  id: string;
  name: string;
  inn: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTermsDays: number | null;
  balance: string;
}

export interface Trip {
  id: string;
  tripNumber: string;
  clientId: string | null;
  vehicleId: string | null;
  trailerId: string | null;
  driverId: string | null;
  cargoName: string | null;
  cargoWeight: string | null;
  cargoVolume: string | null;
  loadingAddress: string | null;
  loadingDate: string | null;
  unloadingAddress: string | null;
  unloadingDate: string | null;
  plannedDistanceKm: string | null;
  actualDistanceKm: string | null;
  agreedPrice: string;
  currency: Currency;
  driverAdvance: string;
  notes: string | null;
  status: TripStatus;
  startOdometer: number | null;
  endOdometer: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  client?: Client | null;
  vehicle?: Vehicle | null;
  trailer?: Vehicle | null;
  driver?: Driver | null;
}

export interface Expense {
  id: string;
  tripId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  category: ExpenseCategory;
  amount: string;
  currency: Currency;
  quantity: string | null;
  unitPrice: string | null;
  description: string | null;
  paymentMethod: string | null;
  expenseDate: string;
  isApproved: boolean;
}

export interface Income {
  id: string;
  tripId: string | null;
  clientId: string | null;
  amount: string;
  currency: Currency;
  paymentDate: string | null;
  paymentMethod: string | null;
  invoiceNumber: string | null;
  status: PaymentStatus;
  createdAt: string;
}

export interface TripEvent {
  id: string;
  tripId: string;
  driverId: string | null;
  eventType: TripEventType;
  eventTime: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  odometer: number | null;
  comment: string | null;
  photoUrls: string[] | null;
}

export interface Company {
  id: string;
  name: string;
  inn: string | null;
  address: string | null;
  phone: string | null;
  tariffPlan: string | null;
  subscriptionUntil: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AdminCompany extends Company {
  owner: { id: string; fullName: string; email: string | null; phone: string | null } | null;
  userCount: number;
  tripCount: number;
}

export interface AdminStats {
  companies: number;
  activeCompanies: number;
  trialCompanies: number;
  expiredCompanies: number;
  users: number;
  trips: number;
}

// ---------- Dashboard (GET /dashboard/summary) ----------

export interface DashboardSummary {
  kpi: {
    activeTrips: number;
    todayTrips: number;
    activeVehicles: number;
    activeDrivers: number;
    todayIncome: string;
    todayExpense: string;
    receivables: string;
  };
  activeTrips: Trip[];
  recentIncomes: Array<Income & { client?: Client | null; trip?: TripRef | null }>;
  recentExpenses: Array<Expense & { trip?: TripRef | null }>;
}

export interface TripRef {
  id: string;
  tripNumber: string;
}

// ---------- Tracking (GET /tracking/live) ----------

export interface LiveVehicle {
  vehicleId: string;
  plateNumber: string;
  status: LiveStatus;
  trip: { id: string; tripNumber: string; cargoName: string | null } | null;
  driverName: string | null;
  lastPosition: { lat: number; lng: number; speed: number | null; recordedAt: string } | null;
  deviationKm: number | null;
}

export interface GpsPoint {
  lat: number;
  lng: number;
  speed: number | null;
  recordedAt: string;
}

// ---------- Reports ----------

export interface ReportRange {
  from: string;
  to: string;
}

export interface TripsReport {
  range: ReportRange;
  total: number;
  byStatus: Array<{ status: TripStatus; count: number; agreedTotal: string }>;
  byMonth: Array<{ month: string; count: number; agreedTotal: string }>;
}

export interface FinanceReport {
  range: ReportRange;
  incomeTotal: string;
  expenseTotal: string;
  net: string;
  expenseByCategory: Array<{ category: ExpenseCategory; count: number; amount: string }>;
  incomeByStatus: Array<{ status: PaymentStatus; count: number; amount: string }>;
  byMonth: Array<{ month: string; income: string; expense: string }>;
  otherCurrencies: Array<{ currency: Currency; income: string; expense: string }>;
}

export interface VehicleReportRow {
  vehicleId: string;
  plateNumber: string;
  brand: string | null;
  model: string | null;
  trips: number;
  distanceKm: string | null;
  revenue: string;
  expenses: string;
}

export interface DriverReportRow {
  driverId: string;
  fullName: string;
  trips: number;
  completedTrips: number;
  distanceKm: string | null;
  revenue: string;
}
