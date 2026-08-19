import { useQuery } from '@tanstack/react-query';
import type { FinanceSummaryView, FuelControlView, LiveStatus } from 'shared';
import { api } from '../../shared/api/client';

export interface RecentEvent {
  id: string;
  eventType: string;
  eventTime: string;
  address: string | null;
  driver: { fullName: string } | null;
  trip: { tripNumber: string; vehicle: { plateNumber: string } | null } | null;
}

export interface LiveVehicle {
  vehicleId: string;
  plateNumber: string;
  status: LiveStatus;
  lastPosition: { lat: number; lng: number } | null;
}

export function useSummary(range: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['finance', 'summary', range],
    queryFn: async () =>
      (await api<FinanceSummaryView>('/finance/summary', { query: { ...range } })).data,
  });
}

export function useRecentEvents() {
  return useQuery({
    queryKey: ['events', 'recent'],
    queryFn: async () =>
      (await api<RecentEvent[]>('/events/recent', { query: { limit: 10 } })).data,
    refetchInterval: 60_000,
  });
}

export function useLiveFleet() {
  return useQuery({
    queryKey: ['tracking', 'live'],
    queryFn: async () => (await api<LiveVehicle[]>('/tracking/live')).data,
    refetchInterval: 30_000,
  });
}

/** The dashboard's alert count until the alerts centre (W-10) lands. */
export function useFuelAlerts() {
  return useQuery({
    queryKey: ['fuel', 'control', {}],
    queryFn: async () => (await api<FuelControlView>('/fuel/control')).data,
  });
}
