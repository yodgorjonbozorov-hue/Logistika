import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TripStatus } from 'shared';
import { api } from '../../shared/api/client';
import type {
  Client,
  Driver,
  Expense,
  GpsPoint,
  Income,
  Trip,
  TripEvent,
  Vehicle,
} from '../../shared/api/entities';

export interface TripFilter {
  page: number;
  status?: TripStatus;
  driverId?: string;
  vehicleId?: string;
  clientId?: string;
  from?: string;
  to?: string;
}

export function useTrips(filter: TripFilter) {
  return useQuery({
    queryKey: ['trips', filter],
    queryFn: () =>
      api<Trip[]>('/trips', {
        query: {
          page: filter.page,
          limit: 20,
          status: filter.status,
          driverId: filter.driverId,
          vehicleId: filter.vehicleId,
          clientId: filter.clientId,
          from: filter.from,
          to: filter.to,
        },
      }),
  });
}

export function useTrip(id: string) {
  return useQuery({
    queryKey: ['trips', id],
    queryFn: async () => (await api<Trip>(`/trips/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useTripEvents(tripId: string) {
  return useQuery({
    queryKey: ['events', tripId],
    queryFn: async () => (await api<TripEvent[]>('/events', { query: { tripId } })).data,
    enabled: Boolean(tripId),
  });
}

/** GPS points of the trip's vehicle inside the trip window (map tab). */
export function useTripTrack(trip: Trip | undefined) {
  const vehicleId = trip?.vehicleId ?? '';
  const from = trip?.startedAt ?? trip?.createdAt;
  const to = trip?.finishedAt ?? new Date().toISOString();
  return useQuery({
    queryKey: ['tracking', 'history', vehicleId, from, to],
    queryFn: async () =>
      (
        await api<GpsPoint[]>(`/tracking/vehicles/${vehicleId}/history`, {
          query: { from, to },
        })
      ).data,
    enabled: Boolean(vehicleId && from),
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
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const create = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api<Trip>('/trips', { method: 'POST', body })).data,
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api<Trip>(`/trips/${tripId}`, { method: 'PATCH', body })).data,
    onSuccess: invalidate,
  });
  const action = useMutation({
    mutationFn: async ({ verb, body }: { verb: string; body?: Record<string, unknown> }) =>
      (await api<Trip>(`/trips/${tripId}/${verb}`, { method: 'POST', body: body ?? {} })).data,
    onSuccess: invalidate,
  });
  return { create, update, action };
}
