// Finance / fuel / report / alert responses. Money arrives as tiyin in decimal
// strings (BigInt on the wire), ratios as basis points, dates as ISO UTC.
import { useQuery } from '@tanstack/react-query';
import type { AlertType, ExpenseCategory, TripEventType } from 'shared';
import { api } from './client';

export interface Period {
  from: string;
  to: string;
  /** Query params are passed straight to the API client. */
  [key: string]: string;
}

export interface PeriodTotals {
  from: string;
  to: string;
  revenue: string;
  tripCost: string;
  overhead: string;
  cost: string;
  profit: string;
  marginBp: number | null;
  tripCount: number;
  distanceKm: string | null;
  costPerKm: string | null;
  expensesByCategory: Partial<Record<ExpenseCategory, string>>;
}

export interface TripFinanceView {
  tripId: string;
  tripNumber: string;
  income: string;
  expensesByCategory: Partial<Record<ExpenseCategory, string>>;
  expensesTotal: string;
  driverShare: string;
  depreciation: string;
  costTotal: string;
  profit: string;
  marginBp: number | null;
  profitPerKm: string | null;
  distanceKm: string | null;
}

export interface VehicleEconomics {
  vehicleId: string;
  plateNumber: string;
  tripCount: number;
  distanceKm: string | null;
  revenue: string;
  cost: string;
  profit: string;
  depreciation: string;
  costPerKm: string | null;
  roiBp: number | null;
}

export interface Receivable {
  clientId: string | null;
  clientName: string | null;
  pending: string;
  overdue: string;
  total: string;
  oldestDate: string | null;
}

export interface FuelControlRow {
  vehicleId: string;
  plateNumber: string;
  normPer100km: string | null;
  distanceKm: string | null;
  normLitres: string;
  actualLitres: string;
  deviationLitres: string;
  deviationBp: number | null;
  avgPricePerLitre: string | null;
  lossTiyin: string | null;
  refuelCount: number;
  exceedsThreshold: boolean;
}

export interface FuelStationRow {
  stationName: string;
  refuelCount: number;
  litres: string;
  totalAmount: string;
  avgPricePerLitre: string | null;
  attributedOverrunLitres: string;
}

export interface FuelLog {
  id: string;
  vehicleId: string;
  tripId: string | null;
  liters: string;
  pricePerLiter: string | null;
  totalAmount: string | null;
  stationName: string | null;
  odometer: number | null;
  refuelTime: string;
}

export interface DashboardView {
  vehiclesOnRoad: number;
  vehiclesTotal: number;
  tripsToday: number;
  month: PeriodTotals;
  unreadAlerts: number;
  recentEvents: Array<{
    id: string;
    eventType: TripEventType;
    eventTime: string;
    address: string | null;
    driverName: string | null;
    tripNumber: string | null;
  }>;
  profitTrend: Array<{ month: string; revenue: string; cost: string; profit: string }>;
}

export type ReportColumnType = 'text' | 'date' | 'number' | 'money' | 'litres' | 'km' | 'percent';

export interface ReportTable {
  key: string;
  titleKey: string;
  columns: Array<{ key: string; labelKey: string; type: ReportColumnType }>;
  rows: Array<Record<string, string | number | null>>;
  totals?: Record<string, string | number | null>;
}

export interface AlertRow {
  id: string;
  type: AlertType;
  title: string;
  /** JSON: { key, params } — rendered through i18n on this side. */
  message: string;
  relatedType: string | null;
  relatedId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface ExpiringDocument {
  id: string;
  ownerType: string;
  ownerId: string;
  ownerLabel: string | null;
  docType: string;
  docNumber: string | null;
  expiryDate: string;
  daysLeft: number;
}

export interface ServiceDue {
  vehicleId: string;
  plateNumber: string;
  currentOdometer: number;
  nextServiceOdometer: number;
  kmLeft: number;
  isOverdue: boolean;
  lastServiceDate: string | null;
}

// ---------- Queries ----------

export function useDashboard() {
  return useQuery({
    queryKey: ['reports', 'dashboard'],
    queryFn: async () => (await api<DashboardView>('/reports/dashboard')).data,
    refetchInterval: 60_000,
  });
}

export function useFinanceSummary(period: Period) {
  return useQuery({
    queryKey: ['finance', 'summary', period],
    queryFn: async () => (await api<PeriodTotals>('/finance/summary', { query: period })).data,
  });
}

export function useFleetEconomics(period: Period) {
  return useQuery({
    queryKey: ['finance', 'vehicles', period],
    queryFn: async () =>
      (await api<VehicleEconomics[]>('/finance/vehicles', { query: period })).data,
  });
}

export function useReceivables() {
  return useQuery({
    queryKey: ['finance', 'receivables'],
    queryFn: async () => (await api<Receivable[]>('/finance/receivables')).data,
  });
}

export function useTripPnl(tripId: string) {
  return useQuery({
    queryKey: ['finance', 'trip', tripId],
    queryFn: async () => (await api<TripFinanceView>(`/finance/trips/${tripId}`)).data,
  });
}

export function useFuelControl(period: Period) {
  return useQuery({
    queryKey: ['fuel', 'control', period],
    queryFn: async () => (await api<FuelControlRow[]>('/fuel/control', { query: period })).data,
  });
}

export function useFuelStations(period: Period) {
  return useQuery({
    queryKey: ['fuel', 'stations', period],
    queryFn: async () => (await api<FuelStationRow[]>('/fuel/stations', { query: period })).data,
  });
}

export function useReport(key: string, period: Period) {
  return useQuery({
    queryKey: ['reports', key, period],
    queryFn: async () => (await api<ReportTable>(`/reports/${key}`, { query: period })).data,
  });
}

export function useExpiringDocuments() {
  return useQuery({
    queryKey: ['documents', 'expiring'],
    queryFn: async () => (await api<ExpiringDocument[]>('/documents/expiring')).data,
  });
}

export function useServiceDue() {
  return useQuery({
    queryKey: ['maintenance', 'due'],
    queryFn: async () => (await api<ServiceDue[]>('/maintenance/due')).data,
  });
}
