// TruckControl AI — shared API contract between backend and web.
// Enums mirror the Prisma schema (apps/backend/prisma/schema.prisma).

// ---------- API response envelope (CLAUDE.md rule) ----------

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ApiMeta {
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  meta: ApiMeta | null;
}

// ---------- Auth ----------

export enum UserRole {
  SUPERADMIN = 'SUPERADMIN',
  OWNER = 'OWNER',
  LOGIST = 'LOGIST',
  ACCOUNTANT = 'ACCOUNTANT',
  DRIVER = 'DRIVER',
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface CurrentUserPayload {
  userId: string;
  companyId: string | null;
  role: UserRole;
}

// ---------- Domain enums (TZ §5) ----------

export enum VehicleType {
  TRUCK = 'TRUCK',
  TRAILER = 'TRAILER',
  SPECIAL = 'SPECIAL',
}

export enum SalaryType {
  FIXED = 'FIXED',
  PERCENT = 'PERCENT',
  PER_KM = 'PER_KM',
}

export enum TripStatus {
  DRAFT = 'DRAFT',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum TripEventType {
  START = 'START',
  LOADED = 'LOADED',
  REST = 'REST',
  RESUME = 'RESUME',
  REFUEL = 'REFUEL',
  BREAKDOWN = 'BREAKDOWN',
  CUSTOMS = 'CUSTOMS',
  EXPENSE = 'EXPENSE',
  DELIVERED = 'DELIVERED',
  FINISH = 'FINISH',
}

export enum ExpenseCategory {
  FUEL = 'FUEL',
  TOLL = 'TOLL',
  CUSTOMS = 'CUSTOMS',
  REPAIR = 'REPAIR',
  PARTS = 'PARTS',
  FINE = 'FINE',
  PARKING = 'PARKING',
  SALARY = 'SALARY',
  INSURANCE = 'INSURANCE',
  TAX = 'TAX',
  OTHER = 'OTHER',
}

export enum Currency {
  UZS = 'UZS',
  USD = 'USD',
  RUB = 'RUB',
  KZT = 'KZT',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
}

export enum DocumentOwnerType {
  VEHICLE = 'VEHICLE',
  DRIVER = 'DRIVER',
  COMPANY = 'COMPANY',
  TRIP = 'TRIP',
}

export enum MaintenanceType {
  PLANNED_TO = 'PLANNED_TO',
  REPAIR = 'REPAIR',
}

/** Live map colors — TZ §4.1 W-2: 🟢 moving, 🟡 rest, 🔴 breakdown, ⚪️ idle. */
export enum LiveStatus {
  MOVING = 'MOVING',
  RESTING = 'RESTING',
  BREAKDOWN = 'BREAKDOWN',
  IDLE = 'IDLE',
}

// ---------- i18n ----------

export const LOCALES = ['uz-latn', 'uz-cyrl', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'uz-latn';

// ---------- Machine-readable error codes ----------

export const ERROR_CODES = [
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_USER_INACTIVE',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_REFRESH_INVALID',
  'AUTH_FORBIDDEN',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'TENANT_MISSING',
  'INTERNAL_ERROR',
  'ALREADY_EXISTS',
  'RESOURCE_IN_USE',
  'TRIP_INVALID_STATUS',
  'SMS_CODE_INVALID',
  'FILE_TYPE_NOT_ALLOWED',
  'FILE_CORRUPT',
  'PAYLOAD_TOO_LARGE',
  'DRIVER_PROFILE_MISSING',
  'RATE_LIMITED',
  'CONFLICT',
  'ODOMETER_INVALID',
  'RESOURCE_BUSY',
  'SERVICE_UNAVAILABLE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---------- Finance analytics (TZ §6) ----------
//
// Money is a decimal STRING of tiyin end to end — a JSON number is a double and
// cannot hold a company's yearly turnover exactly. Distances are km with one
// decimal, volumes litres with two, and every ratio is in basis points
// (1% = 100 bp) so nothing on this contract is ever a float.

export interface FinancePeriodTotals {
  /** Agreed price of the trips in the period, tiyin. */
  revenue: string;
  /** Income booked in the period, tiyin. Reported beside revenue, never added. */
  invoiced: string;
  /** Income marked PAID, tiyin. */
  received: string;
  /** invoiced − received, tiyin. */
  outstanding: string;
  expenses: string;
  fuelCost: string;
  /** revenue − expenses, tiyin. Negative when the period lost money. */
  profit: string;
  marginBp: number;
}

export interface FinanceSummary extends FinancePeriodTotals {
  from: string;
  to: string;
  trips: { total: number; completed: number; cancelled: number; inProgress: number };
  /** Distinct vehicles that started a trip in the period. */
  trucksDispatched: number;
  routesUsed: number;
  distanceKm: string;
  fuelLitres: string;
  costPerKm: string | null;
  revenuePerKm: string | null;
  profitPerKm: string | null;
  profitPerTrip: string | null;
  expensesByCategory: Array<{ category: string; amount: string; shareBp: number }>;
}

export interface TripFinanceRow {
  tripId: string;
  tripNumber: string;
  status: TripStatus;
  periodAt: string;
  routeId: string | null;
  routeName: string | null;
  vehicleId: string | null;
  plateNumber: string | null;
  driverName: string | null;
  clientName: string | null;
  distanceKm: string;
  revenue: string;
  expenses: string;
  fuelCost: string;
  profit: string;
  marginBp: number;
  profitPerKm: string | null;
}

export interface RouteFinanceRow {
  routeId: string | null;
  /** "UNASSIGNED" for trips that were never given a route. */
  routeName: string;
  trips: number;
  completedTrips: number;
  distanceKm: string;
  revenue: string;
  expenses: string;
  profit: string;
  marginBp: number;
  profitPerTrip: string | null;
  profitPerKm: string | null;
}

export interface VehicleFinanceRow {
  vehicleId: string;
  plateNumber: string;
  trips: number;
  distanceKm: string;
  revenue: string;
  expenses: string;
  profit: string;
  marginBp: number;
  profitPerKm: string | null;
  fuelLitres: string;
  fuelCost: string;
  consumption: string | null;
  normConsumption: string | null;
  deviationBp: number | null;
}

export interface MonthlyFinanceRow {
  /** YYYY-MM */
  month: string;
  trips: number;
  trucksDispatched: number;
  routesUsed: number;
  distanceKm: string;
  revenue: string;
  expenses: string;
  profit: string;
  marginBp: number;
  revenueChangeBp: number | null;
  profitChangeBp: number | null;
}

export interface FuelFinanceRow {
  vehicleId: string;
  plateNumber: string;
  refuels: number;
  litres: string;
  cost: string;
  distanceKm: string;
  consumption: string | null;
  normConsumption: string | null;
  deviationBp: number | null;
  /** Burning more than the configured alert threshold over the norm. */
  overNorm: boolean;
}
