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

/** Self-service sign-up: a company and its first OWNER in one request. */
export interface RegisterRequest {
  companyName: string;
  fullName: string;
  email: string;
  phone?: string;
  password: string;
}

/** Every new tenant starts on a free trial of this length. */
export const TRIAL_DAYS = 14;
export const TARIFF_TRIAL = 'TRIAL';

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
  'AUTH_COMPANY_INACTIVE',
  'AUTH_SUBSCRIPTION_EXPIRED',
  'AUTH_PASSWORD_UNCHANGED',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_REFRESH_INVALID',
  'AUTH_FORBIDDEN',
  'AUTH_EMAIL_TAKEN',
  'AUTH_PHONE_TAKEN',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'TENANT_MISSING',
  'INTERNAL_ERROR',
  'ALREADY_EXISTS',
  'RESOURCE_IN_USE',
  'CONFIRMATION_MISMATCH',
  'TRIP_INVALID_STATUS',
  'SMS_CODE_INVALID',
  'FILE_TYPE_NOT_ALLOWED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
