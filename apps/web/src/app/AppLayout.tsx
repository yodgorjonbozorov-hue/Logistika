import { useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { LOCALES, UserRole, type Locale } from 'shared';
import { useAuth } from '../shared/auth/AuthContext';
import { setLocale } from '../shared/i18n';
import { useTheme } from '../shared/theme';
import {
  IconBriefcase,
  IconClose,
  IconGrid,
  IconGlobe,
  IconLogout,
  IconMap,
  IconMenu,
  IconMoon,
  IconRoute,
  IconSun,
  IconSparkles,
  IconTruck,
  IconUsers,
  IconWallet,
  IconButton,
  LogixaLogo,
  Select,
  type IconProps,
} from '../shared/ui';
import { cn } from '../shared/utils/cn';

interface NavItem {
  to: string;
  key: string;
  Icon: ComponentType<IconProps>;
  /** Absent means every signed-in role; money screens are narrower. */
  roles?: UserRole[];
}

const FINANCE_ROLES = [UserRole.OWNER, UserRole.ACCOUNTANT];

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', key: 'nav.dashboard', Icon: IconGrid, roles: FINANCE_ROLES },
  { to: '/map', key: 'nav.map', Icon: IconMap },
  { to: '/trips', key: 'nav.trips', Icon: IconRoute },
  { to: '/vehicles', key: 'nav.vehicles', Icon: IconTruck },
  { to: '/drivers', key: 'nav.drivers', Icon: IconUsers },
  { to: '/clients', key: 'nav.clients', Icon: IconBriefcase },
  { to: '/finance', key: 'nav.finance', Icon: IconWallet, roles: FINANCE_ROLES },
  { to: '/fuel', key: 'nav.fuel', Icon: IconSparkles },
];

/** Only what this role may open — the API enforces the same list. */
function navFor(role: UserRole | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || (role && item.roles.includes(role)));
}

const LOCALE_LABELS: Record<Locale, string> = {
  'uz-latn': "O'zbekcha",
  'uz-cyrl': 'Ўзбекча',
  ru: 'Русский',
};

function initialsOf(name: string | undefined): string {
  if (!name) return '—';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex items-center gap-3 rounded-md px-3 py-2.5 text-subhead font-medium',
    'transition-colors duration-[var(--duration-fast)] ease-ios',
    isActive ? 'bg-brand-primary text-white shadow-xs' : 'text-white/60 hover:bg-white/10',
  );
}

/** Sidebar on desktop, slide-over drawer on a phone — one markup, one style. */
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const { resolved, toggle } = useTheme();
  const items = navFor(user?.role);

  return (
    <div className="flex h-full flex-col bg-brand-secondary text-white">
      <div className="flex items-center justify-between px-4 py-5">
        <LogixaLogo tone="light" size="md" />
        {onNavigate ? (
          <IconButton
            aria-label={t('common.close')}
            size="sm"
            className="text-white/70 hover:bg-white/10 lg:hidden"
            onClick={onNavigate}
          >
            <IconClose size={18} />
          </IconButton>
        ) : null}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {items.map(({ to, key, Icon }) => (
          <NavLink key={to} to={to} className={navLinkClass} onClick={onNavigate}>
            <Icon size={19} />
            {t(key)}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-3 border-t border-white/10 p-3">
        <div className="flex items-center gap-2">
          <Select
            aria-label={t('common.language')}
            value={i18n.language}
            onChange={(event) => setLocale(event.target.value as Locale)}
            className="h-10 border-white/15 bg-white/[0.06] text-white"
          >
            {LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {LOCALE_LABELS[locale]}
              </option>
            ))}
          </Select>
          <IconButton
            aria-label={t('common.theme')}
            className="shrink-0 text-white/70 hover:bg-white/10"
            onClick={toggle}
          >
            {resolved === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </IconButton>
        </div>

        <div className="flex items-center gap-3 rounded-md px-1 py-1">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-primary text-caption font-semibold">
            {initialsOf(user?.fullName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-subhead font-medium">{user?.fullName}</span>
            <span className="block truncate text-caption text-white/50">
              {user?.role ? t(`roles.${user.role}`) : ''}
            </span>
          </span>
          <IconButton
            aria-label={t('auth.logout')}
            size="sm"
            className="text-white/60 hover:bg-white/10"
            onClick={() => void logout()}
          >
            <IconLogout size={18} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The five destinations a phone can reach with a thumb; the rest stay in the menu.
  const mobileItems = navFor(user?.role).slice(0, 5);

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-50 animate-lx-fade-in bg-brand-secondary/50 backdrop-blur-[2px] lg:hidden"
          onClick={() => setDrawerOpen(false)}
          role="presentation"
        >
          <div
            className="h-full w-[272px] max-w-[82vw] animate-lx-rise shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="safe-top sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface/85 px-3 py-2.5 backdrop-blur-xl lg:hidden">
          <IconButton aria-label={t('nav.menu')} onClick={() => setDrawerOpen(true)}>
            <IconMenu size={20} />
          </IconButton>
          <LogixaLogo size="sm" />
          <IconButton
            aria-label={t('common.language')}
            onClick={() => {
              const next =
                LOCALES[(LOCALES.indexOf(i18n.language as Locale) + 1) % LOCALES.length]!;
              setLocale(next);
            }}
          >
            <IconGlobe size={20} />
          </IconButton>
        </header>

        <main className="min-w-0 flex-1 p-4 pb-24 sm:p-6 lg:pb-6">
          <Outlet />
        </main>

        {/* iOS-style bottom navigation */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-line bg-surface/90 backdrop-blur-xl lg:hidden">
          {mobileItems.map(({ to, key, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[10px] font-medium',
                  'transition-colors duration-[var(--duration-fast)] ease-ios',
                  isActive ? 'text-brand-primary' : 'text-ink-tertiary',
                )
              }
            >
              <Icon size={22} />
              <span className="w-full truncate text-center">{t(key)}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
