import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { LOCALES, type Locale } from 'shared';
import { useAuth } from '../shared/auth/AuthContext';
import { setLocale } from '../shared/i18n';
import { Select } from '../shared/ui';
import { cn } from '../shared/utils/cn';

const THEME_KEY = 'tc.theme';

const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard' },
  { to: '/map', key: 'nav.map' },
  { to: '/trips', key: 'nav.trips' },
  { to: '/vehicles', key: 'nav.vehicles' },
  { to: '/drivers', key: 'nav.drivers' },
  { to: '/clients', key: 'nav.clients' },
  { to: '/finance', key: 'nav.finance' },
  { to: '/fuel', key: 'nav.fuel' },
  { to: '/reports', key: 'nav.reports' },
  { to: '/alerts', key: 'nav.alerts' },
] as const;

const LOCALE_LABELS: Record<Locale, string> = {
  'uz-latn': "O'zbekcha",
  'uz-cyrl': 'Ўзбекча',
  ru: 'Русский',
};

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) !== 'light');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  const sidebarContent = (
    <>
      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) =>
              cn(
                'block rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-accent/15 text-accent'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10',
              )
            }
          >
            {t(item.key)}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-2 border-t border-gray-200 p-3 text-sm dark:border-white/10">
        <Select
          aria-label={t('common.language')}
          value={i18n.language}
          onChange={(e) => setLocale(e.target.value as Locale)}
        >
          {LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {LOCALE_LABELS[locale]}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 px-1 text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
          {t('common.theme')}
        </label>
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="truncate text-xs text-muted">{user?.fullName}</span>
          <button className="text-xs text-danger hover:underline" onClick={() => void logout()}>
            {t('auth.logout')}
          </button>
        </div>
      </div>
    </>
  );

  const logo = (
    <span>
      <span className="text-lg font-extrabold">
        Truck<span className="text-accent">Control</span>
      </span>
      <span className="ml-1 rounded bg-accent/20 px-1 text-xs font-bold text-accent">AI</span>
    </span>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-navy md:hidden">
        {logo}
        <button
          aria-label={t('common.menu')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-white/20"
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </header>
      {menuOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="mt-[52px] flex max-h-[calc(100vh-52px)] flex-col overflow-y-auto border-b border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-navy"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent}
          </div>
        </div>
      )}

      {/* desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-white/10 dark:bg-navy md:flex">
        <div className="border-b border-gray-200 px-4 py-4 dark:border-white/10">{logo}</div>
        {sidebarContent}
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
