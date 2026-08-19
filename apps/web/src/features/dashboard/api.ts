import { useQuery } from '@tanstack/react-query';
import type {
  FinanceSummary,
  FuelFinanceRow,
  MonthlyFinanceRow,
  RouteFinanceRow,
  TripFinanceRow,
  VehicleFinanceRow,
} from 'shared';
import { api } from '../../shared/api/client';
import type { Period } from './period';

/**
 * The finance endpoints are read-only rollups, so the cache can be generous:
 * a company's P&L for a closed period does not change while someone stares at
 * it, and refetching six aggregates on every window focus is a lot of database
 * work for no new information.
 */
const STALE_MS = 60_000;

export function useFinanceSummary(period: Period) {
  return useQuery({
    queryKey: ['finance', 'summary', period],
    queryFn: async () => (await api<FinanceSummary>('/finance/summary', { query: period })).data,
    staleTime: STALE_MS,
  });
}

export function useFinanceRoutes(period: Period) {
  return useQuery({
    queryKey: ['finance', 'routes', period],
    queryFn: async () => (await api<RouteFinanceRow[]>('/finance/routes', { query: period })).data,
    staleTime: STALE_MS,
  });
}

export function useFinanceVehicles(period: Period) {
  return useQuery({
    queryKey: ['finance', 'vehicles', period],
    queryFn: async () =>
      (await api<VehicleFinanceRow[]>('/finance/vehicles', { query: period })).data,
    staleTime: STALE_MS,
  });
}

export function useFinanceFuel(period: Period) {
  return useQuery({
    queryKey: ['finance', 'fuel', period],
    queryFn: async () => (await api<FuelFinanceRow[]>('/finance/fuel', { query: period })).data,
    staleTime: STALE_MS,
  });
}

/** Months back from the current one; the series is independent of the period. */
export function useFinanceMonthly(months = 12) {
  return useQuery({
    queryKey: ['finance', 'monthly', months],
    queryFn: async () =>
      (await api<MonthlyFinanceRow[]>('/finance/monthly', { query: { months } })).data,
    staleTime: STALE_MS,
  });
}

export function useFinanceTrips(
  period: Period,
  page: number,
  filters: { routeId?: string; vehicleId?: string } = {},
) {
  return useQuery({
    queryKey: ['finance', 'trips', period, page, filters],
    queryFn: () =>
      api<TripFinanceRow[]>('/finance/trips', {
        query: { ...period, page, limit: 20, ...filters },
      }),
    staleTime: STALE_MS,
    placeholderData: (previous) => previous,
  });
}
