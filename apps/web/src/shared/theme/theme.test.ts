import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readThemeMode, resolveTheme } from './index';

function mockPrefersDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('defaults to dark — the product runs in cabs and control rooms', () => {
    expect(readThemeMode()).toBe('dark');
  });

  it('reads a stored choice and ignores junk', () => {
    localStorage.setItem('tc.theme', 'light');
    expect(readThemeMode()).toBe('light');
    localStorage.setItem('tc.theme', 'neon');
    expect(readThemeMode()).toBe('dark');
  });

  it('follows the OS only in system mode', () => {
    mockPrefersDark(true);
    expect(resolveTheme('system')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    mockPrefersDark(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('toggles the dark class on the document root', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
