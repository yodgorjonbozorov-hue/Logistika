/**
 * Reference-list queries shared by the dashboard, board and report screens.
 *
 * Target fleets are 5–40 vehicles (TZ), so a single page of a few hundred rows
 * covers a company's whole working set; the screens then derive their figures
 * client-side rather than adding an aggregate endpoint per widget.
 */
import { useQuery } from '@tanstack/react-query';
import type { TripStatus } from 'shared';
import { api } from './client';
import type {
  Client,
  Company,
  Driver,
  Expense,
  Income,
  LiveVehicle,
  Trip,
  User,
  Vehicle,
} from './entities';

/** How many rows the derived screens pull in one go. */
export const REFERENCE_LIMIT = 100;
export const TRIP_HISTORY_LIMIT = 200;

export function useAllTrips(limit = TRIP_HISTORY_LIMIT) {
  return useQuery({
    queryKey: ['trips', 'all', limit],
    queryFn: async () => (await api<Trip[]>('/trips', { query: { limit } })).data,
  });
}

export function useTripPage(filter: {
  page: number;
  limit?: number;
  status?: TripStatus | '';
  vehicleId?: string;
  driverId?: string;
  clientId?: string;
}) {
  const { page, limit = 10, status, vehicleId, driverId, clientId } = filter;
  return useQuery({
    queryKey: ['trips', 'page', filter],
    queryFn: () =>
      api<Trip[]>('/trips', {
        query: {
          page,
          limit,
          status: status || undefined,
          vehicleId: vehicleId || undefined,
          driverId: driverId || undefined,
          clientId: clientId || undefined,
        },
      }),
  });
}

export function useVehicles(limit = REFERENCE_LIMIT) {
  return useQuery({
    queryKey: ['vehicles', 'list', limit],
    queryFn: async () => (await api<Vehicle[]>('/vehicles', { query: { limit } })).data,
  });
}

export function useDrivers(limit = REFERENCE_LIMIT) {
  return useQuery({
    queryKey: ['drivers', 'list', limit],
    queryFn: async () => (await api<Driver[]>('/drivers', { query: { limit } })).data,
  });
}

export function useClients(limit = REFERENCE_LIMIT) {
  return useQuery({
    queryKey: ['clients', 'list', limit],
    queryFn: async () => (await api<Client[]>('/clients', { query: { limit } })).data,
  });
}

export function useIncomes(limit = REFERENCE_LIMIT) {
  return useQuery({
    queryKey: ['incomes', 'list', limit],
    queryFn: async () => (await api<Income[]>('/incomes', { query: { limit } })).data,
  });
}

export function useExpenses(limit = REFERENCE_LIMIT) {
  return useQuery({
    queryKey: ['expenses', 'list', limit],
    queryFn: async () => (await api<Expense[]>('/expenses', { query: { limit } })).data,
  });
}

export function useUsers(limit = REFERENCE_LIMIT) {
  return useQuery({
    queryKey: ['users', 'list', limit],
    queryFn: async () => (await api<User[]>('/users', { query: { limit } })).data,
  });
}

export function useCompany() {
  return useQuery({
    queryKey: ['company'],
    queryFn: async () => (await api<Company>('/company')).data,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLiveVehicles() {
  return useQuery({
    queryKey: ['tracking', 'live'],
    queryFn: async () => (await api<LiveVehicle[]>('/tracking/live')).data,
    refetchInterval: 30_000,
  });
}
