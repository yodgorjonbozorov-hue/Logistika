import { useEffect, useState } from 'react';

/** Tailwind's `md`. Below it the app runs its phone shell, above it the desktop one. */
export const MOBILE_QUERY = '(max-width: 767px)';

/**
 * Subscribes to a media query. Reads the match synchronously on first render so
 * the first paint is already the right layout — a mobile shell that flashes the
 * desktop one for a frame looks broken on a phone.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
