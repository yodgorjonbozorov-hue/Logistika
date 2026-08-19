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

// ---------- Finance views (TZ §6 — computed by the backend, never by AI) ----------

/**
 * Money crosses the wire as a decimal string of tiyin: JSON has no BigInt, and
 * a float would lose so'm. Percentages travel as basis points (1% = 100), and
 * distances as tenths of a kilometre — integers all the way down.
 */
export type MoneyTiyin = string;

export interface DateRange {
  from: string;
  to: string;
}

export interface CategoryAmount {
  category: ExpenseCategory;
  amount: MoneyTiyin;
}

/** W-4 «Moliya» tab: one trip's profit and loss. */
export interface TripPnlView {
  tripId: string;
  tripNumber: string;
  distanceKm10: number;
  revenue: MoneyTiyin;
  /** True when revenue comes from recorded payments rather than the agreed price. */
  revenueFromPayments: boolean;
  expensesByCategory: CategoryAmount[];
  expenseTotal: MoneyTiyin;
  driverShare: MoneyTiyin;
  driverAdvance: MoneyTiyin;
  driverBalance: MoneyTiyin;
  amortization: MoneyTiyin;
  netProfit: MoneyTiyin;
  marginBp: number;
  costPerKm: MoneyTiyin;
}

/** W-5 statistics: what one vehicle earned, ate and returned over a period. */
export interface VehicleStatsView {
  vehicleId: string;
  plateNumber: string;
  range: DateRange;
  tripCount: number;
  distanceKm10: number;
  revenue: MoneyTiyin;
  expenseTotal: MoneyTiyin;
  driverShare: MoneyTiyin;
  amortization: MoneyTiyin;
  totalCost: MoneyTiyin;
  netProfit: MoneyTiyin;
  costPerKm: MoneyTiyin;
  roiBp: number;
}

export interface MonthlyProfitPoint {
  /** `YYYY-MM` in UTC. */
  month: string;
  income: MoneyTiyin;
  expenses: MoneyTiyin;
  profit: MoneyTiyin;
}

/** W-1 dashboard header. */
export interface FinanceSummaryView {
  range: DateRange;
  vehiclesTotal: number;
  vehiclesOnRoad: number;
  tripsToday: number;
  tripsActive: number;
  /** Payments actually received in the period. */
  income: MoneyTiyin;
  /** Expenses booked in the period. */
  expenses: MoneyTiyin;
  /** Depreciation of the period's trips — booked nowhere, but real (TZ §6). */
  amortization: MoneyTiyin;
  netProfit: MoneyTiyin;
  /** Invoiced but unpaid, and the part of it already overdue. */
  receivable: MoneyTiyin;
  overdue: MoneyTiyin;
  expensesByCategory: CategoryAmount[];
  monthly: MonthlyProfitPoint[];
}

/** W-8 fuel control — the killer feature's table row. */
export interface FuelControlRow {
  vehicleId: string;
  plateNumber: string;
  distanceKm10: number;
  /** Litres × 100, so 396.80 l travels as 39680. */
  normLitersCenti: number;
  actualLitersCenti: number;
  diffLitersCenti: number;
  diffBp: number;
  lossTiyin: MoneyTiyin;
  /** Set when the overrun passes the company's threshold — the red signal. */
  overThreshold: boolean;
  refuelCount: number;
  avgPricePerLiter: MoneyTiyin;
}

export interface FuelControlView {
  range: DateRange;
  thresholdBp: number;
  rows: FuelControlRow[];
  totalLossTiyin: MoneyTiyin;
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
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
