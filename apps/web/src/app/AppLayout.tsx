import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
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

function BrandMark() {
  return (
    <>
      <span className="text-lg font-extrabold">
        Truck<span className="text-accent">Control</span>
      </span>
      <span className="ml-1 rounded bg-accent/20 px-1 text-xs font-bold text-accent">AI</span>
    </>
  );
}

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const location = useLocation();
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) !== 'light');
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  // Navigating on a phone means the drawer has done its job.
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen lg:flex">
      {/* Phone/tablet top bar — the drawer trigger lives here. */}
      <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 lg:hidden dark:border-white/10 dark:bg-navy">
        <button
          type="button"
          aria-label={t('common.menu')}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((open) => !open)}
          className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
        >
          <span aria-hidden className="block text-xl leading-none">
            {navOpen ? '✕' : '☰'}
          </span>
        </button>
        <BrandMark />
      </header>

      {navOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          'no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-gray-200 bg-white transition-transform lg:static lg:z-auto lg:w-56 lg:shrink-0 lg:translate-x-0 dark:border-white/10 dark:bg-navy',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="hidden border-b border-gray-200 px-4 py-4 lg:block dark:border-white/10">
          <BrandMark />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'block rounded-lg px-3 py-2.5 text-sm font-medium transition lg:py-2',
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
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
