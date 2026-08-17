import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import { keyFor, onConflictRefetch } from './crud';

describe('onConflictRefetch', () => {
  it('refetches when the server rejects a write as stale', () => {
    const invalidate = vi.fn();

    onConflictRefetch(invalidate)(
      new ApiError('RESOURCE_CONFLICT', "Ma'lumot o'zgartirildi", undefined, 409),
    );

    // Without this the user keeps looking at the version that already lost.
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('leaves the cache alone for every other failure', () => {
    const invalidate = vi.fn();
    const onError = onConflictRefetch(invalidate);

    onError(new ApiError('VALIDATION_FAILED', "Noto'g'ri", undefined, 400));
    onError(new ApiError('AUTH_FORBIDDEN', "Ruxsat yo'q", undefined, 403));
    onError(new Error('network down'));

    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('keyFor', () => {
  it('gives one user action one key, however many times it is retried', () => {
    const variables = { id: 't1', verb: 'complete' };

    expect(keyFor(variables)).toBe(keyFor(variables));
  });

  it('gives a second submit its own key', () => {
    // A fresh key per submit is what makes the second click a second expense
    // only when the user really meant it — same object means same intent.
    expect(keyFor({ id: 't1', verb: 'complete' })).not.toBe(keyFor({ id: 't1', verb: 'complete' }));
  });
});
