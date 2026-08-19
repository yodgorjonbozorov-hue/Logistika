import { useQuery } from '@tanstack/react-query';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LOCALES, TripStatus, type Locale } from 'shared';
import { api } from '../shared/api/client';
import type { Company } from '../shared/api/entities';
import { useAuth } from '../shared/auth/AuthContext';
import { setLocale } from '../shared/i18n';
import { Avatar, Button, Icon, PageSkeleton, Sheet, initialsOf } from '../shared/ui';
import { AccountMenu } from './AccountMenu';
import { cn } from '../shared/utils/cn';

interface NavItem {
  to: string;
  key: string;
  icon: string;
}

const NAV_MAIN: readonly NavItem[] = [
  { to: '/overview', key: 'nav.overview', icon: 'squares-four' },
  { to: '/trips', key: 'nav.trips', icon: 'path' },
  { to: '/map', key: 'nav.map', icon: 'map-trifold' },
  { to: '/vehicles', key: 'nav.vehicles', icon: 'truck' },
  { to: '/drivers', key: 'nav.drivers', icon: 'steering-wheel' },
  { to: '/cargo', key: 'nav.cargo', icon: 'package' },
  { to: '/clients', key: 'nav.clients', icon: 'users-three' },
  { to: '/finance', key: 'nav.finance', icon: 'currency-circle-dollar' },
  { to: '/documents', key: 'nav.documents', icon: 'files' },
  { to: '/reports', key: 'nav.reports', icon: 'chart-line-up' },
];

const NAV_ADMIN: readonly NavItem[] = [
  { to: '/users', key: 'nav.users', icon: 'user-gear' },
  { to: '/settings', key: 'nav.settings', icon: 'gear-six' },
];

/**
 * The five destinations the bottom bar carries on a phone. Everything else in
 * NAV_MAIN/NAV_ADMIN lives one tap away in the menu sheet — a tab bar past five
 * slots stops being tappable at 320px.
 */
const TAB_ITEMS: readonly NavItem[] = [
  { to: '/overview', key: 'nav.short.overview', icon: 'squares-four' },
  { to: '/trips', key: 'nav.short.trips', icon: 'path' },
  { to: '/drivers', key: 'nav.short.drivers', icon: 'steering-wheel' },
  { to: '/vehicles', key: 'nav.short.vehicles', icon: 'truck' },
  { to: '/reports', key: 'nav.short.reports', icon: 'chart-line-up' },
];

/** What the menu sheet lists, in the order a phone user reaches for it. */
const MENU_ITEMS: readonly NavItem[] = [
  { to: '/map', key: 'nav.map', icon: 'map-trifold' },
  { to: '/cargo', key: 'nav.cargo', icon: 'package' },
  { to: '/clients', key: 'nav.clients', icon: 'users-three' },
  { to: '/finance', key: 'nav.finance', icon: 'currency-circle-dollar' },
  { to: '/documents', key: 'nav.documents', icon: 'files' },
  { to: '/users', key: 'nav.users', icon: 'user-gear' },
  { to: '/settings', key: 'nav.settings', icon: 'gear-six' },
];

/** Room for three side by side on a 320px screen. */
const LOCALE_SHORT: Record<Locale, string> = {
  'uz-latn': 'Uz',
  'uz-cyrl': 'Ўз',
  ru: 'Ру',
};

/** The count badge next to "Reyslar" — open trips the company still owes work on. */
function useOpenTripCount(): number | null {
  const results = useQuery({
    queryKey: ['trips', 'open-count'],
    queryFn: async () => {
      const open = [TripStatus.DRAFT, TripStatus.ASSIGNED, TripStatus.IN_PROGRESS];
      const counts = await Promise.all(
        open.map(async (status) => {
          const { meta } = await api<unknown[]>('/trips', { query: { limit: 1, status } });
          return meta?.pagination?.total ?? 0;
        }),
      );
      return counts.reduce((a, b) => a + b, 0);
    },
    staleTime: 60_000,
  });
  return results.data ?? null;
}

export function AppLayout() {
  const { t } = useTranslation();
  const openTrips = useOpenTripCount();

  const { data: company } = useQuery({
    queryKey: ['company'],
    queryFn: async () => (await api<Company>('/company')).data,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="tc-app-height flex bg-bg font-body text-sm text-ink">
      <div className="hidden shrink-0 md:flex">
        <Sidebar openTrips={openTrips} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="hidden md:block">
          <TopBar companyName={company?.name ?? null} />
        </div>
        <MobileTopBar companyName={company?.name ?? null} />
        {/* The bottom padding clears the tab bar plus the home indicator. */}
        <main className="flex-1 overflow-y-auto px-4 pb-[calc(76px+env(safe-area-inset-bottom))] pt-4 md:px-[26px] md:pb-10 md:pt-[22px]">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <TabBar openTrips={openTrips} />
      <span className="sr-only">{t('app.title')}</span>
    </div>
  );
}

// ---------- Mobile shell ----------

/** The phone header: identity, whose company this is, alerts, and the menu. */
function MobileTopBar({ companyName }: { companyName: string | null }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header
        className="sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-divider bg-bg px-3 md:hidden"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex h-[52px] w-full items-center gap-2">
          <div
            className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md border border-accent text-accent"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}
          >
            <Icon name="truck" size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold leading-tight">
              Truck<span className="text-accent">Control</span>
            </div>
            <div className="truncate text-[11px] leading-tight text-neutral-500">
              {companyName ?? t('common.notSet')}
            </div>
          </div>
          <button
            type="button"
            aria-label={t('common.notifications')}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-400"
          >
            <Icon name="bell" size={19} />
            <span className="tc-pulse absolute right-[11px] top-[11px] h-[7px] w-[7px] rounded-full bg-accent" />
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t('nav.menu')}
            aria-expanded={menuOpen}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-400"
          >
            <Icon name="list" size={20} />
          </button>
        </div>
      </header>
      <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

/** The five primary destinations, fixed to the bottom edge. */
function TabBar({ openTrips }: { openTrips: number | null }) {
  const { t } = useTranslation();
  return (
    <nav className="tabbar" aria-label={t('nav.groupMain')}>
      {TAB_ITEMS.map((item) => (
        <NavLink key={item.to} to={item.to} className="tab">
          {({ isActive }) => (
            <>
              <span className="relative">
                <Icon
                  name={item.icon}
                  size={20}
                  style={{ color: isActive ? 'var(--color-accent)' : 'var(--color-neutral-500)' }}
                />
                {item.to === '/trips' && openTrips ? (
                  <span className="absolute -right-3 top-[-3px] min-w-[16px] rounded-full bg-accent-800 px-[4px] text-center text-[9.5px] font-semibold leading-[15px] text-accent-200">
                    {openTrips > 99 ? '99+' : openTrips}
                  </span>
                ) : null}
              </span>
              <span>{t(item.key)}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/** Everything the tab bar could not hold, plus language and sign-out. */
function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const location = useLocation();

  // A tap that navigates should also dismiss the sheet it was tapped in — but
  // only on an actual route change, never on the render that opened it.
  const path = location.pathname;
  const shownAt = useRef(path);
  useEffect(() => {
    if (shownAt.current === path) return;
    shownAt.current = path;
    onClose();
  }, [path, onClose]);

  return (
    <Sheet open={open} onClose={onClose} title={t('nav.menu')}>
      <div className="mb-3 flex items-center gap-2.5 rounded-md bg-neutral-900/60 p-2.5">
        <Avatar initials={initialsOf(user?.fullName)} size={36} tone="accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{user?.fullName ?? '—'}</div>
          <div className="text-[12px] text-neutral-500">{user ? t(`roles.${user.role}`) : ''}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {MENU_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex min-h-[52px] items-center gap-2.5 rounded-md border px-3 text-[13px]',
                isActive
                  ? 'border-accent-700 text-accent-200'
                  : 'border-neutral-800 text-neutral-300',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  name={item.icon}
                  size={18}
                  style={{ color: isActive ? 'var(--color-accent)' : 'var(--color-neutral-500)' }}
                />
                <span className="min-w-0 truncate">{t(item.key)}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>

      <div className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-neutral-600">
        {t('common.language')}
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            onClick={() => setLocale(locale)}
            className={cn(
              'min-h-[44px] rounded-md border px-2 text-[12.5px]',
              i18n.language === locale
                ? 'border-accent-700 text-accent-200'
                : 'border-neutral-800 text-neutral-400',
            )}
          >
            {LOCALE_SHORT[locale]}
          </button>
        ))}
      </div>

      <a
        href="https://docs.truckcontrol.uz"
        target="_blank"
        rel="noreferrer"
        className="mt-4 flex min-h-[48px] items-center gap-2.5 rounded-md border border-neutral-800 px-3 text-[13px] text-neutral-300"
      >
        <Icon name="question" size={18} style={{ color: 'var(--color-neutral-500)' }} />
        {t('nav.help')}
      </a>

      <button
        type="button"
        onClick={() => void logout()}
        className="mt-2 flex min-h-[48px] w-full items-center gap-2.5 rounded-md border border-neutral-800 px-3 text-[13px] text-danger-text"
      >
        <Icon name="sign-out" size={18} />
        {t('auth.logout')}
      </button>
    </Sheet>
  );
}

// ---------- Sidebar ----------

function Sidebar({ openTrips }: { openTrips: number | null }) {
  const { t } = useTranslation();

  return (
    <aside
      className="flex w-[228px] shrink-0 flex-col border-r border-divider"
      style={{
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--color-bg) 88%, black), color-mix(in srgb, var(--color-bg) 72%, black))',
      }}
    >
      <div className="flex items-center gap-2.5 px-4 pb-[14px] pt-4">
        <div
          className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-accent text-accent"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}
        >
          <Icon name="truck" size={17} />
        </div>
        <div className="flex items-baseline gap-[5px]">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">
            Truck<span className="text-accent">Control</span>
          </span>
          <span className="rounded-sm bg-accent-900 px-[5px] py-px text-[9.5px] font-semibold tracking-[0.08em] text-accent-300">
            AI
          </span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2.5 pt-1">
        <NavGroupLabel className="pt-2">{t('nav.groupMain')}</NavGroupLabel>
        {NAV_MAIN.map((item) => (
          <NavItemLink
            key={item.to}
            item={item}
            count={item.key === 'nav.trips' ? openTrips : null}
          />
        ))}
        <NavGroupLabel className="pt-[14px]">{t('nav.groupAdmin')}</NavGroupLabel>
        {NAV_ADMIN.map((item) => (
          <NavItemLink key={item.to} item={item} count={null} />
        ))}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-divider p-2.5">
        <a
          href="https://docs.truckcontrol.uz"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-md px-2 py-[7px] text-[13px] text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-400"
        >
          <Icon name="question" size={16} />
          <span>{t('nav.help')}</span>
        </a>
        <AccountMenu />
      </div>
    </aside>
  );
}

function NavGroupLabel({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-neutral-600',
        className,
      )}
    >
      {children}
    </div>
  );
}

function NavItemLink({ item, count }: { item: NavItem; count: number | null }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-2.5 rounded-md px-2 py-[7px] text-[13px]',
          isActive ? 'text-accent-200' : 'text-neutral-400 hover:bg-neutral-800/50',
        )
      }
      style={({ isActive }) =>
        isActive
          ? {
              background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
              boxShadow: 'inset 2px 0 0 var(--color-accent)',
            }
          : undefined
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            name={item.icon}
            size={16}
            style={{ color: isActive ? 'var(--color-accent)' : 'var(--color-neutral-500)' }}
          />
          <span className="flex-1">{t(item.key)}</span>
          {count ? (
            <span className="rounded-full bg-accent-900 px-[7px] text-[11px] font-semibold leading-[17px] text-accent-300">
              {count}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

// ---------- Header ----------

function TopBar({ companyName }: { companyName: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <header className="flex h-[54px] shrink-0 items-center gap-3 border-b border-divider px-5">
      {/* At 1024 up this is the handoff's fixed 320px field; between 768 and
          1024 it gives way so the header cannot overflow a tablet. */}
      <label className="flex w-full min-w-0 max-w-[320px] cursor-text items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/70 px-3 py-[7px] text-[13px] text-neutral-500 focus-within:border-neutral-700 hover:border-neutral-700 lg:w-[320px]">
        <Icon name="magnifying-glass" size={15} />
        <input
          type="search"
          placeholder={t('common.searchPlaceholder')}
          aria-label={t('common.search')}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-neutral-500"
        />
        <span className="hidden rounded-sm border border-neutral-800 px-[5px] text-[11px] text-neutral-600 lg:inline">
          ⌘K
        </span>
      </label>
      <div className="flex-1" />
      <div className="hidden items-center gap-2 rounded-md border border-neutral-800 px-3 py-1.5 text-[13px] text-neutral-300 hover:border-neutral-700 lg:flex">
        <Icon name="buildings" size={15} style={{ color: 'var(--color-neutral-500)' }} />
        <span className="max-w-[200px] truncate">{companyName ?? t('common.notSet')}</span>
      </div>
      <button
        type="button"
        aria-label={t('common.notifications')}
        className="relative flex h-[34px] w-[34px] items-center justify-center rounded-md border border-neutral-800 text-neutral-400 hover:border-neutral-700"
      >
        <Icon name="bell" size={17} />
        <span className="tc-pulse absolute right-2 top-[7px] h-[7px] w-[7px] rounded-full bg-accent" />
      </button>
      <Button icon="plus" onClick={() => navigate('/trips/new')}>
        {t('trips.new')}
      </Button>
    </header>
  );
}
