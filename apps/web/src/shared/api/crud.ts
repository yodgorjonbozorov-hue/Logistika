import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export function useList<T>(resource: string, page: number, extraQuery?: Record<string, string>) {
  return useQuery({
    queryKey: [resource, { page, ...extraQuery }],
    queryFn: () => api<T[]>(`/${resource}`, { query: { page, limit: 20, ...extraQuery } }),
  });
}

export function useCrudMutations(resource: string) {
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: [resource] });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/${resource}`, { method: 'POST', body }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/${resource}/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/${resource}/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const post = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: string }) =>
      api(`/${resource}/${id}/${verb}`, { method: 'POST', body: {} }),
    onSuccess: invalidate,
  });
  return { create, update, remove, post };
}
