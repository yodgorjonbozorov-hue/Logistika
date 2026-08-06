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
  { to: '/trips', key: 'nav.trips' },
  { to: '/vehicles', key: 'nav.vehicles' },
  { to: '/drivers', key: 'nav.drivers' },
  { to: '/clients', key: 'nav.clients' },
  { to: '/finance', key: 'nav.finance' },
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

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-white/10 dark:bg-navy">
        <div className="border-b border-gray-200 px-4 py-4 dark:border-white/10">
          <span className="text-lg font-extrabold">
            Truck<span className="text-accent">Control</span>
          </span>
          <span className="ml-1 rounded bg-accent/20 px-1 text-xs font-bold text-accent">AI</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
