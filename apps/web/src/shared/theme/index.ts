import { useCallback, useEffect, useState } from 'react';

/**
 * Theme is applied on the `<html>` element before React paints, so login,
 * public tracking and the app shell all open in the right palette.
 * Dark stays the default — the product is used in cabs and control rooms.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'tc.theme';
const DEFAULT_MODE: ThemeMode = 'dark';

function isMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function readThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return DEFAULT_MODE;
  const stored = localStorage.getItem(STORAGE_KEY);
  return isMode(stored) ? stored : DEFAULT_MODE;
}

function prefersDark(): boolean {
  return (
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches === true
  );
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? (prefersDark() ? 'dark' : 'light') : mode;
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', resolveTheme(mode) === 'dark');
}

/** Called once from the entry point, before the first render. */
export function initTheme(): void {
  applyTheme(readThemeMode());
}

export function useTheme(): {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(readThemeMode);

  useEffect(() => {
    applyTheme(mode);
    if (mode !== 'system' || typeof matchMedia === 'undefined') return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, next);
    setModeState(next);
  }, []);

  const resolved = resolveTheme(mode);

  return {
    mode,
    resolved,
    setMode,
    toggle: () => setMode(resolved === 'dark' ? 'light' : 'dark'),
  };
}
