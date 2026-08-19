import { useQuery } from '@tanstack/react-query';
import type { AlertsView } from 'shared';
import { api } from '../../shared/api/client';

/** W-10 — derived on read, so a minute-old view is never stale by much. */
export function useAlerts() {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: async () => (await api<AlertsView>('/alerts')).data,
    refetchInterval: 60_000,
  });
}
