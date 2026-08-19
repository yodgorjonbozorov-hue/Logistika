import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TripStatus } from 'shared';
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

export interface TripFinanceSummary {
  tripId: string;
  agreedPrice: string;
  expenseTotal: string;
  incomeTotal: string;
  balance: string;
  expenseCount: number;
  incomeCount: number;
}

/**
 * Trip P&L (M-9).
 *
 * The totals come from a server-side aggregate rather than from summing a
 * fetched page: the old code pulled `limit: 100` rows and added them up in the
 * browser, so a trip with more than 100 transactions silently displayed a
 * WRONG balance with nothing to indicate it. The row list is still paged — it
 * is a table for humans — but the numbers no longer depend on it.
 */
export function useTripFinance(tripId: string, page = 1) {
  const summary = useQuery({
    queryKey: ['trips', tripId, 'finance'],
    queryFn: async () => (await api<TripFinanceSummary>(`/trips/${tripId}/finance`)).data,
  });
  const expenses = useQuery({
    queryKey: ['expenses', { tripId, page }],
    queryFn: () => api<Expense[]>('/expenses', { query: { tripId, page, limit: 20 } }),
  });
  const incomes = useQuery({
    queryKey: ['incomes', { tripId, page }],
    queryFn: () => api<Income[]>('/incomes', { query: { tripId, page, limit: 20 } }),
  });
  return { summary, expenses, incomes };
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
