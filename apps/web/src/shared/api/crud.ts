import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isConflict } from './client';

/**
 * One replay key per user action, reused across retries.
 *
 * Generating a key inside mutationFn would mint a fresh one on every retry,
 * which is exactly the case idempotency exists for. Keying off the variables
 * object means TanStack Query's retry — which passes the same object — sends
 * the same key, while a new submit gets a new one.
 */
const keys = new WeakMap<object, string>();

export function keyFor(variables: object): string {
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

/**
 * Refetches whenever a write is rejected as stale.
 *
 * A 409 means the screen is showing something the server no longer agrees
 * with. Leaving that copy up invites the user to press Save again and get the
 * same refusal; refetching replaces it with what actually happened, and the
 * error message on screen (from the server, already translated) tells them why
 * their edit did not land.
 */
export function onConflictRefetch(invalidate: () => void) {
  return (error: unknown) => {
    if (isConflict(error)) invalidate();
  };
}

export function useCrudMutations(resource: string) {
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: [resource] });
  const onError = onConflictRefetch(invalidate);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/${resource}`, { method: 'POST', body, idempotencyKey: keyFor(body) }),
    onSuccess: invalidate,
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/${resource}/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/${resource}/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError,
  });
  const post = useMutation({
    // `body` carries what the verb needs — a reversal's reason, for instance.
    // Still keyed off the variables object, so a retry replays the same key
    // and a fresh click gets a new one.
    mutationFn: (variables: { id: string; verb: string; body?: Record<string, unknown> }) =>
      api(`/${resource}/${variables.id}/${variables.verb}`, {
        method: 'POST',
        body: variables.body ?? {},
        idempotencyKey: keyFor(variables),
      }),
    onSuccess: invalidate,
    onError,
  });
  return { create, update, remove, post };
}
