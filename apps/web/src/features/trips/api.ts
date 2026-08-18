import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TripStatus } from 'shared';
import { api } from '../../shared/api/client';
import { keyFor, onConflictRefetch } from '../../shared/api/crud';
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

/**
 * Reference lists for form selects (first 100 is plenty for 5–40 vehicle fleets).
 *
 * Cached for five minutes (TASK-4.2): every form that opens used to fire three
 * requests, so opening the trip dialog four times in a minute was twelve
 * queries for a fleet list that changes a few times a year. `withTotal: false`
 * on top — a picker never shows "1–100 of 137", so the count is pure cost.
 */
const REF_LIST_STALE_MS = 5 * 60 * 1000;
const REF_LIST_QUERY = { limit: 100, withTotal: false };

export function useRefLists() {
  const vehicles = useQuery({
    queryKey: ['vehicles', 'ref'],
    staleTime: REF_LIST_STALE_MS,
    queryFn: async () => (await api<Vehicle[]>('/vehicles', { query: REF_LIST_QUERY })).data,
  });
  const drivers = useQuery({
    queryKey: ['drivers', 'ref'],
    staleTime: REF_LIST_STALE_MS,
    queryFn: async () => (await api<Driver[]>('/drivers', { query: REF_LIST_QUERY })).data,
  });
  const clients = useQuery({
    queryKey: ['clients', 'ref'],
    staleTime: REF_LIST_STALE_MS,
    queryFn: async () => (await api<Client[]>('/clients', { query: REF_LIST_QUERY })).data,
  });
  return { vehicles, drivers, clients };
}

export function useTripMutations(tripId?: string) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['trips'] });
    // Completing a trip invoices it, so the money on screen moved too.
    void queryClient.invalidateQueries({ queryKey: ['incomes'] });
  };
  const onError = onConflictRefetch(invalidate);

  const create = useMutation({
    // Creating a trip is an idempotent endpoint: a double-clicked Save used to
    // be rejected outright, because the key the server requires was missing.
    mutationFn: (body: Record<string, unknown>) =>
      api<Trip>('/trips', { method: 'POST', body, idempotencyKey: keyFor(body) }),
    onSuccess: invalidate,
    onError,
  });
  const action = useMutation({
    mutationFn: (variables: { verb: string; body?: Record<string, unknown> }) =>
      api<Trip>(`/trips/${tripId}/${variables.verb}`, {
        method: 'POST',
        body: variables.body ?? {},
        idempotencyKey: keyFor(variables),
      }),
    onSuccess: invalidate,
    onError,
  });
  return { create, action };
}
