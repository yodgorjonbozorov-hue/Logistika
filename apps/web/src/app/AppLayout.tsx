import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LOCALES, UserRole, type Locale } from 'shared';
import { useAuth } from '../shared/auth/AuthContext';
import { setLocale } from '../shared/i18n';
import { Select } from '../shared/ui';
import { cn } from '../shared/utils/cn';

const THEME_KEY = 'tc.theme';

/**
 * Navigation entries carry the roles that may see them (M-15).
 *
 * This is UX only. Hiding a link is not a permission — the backend RolesGuard
 * denies the request regardless, and the RBAC e2e suite proves it endpoint by
 * endpoint. An ACCOUNTANT simply has no reason to look at a page whose every
 * action would 403.
 */
const NAV_ITEMS = [
  { to: '/map', key: 'nav.map', roles: [UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT] },
  { to: '/trips', key: 'nav.trips', roles: [UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT] },
  { to: '/vehicles', key: 'nav.vehicles', roles: [UserRole.OWNER, UserRole.LOGIST] },
  { to: '/drivers', key: 'nav.drivers', roles: [UserRole.OWNER, UserRole.LOGIST] },
  {
    to: '/clients',
    key: 'nav.clients',
    roles: [UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT],
  },
  {
    to: '/finance',
    key: 'nav.finance',
    roles: [UserRole.OWNER, UserRole.ACCOUNTANT, UserRole.LOGIST],
  },
] as const;

const LOCALE_LABELS: Record<Locale, string> = {
  'uz-latn': "O'zbekcha",
  'uz-cyrl': 'Ўзбекча',
  ru: 'Русский',
};

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const location = useLocation();
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) !== 'light');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  // Navigating on a phone must dismiss the drawer, or the new page is hidden
  // behind it.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // A drawer over a scrolling page scrolls the page behind it; lock the body
  // while it is open, and restore whatever was there before.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const visibleItems = NAV_ITEMS.filter(
    (item) => !user || (item.roles as readonly UserRole[]).includes(user.role),
  );

  const sidebar = (
    <>
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4 dark:border-white/10">
        <span className="text-lg font-extrabold">
          Truck<span className="text-accent">Control</span>
          <span className="ml-1 rounded bg-accent/20 px-1 text-xs font-bold text-accent">AI</span>
        </span>
        <button
          type="button"
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-2xl leading-none text-muted lg:hidden"
          onClick={() => setMenuOpen(false)}
          aria-label={t('common.close')}
        >
          ×
        </button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                // min-h-11 keeps every target at the 44px minimum touch size.
                'flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium transition',
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
        <label className="flex min-h-11 items-center gap-2 px-1 text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={dark}
            onChange={(e) => setDark(e.target.checked)}
          />
          {t('common.theme')}
        </label>
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="truncate text-xs text-muted">{user?.fullName}</span>
          <button
            className="min-h-11 px-1 text-xs text-danger hover:underline"
            onClick={() => void logout()}
          >
            {t('auth.logout')}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Phone/tablet: a top bar with a hamburger. The old fixed w-56 sidebar
          pushed the content off-screen below 640px and forced the whole page to
          scroll sideways (H-9). */}
      <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-navy lg:hidden">
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
          onClick={() => setMenuOpen(true)}
          aria-label={t('nav.openMenu')}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
        >
          <span aria-hidden="true" className="text-xl">
            ☰
          </span>
        </button>
        <span className="text-base font-extrabold">
          Truck<span className="text-accent">Control</span>
        </span>
      </header>

      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="app-sidebar"
        className={cn(
          'flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-white/10 dark:bg-navy',
          // Off-canvas drawer under lg, permanent column from lg up.
          'fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:static lg:z-auto lg:w-56 lg:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {sidebar}
      </aside>

      {/* min-w-0 is what actually stops a wide table from blowing out the flex
          row and giving the whole page a horizontal scrollbar. */}
      <main className="min-w-0 flex-1 p-3 sm:p-4 lg:p-6">
        <Outlet />
      </main>
    </div>
  );
}
