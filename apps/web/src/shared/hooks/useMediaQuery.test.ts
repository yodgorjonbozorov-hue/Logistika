import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOBILE_QUERY, useIsMobile, useMediaQuery } from './useMediaQuery';

/** A controllable MediaQueryList, so a test can flip the match at will. */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const list = {
    matches: initial,
    media: '',
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
  };
  const original = window.matchMedia;
  window.matchMedia = ((media: string) => {
    list.media = media;
    return list as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    list,
    set(matches: boolean) {
      list.matches = matches;
      for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
    },
    listenerCount: () => listeners.size,
    restore: () => {
      window.matchMedia = original;
    },
  };
}

let stub: ReturnType<typeof stubMatchMedia> | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  vi.restoreAllMocks();
});

describe('useMediaQuery', () => {
  it('reports the match on the very first render, with no flash of the wrong layout', () => {
    stub = stubMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(true);
  });

  it('follows the query when the viewport changes', () => {
    stub = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(false);

    act(() => stub!.set(true));
    expect(result.current).toBe(true);

    act(() => stub!.set(false));
    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    stub = stubMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(stub.listenerCount()).toBe(1);
    unmount();
    expect(stub.listenerCount()).toBe(0);
  });

  it('useIsMobile asks for the breakpoint the CSS uses', () => {
    stub = stubMatchMedia(true);
    renderHook(() => useIsMobile());
    expect(stub.list.media).toBe(MOBILE_QUERY);
    // Tailwind's `md` is 768px, so the phone shell must stop one pixel below it.
    expect(MOBILE_QUERY).toBe('(max-width: 767px)');
  });
});
