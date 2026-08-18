import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LOCALES, TripStatus, type Locale } from 'shared';
import { api } from '../shared/api/client';
import type { Company } from '../shared/api/entities';
import { useAuth } from '../shared/auth/AuthContext';
import { setLocale } from '../shared/i18n';
import { Avatar, Button, Icon, initialsOf } from '../shared/ui';
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

const LOCALE_LABELS: Record<Locale, string> = {
  'uz-latn': "O'zbek (lotin)",
  'uz-cyrl': 'Ўзбек (кирил)',
  ru: 'Русский',
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
    <div className="flex h-screen bg-bg font-body text-sm text-ink">
      <Sidebar openTrips={openTrips} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar companyName={company?.name ?? null} />
        <main className="flex-1 overflow-y-auto px-[26px] pb-10 pt-[22px]">
          <Outlet />
        </main>
      </div>
      <span className="sr-only">{t('app.title')}</span>
    </div>
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
        <UserMenu />
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

/** The sidebar footer identity row — opens language choice and sign-out. */
function UserMenu() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {open ? (
        <div className="card absolute bottom-full left-0 z-30 mb-1.5 w-full p-1.5 shadow-md">
          <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-neutral-600">
            {t('common.language')}
          </div>
          {LOCALES.map((locale) => (
            <button
              key={locale}
              type="button"
              onClick={() => setLocale(locale)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                i18n.language === locale
                  ? 'text-accent-200'
                  : 'text-neutral-400 hover:bg-neutral-800/50',
              )}
            >
              <Icon
                name={i18n.language === locale ? 'check' : 'translate'}
                size={14}
                style={{ opacity: i18n.language === locale ? 1 : 0.5 }}
              />
              {LOCALE_LABELS[locale]}
            </button>
          ))}
          <div className="my-1 h-px bg-divider" />
          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-danger-text hover:bg-neutral-800/50"
          >
            <Icon name="sign-out" size={14} />
            {t('auth.logout')}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-neutral-800/50"
      >
        <Avatar initials={initialsOf(user?.fullName)} size={30} tone="accent" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-[1.2]">
            {user?.fullName ?? '—'}
          </span>
          <span className="block text-[11px] text-neutral-500">
            {user ? t(`roles.${user.role}`) : ''}
          </span>
        </span>
        <Icon name="caret-up-down" size={14} style={{ color: 'var(--color-neutral-600)' }} />
      </button>
    </div>
  );
}

// ---------- Header ----------

function TopBar({ companyName }: { companyName: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <header className="flex h-[54px] shrink-0 items-center gap-3 border-b border-divider px-5">
      <label className="flex w-[320px] cursor-text items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/70 px-3 py-[7px] text-[13px] text-neutral-500 focus-within:border-neutral-700 hover:border-neutral-700">
        <Icon name="magnifying-glass" size={15} />
        <input
          type="search"
          placeholder={t('common.searchPlaceholder')}
          aria-label={t('common.search')}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-neutral-500"
        />
        <span className="rounded-sm border border-neutral-800 px-[5px] text-[11px] text-neutral-600">
          ⌘K
        </span>
      </label>
      <div className="flex-1" />
      <div className="flex items-center gap-2 rounded-md border border-neutral-800 px-3 py-1.5 text-[13px] text-neutral-300 hover:border-neutral-700">
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
