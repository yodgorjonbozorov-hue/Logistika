import type { TripEventType } from 'shared';

/**
 * Offline event queue for the driver web app (TZ §3.1).
 *
 * The whole point is that a press is never lost and never double-counted:
 * every event carries a client-generated UUID, the backend batch endpoint is
 * idempotent, and the queue only drops an event once the server has actually
 * confirmed it. An event the server REJECTED stays visible as rejected — it is
 * never silently marked as synced.
 */

export type QueueState = 'pending' | 'rejected';

export interface QueuedEvent {
  clientEventId: string;
  tripId: string;
  eventType: TripEventType;
  eventTime: string;
  lat?: number;
  lng?: number;
  odometer?: number;
  comment?: string;
  photoFileIds?: string[];
  state: QueueState;
  /** Machine-readable reason from the server for a rejected event. */
  rejectedCode?: string;
}

export interface BatchResult {
  accepted: string[];
  duplicates: string[];
  rejected: Array<{ clientEventId: string; code: string }>;
}

const STORAGE_KEY = 'tc.driver.queue';

export function loadQueue(): QueuedEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is QueuedEvent =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as QueuedEvent).clientEventId === 'string',
    );
  } catch {
    // A corrupted queue must not brick the app; start clean instead.
    return [];
  }
}

export function saveQueue(queue: QueuedEvent[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function pendingEvents(queue: QueuedEvent[]): QueuedEvent[] {
  return queue.filter((event) => event.state === 'pending');
}

export function rejectedEvents(queue: QueuedEvent[]): QueuedEvent[] {
  return queue.filter((event) => event.state === 'rejected');
}

/** The payload shape of POST /events/batch — queue bookkeeping fields stripped. */
export function toPayload(event: QueuedEvent): Record<string, unknown> {
  const { state: _state, rejectedCode: _rejectedCode, ...payload } = event;
  return payload;
}

/**
 * Reconciles the queue with one server response.
 *
 * - accepted  → stored server-side, drop it
 * - duplicate → already stored (a retry of an earlier send), drop it too
 * - rejected  → KEEP, flagged, so the driver and the logist can see it
 * - unmentioned → still pending; a response that never covered it proves nothing
 */
export function applyBatchResult(queue: QueuedEvent[], result: BatchResult): QueuedEvent[] {
  const confirmed = new Set([...result.accepted, ...result.duplicates]);
  const rejected = new Map(result.rejected.map((item) => [item.clientEventId, item.code]));

  return queue
    .filter((event) => !confirmed.has(event.clientEventId))
    .map((event) =>
      rejected.has(event.clientEventId)
        ? { ...event, state: 'rejected' as const, rejectedCode: rejected.get(event.clientEventId) }
        : event,
    );
}

/** Drops the rejected entries once the driver has acknowledged them. */
export function clearRejected(queue: QueuedEvent[]): QueuedEvent[] {
  return queue.filter((event) => event.state !== 'rejected');
}
