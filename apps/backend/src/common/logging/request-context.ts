/**
 * Per-request correlation, without threading a parameter through every call.
 *
 * A production incident starts with one line — a 500, a slow query, a rejected
 * login — and the only useful next question is "what else happened in that
 * request?". Answering it needs an id that is on every line the request
 * produced, including the ones written deep inside a service that has no idea
 * an HTTP request exists.
 *
 * AsyncLocalStorage carries that id across every await in the request without a
 * global, which matters: a module-level "current request" variable is correct
 * until two requests overlap, which under any real load is always.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  /** Filled in by the auth guard once the token has been verified. */
  userId?: string;
  companyId?: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Adds the authenticated identity to the context already in flight.
 *
 * Mutation rather than a nested `run()`: the guard runs inside the request's
 * store, so re-entering would only shadow it for the guard's own frame and the
 * controller would still see the anonymous context.
 */
export function identifyRequest(userId: string, companyId: string | null): void {
  const context = storage.getStore();
  if (!context) return;
  context.userId = userId;
  context.companyId = companyId;
}
