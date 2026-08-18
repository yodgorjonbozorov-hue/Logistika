import { beforeEach, describe, expect, it } from 'vitest';
import { TripEventType } from 'shared';
import {
  applyBatchResult,
  clearRejected,
  loadQueue,
  pendingEvents,
  rejectedEvents,
  saveQueue,
  toPayload,
  type QueuedEvent,
} from './offlineQueue';

function event(id: string, state: QueuedEvent['state'] = 'pending'): QueuedEvent {
  return {
    clientEventId: id,
    tripId: 'trip-1',
    eventType: TripEventType.LOADED,
    eventTime: '2026-08-18T06:00:00.000Z',
    state,
  };
}

describe('driver offline queue', () => {
  beforeEach(() => localStorage.clear());

  it('drops accepted events', () => {
    const queue = [event('a'), event('b')];
    const next = applyBatchResult(queue, { accepted: ['a'], duplicates: [], rejected: [] });
    expect(next.map((e) => e.clientEventId)).toEqual(['b']);
  });

  it('drops duplicates — a retry of an already stored event is done, not pending', () => {
    const queue = [event('a')];
    const next = applyBatchResult(queue, { accepted: [], duplicates: ['a'], rejected: [] });
    expect(next).toEqual([]);
  });

  it('KEEPS rejected events flagged instead of marking them synced', () => {
    const queue = [event('a'), event('b')];
    const next = applyBatchResult(queue, {
      accepted: ['b'],
      duplicates: [],
      rejected: [{ clientEventId: 'a', code: 'NOT_FOUND' }],
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      clientEventId: 'a',
      state: 'rejected',
      rejectedCode: 'NOT_FOUND',
    });
    expect(pendingEvents(next)).toEqual([]);
    expect(rejectedEvents(next)).toHaveLength(1);
  });

  it('leaves events the response never mentioned as pending', () => {
    const queue = [event('a'), event('b')];
    const next = applyBatchResult(queue, { accepted: ['a'], duplicates: [], rejected: [] });
    expect(pendingEvents(next).map((e) => e.clientEventId)).toEqual(['b']);
  });

  it('does not resurrect a rejected event on a later unrelated batch', () => {
    let queue = applyBatchResult([event('a')], {
      accepted: [],
      duplicates: [],
      rejected: [{ clientEventId: 'a', code: 'NOT_FOUND' }],
    });
    queue = [...queue, event('c')];
    queue = applyBatchResult(queue, { accepted: ['c'], duplicates: [], rejected: [] });

    expect(queue).toHaveLength(1);
    expect(queue[0]!.state).toBe('rejected');
  });

  it('clears rejected entries only when asked', () => {
    const queue = [event('a', 'rejected'), event('b')];
    expect(clearRejected(queue).map((e) => e.clientEventId)).toEqual(['b']);
  });

  it('round-trips through localStorage and survives corruption', () => {
    saveQueue([event('a')]);
    expect(loadQueue()).toHaveLength(1);

    localStorage.setItem('tc.driver.queue', '{not json');
    expect(loadQueue()).toEqual([]);
  });

  it('strips bookkeeping fields from the API payload', () => {
    const payload = toPayload({ ...event('a', 'rejected'), rejectedCode: 'NOT_FOUND' });
    expect(payload).not.toHaveProperty('state');
    expect(payload).not.toHaveProperty('rejectedCode');
    expect(payload).toMatchObject({ clientEventId: 'a', tripId: 'trip-1' });
  });
});
