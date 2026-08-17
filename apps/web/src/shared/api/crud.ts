import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/**
 * One replay key per user action, reused across retries.
 *
 * Generating a key inside mutationFn would mint a fresh one on every retry,
 * which is exactly the case idempotency exists for. Keying off the variables
 * object means TanStack Query's retry — which passes the same object — sends
 * the same key, while a new submit gets a new one.
 */
const keys = new WeakMap<object, string>();

function keyFor(variables: object): string {
  const existing = keys.get(variables);
  if (existing) return existing;
  const key = crypto.randomUUID();
  keys.set(variables, key);
  return key;
}

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
    mutationFn: (body: Record<string, unknown>) =>
      api(`/${resource}`, { method: 'POST', body, idempotencyKey: keyFor(body) }),
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
    mutationFn: (variables: { id: string; verb: string }) =>
      api(`/${resource}/${variables.id}/${variables.verb}`, {
        method: 'POST',
        body: {},
        idempotencyKey: keyFor(variables),
      }),
    onSuccess: invalidate,
  });
  return { create, update, remove, post };
}
