import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TripPnlView, TripStatus } from 'shared';
import { api } from '../../shared/api/client';
import type { Client, Driver, Expense, Income, Trip, Vehicle } from '../../shared/api/entities';

export function useTrips(filter: { page: number; status?: TripStatus }) {
  return useQuery({
    queryKey: ['trips', filter],
    queryFn: () =>
      api<Trip[]>('/trips', { query: { page: filter.page, limit: 20, status: filter.status } }),
  });
}

export function useTrip(id: string) {
  return useQuery({
    queryKey: ['trips', id],
    queryFn: async () => (await api<Trip>(`/trips/${id}`)).data,
  });
}

export function useTripFinance(tripId: string) {
  const expenses = useQuery({
    queryKey: ['expenses', { tripId }],
    queryFn: async () =>
      (await api<Expense[]>('/expenses', { query: { tripId, limit: 100 } })).data,
  });
  const incomes = useQuery({
    queryKey: ['incomes', { tripId }],
    queryFn: async () => (await api<Income[]>('/incomes', { query: { tripId, limit: 100 } })).data,
  });
  return { expenses, incomes };
}

/** TZ §6 profit and loss — computed by the backend, never in the browser. */
export function useTripPnl(tripId: string) {
  return useQuery({
    queryKey: ['finance', 'trip', tripId],
    queryFn: async () => (await api<TripPnlView>(`/finance/trips/${tripId}`)).data,
  });
}

/** Reference lists for form selects (first 100 is plenty for 5–40 vehicle fleets). */
export function useRefLists() {
  const vehicles = useQuery({
    queryKey: ['vehicles', 'ref'],
    queryFn: async () => (await api<Vehicle[]>('/vehicles', { query: { limit: 100 } })).data,
  });
  const drivers = useQuery({
    queryKey: ['drivers', 'ref'],
    queryFn: async () => (await api<Driver[]>('/drivers', { query: { limit: 100 } })).data,
  });
  const clients = useQuery({
    queryKey: ['clients', 'ref'],
    queryFn: async () => (await api<Client[]>('/clients', { query: { limit: 100 } })).data,
  });
  return { vehicles, drivers, clients };
}

export function useTripMutations(tripId?: string) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['trips'] });
  };

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Trip>('/trips', { method: 'POST', body }),
    onSuccess: invalidate,
  });
  const action = useMutation({
    mutationFn: ({ verb, body }: { verb: string; body?: Record<string, unknown> }) =>
      api<Trip>(`/trips/${tripId}/${verb}`, { method: 'POST', body: body ?? {} }),
    onSuccess: invalidate,
  });
  return { create, action };
}
