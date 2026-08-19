import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

/**
 * jsdom ships no `matchMedia`, and the mobile shell asks for it on first
 * render. This stub answers "desktop" and lets a test drive the answer by
 * setting `window.innerWidth` before rendering.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = max ? window.innerWidth <= Number(max[1]) : false;
    return {
      media: query,
      matches,
      onchange: null,
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}
