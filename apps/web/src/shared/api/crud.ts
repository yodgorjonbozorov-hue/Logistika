import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './client';

export function useList<T>(resource: string, page: number, extraQuery?: Record<string, string>) {
  return useQuery({
    queryKey: [resource, { page, ...extraQuery }],
    queryFn: () => api<T[]>(`/${resource}`, { query: { page, limit: 20, ...extraQuery } }),
    // Keeps the previous page on screen while the next one loads, so typing in
    // a search box does not flash an empty table on every keystroke.
    placeholderData: (previous) => previous,
  });
}

/**
 * Debounced search term for list pages (L-5).
 *
 * Filtering happens on the server — the page only ever holds 20 rows, so
 * filtering in the browser would search the page rather than the data.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
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
