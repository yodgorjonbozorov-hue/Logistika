import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LOCALES, type Locale } from 'shared';
import { useAuth } from '../shared/auth/AuthContext';
import { setLocale } from '../shared/i18n';
import { Badge, Button, Select } from '../shared/ui';
import { Icon } from '../shared/ui/icons';
import { cn } from '../shared/utils/cn';
import { NAV_BY_ROLE, type NavItem } from './navigation';

const THEME_KEY = 'tc.theme';
/** Below this many items the bottom bar shows them all; above it, the last slot is «More». */
const BOTTOM_BAR_SLOTS = 5;

const LOCALE_LABELS: Record<Locale, string> = {
  'uz-latn': "O'zbekcha",
  'uz-cyrl': 'Ўзбекча',
  ru: 'Русский',
};

function useDarkMode(): [boolean, (value: boolean) => void] {
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) !== 'light');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, setDark];
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 font-extrabold tracking-tight">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-navy">
        <Icon name="trips" className="h-5 w-5" strokeWidth={2} />
      </span>
      {!compact && (
        <span className="text-lg">
          Truck<span className="text-accent">Control</span>
          <span className="ml-1 rounded bg-accent/20 px-1 text-[10px] font-bold text-accent">
            AI
          </span>
        </span>
      )}
    </span>
  );
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <nav className="space-y-0.5">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/admin'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
              isActive
                ? 'bg-accent/15 text-accent'
                : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            )
          }
        >
          <Icon name={item.icon} />
          <span className="truncate">{t(item.labelKey)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function ThemeAndLanguage({ stacked }: { stacked?: boolean }) {
  const { t, i18n } = useTranslation();
  const [dark, setDark] = useDarkMode();
  return (
    <div className={cn('flex gap-2', stacked ? 'flex-col' : 'items-center')}>
      <Select
        aria-label={t('common.language')}
        value={i18n.language}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className={stacked ? undefined : 'w-36'}
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_LABELS[locale]}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        onClick={() => setDark(!dark)}
        aria-label={t('common.theme')}
        className={stacked ? 'justify-start' : undefined}
      >
        <Icon name={dark ? 'sun' : 'moon'} className="h-4 w-4" />
        {stacked ? t('common.theme') : null}
      </Button>
    </div>
  );
}

function UserMenu() {
  const { t } = useTranslation();
  const { user, role, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm hover:bg-surface-2"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/20 text-xs font-bold text-accent">
          {(user?.fullName ?? '?').charAt(0)}
        </span>
        <span className="hidden max-w-[10rem] truncate sm:block">{user?.fullName}</span>
        <Icon name="chevronRight" className="h-4 w-4 rotate-90 text-ink-2" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-line bg-surface p-3 shadow-pop animate-slide-up">
          <div className="mb-2 border-b border-line pb-2">
            <div className="truncate font-semibold">{user?.fullName}</div>
            <div className="truncate text-xs text-ink-2">{user?.email ?? user?.phone}</div>
            {role ? (
              <div className="mt-1.5">
                <Badge tone="orange">{t(`roles.${role}`)}</Badge>
              </div>
            ) : null}
          </div>
          <ThemeAndLanguage stacked />
          <Button
            variant="ghost"
            className="mt-2 w-full justify-start"
            onClick={() => void logout()}
          >
            <Icon name="logout" className="h-4 w-4" />
            {t('auth.logout')}
          </Button>
        </div>
      )}
    </div>
  );
}

function NotificationsButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative hidden sm:block">
      <Button
        variant="secondary"
        aria-label={t('nav.notifications')}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-line bg-surface p-4 text-sm shadow-pop animate-slide-up">
          <div className="font-semibold">{t('nav.notifications')}</div>
          {/* The alerts module (W-10) lands with stage 7 — no invented items here. */}
          <p className="mt-1 text-xs text-ink-2">{t('common.comingSoonNote')}</p>
        </div>
      )}
    </div>
  );
}

function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // Trips are the only searchable list today; the field filters that page.
    navigate(term.trim() ? `/trips?q=${encodeURIComponent(term.trim())}` : '/trips');
  }

  return (
    <form onSubmit={onSubmit} className="relative hidden min-w-0 flex-1 max-w-md lg:block">
      <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" />
      <input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={t('common.searchPlaceholder')}
        aria-label={t('common.search')}
        className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-accent"
      />
    </form>
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [more, setMore] = useState(false);

  const items = role ? NAV_BY_ROLE[role] : [];
  const fitsBottomBar = items.length <= BOTTOM_BAR_SLOTS;
  const bottomItems = fitsBottomBar ? items : items.slice(0, BOTTOM_BAR_SLOTS - 1);
  const overflowItems = fitsBottomBar ? [] : items.slice(BOTTOM_BAR_SLOTS - 1);

  // Route changes close every transient surface.
  useEffect(() => {
    setDrawer(false);
    setMore(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <div className="border-b border-line px-4 py-4">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavList items={items} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/95 px-3 py-2.5 backdrop-blur sm:px-4">
          <Button
            variant="ghost"
            className="lg:hidden"
            aria-label={t('common.openMenu')}
            onClick={() => setDrawer(true)}
          >
            <Icon name="menu" />
          </Button>
          <div className="lg:hidden">
            <Logo compact />
          </div>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <NotificationsButton />
            <UserMenu />
          </div>
        </header>

        <main className="min-w-0 flex-1 p-3 pb-24 sm:p-5 lg:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/50 animate-fade-in" />
          <div
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-pop"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-4">
              <Logo />
              <Button
                variant="ghost"
                aria-label={t('common.close')}
                onClick={() => setDrawer(false)}
              >
                <Icon name="close" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <NavList items={items} onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 backdrop-blur lg:hidden">
        {bottomItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/admin'}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium transition',
                isActive ? 'text-accent' : 'text-ink-2',
              )
            }
          >
            <Icon name={item.icon} className="h-5 w-5" />
            <span className="w-full truncate text-center">{t(item.labelKey)}</span>
          </NavLink>
        ))}
        {overflowItems.length > 0 && (
          <button
            onClick={() => setMore(true)}
            className="flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium text-ink-2"
          >
            <Icon name="more" className="h-5 w-5" />
            <span>{t('nav.more')}</span>
          </button>
        )}
      </nav>

      {more && (
        <div className="fixed inset-0 z-50 flex items-end lg:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-0 bg-black/50 animate-fade-in" />
          <div
            className="relative w-full rounded-t-2xl border-t border-line bg-surface p-4 pb-8 shadow-pop animate-slide-up"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">{t('nav.menu')}</span>
              <Button variant="ghost" onClick={() => setMore(false)} aria-label={t('common.close')}>
                <Icon name="close" />
              </Button>
            </div>
            <NavList items={overflowItems} onNavigate={() => setMore(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
