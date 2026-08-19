import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FuelControlView } from 'shared';
import { api } from '../../shared/api/client';

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
  vehicle?: { plateNumber: string } | null;
}

export function useFuelControl(range: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['fuel', 'control', range],
    queryFn: async () =>
      (await api<FuelControlView>('/fuel/control', { query: { ...range } })).data,
  });
}

export function useFuelLogs(page: number) {
  return useQuery({
    queryKey: ['fuel', 'logs', page],
    queryFn: () => api<FuelLog[]>('/fuel', { query: { page, limit: 20 } }),
  });
}

export function useFuelMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['fuel'] });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/fuel', { method: 'POST', body }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/fuel/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  return { create, remove };
}
