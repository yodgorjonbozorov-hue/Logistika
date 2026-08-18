import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LOCALES, type Locale } from 'shared';
import { Logo } from '../../app/AppLayout';
import { setLocale } from '../../shared/i18n';
import { Badge, Button, Select } from '../../shared/ui';
import { Icon, type IconName } from '../../shared/ui/icons';

const LOCALE_LABELS: Record<Locale, string> = {
  'uz-latn': "O'zbekcha",
  'uz-cyrl': 'Ўзбекча',
  ru: 'Русский',
};

const FEATURES: Array<{ icon: IconName; titleKey: string; textKey: string; soon?: boolean }> = [
  { icon: 'trips', titleKey: 'landing.features.tripsTitle', textKey: 'landing.features.tripsText' },
  { icon: 'map', titleKey: 'landing.features.gpsTitle', textKey: 'landing.features.gpsText' },
  {
    icon: 'drivers',
    titleKey: 'landing.features.driversTitle',
    textKey: 'landing.features.driversText',
  },
  {
    icon: 'vehicles',
    titleKey: 'landing.features.vehiclesTitle',
    textKey: 'landing.features.vehiclesText',
  },
  {
    icon: 'finance',
    titleKey: 'landing.features.expensesTitle',
    textKey: 'landing.features.expensesText',
  },
  {
    icon: 'finance',
    titleKey: 'landing.features.incomesTitle',
    textKey: 'landing.features.incomesText',
  },
  {
    icon: 'clients',
    titleKey: 'landing.features.debtTitle',
    textKey: 'landing.features.debtText',
  },
  {
    icon: 'reports',
    titleKey: 'landing.features.reportsTitle',
    textKey: 'landing.features.reportsText',
  },
  {
    icon: 'admin',
    titleKey: 'landing.features.aiTitle',
    textKey: 'landing.features.aiText',
    soon: true,
  },
];

const STEPS = ['one', 'two', 'three', 'four', 'five', 'six'] as const;

/** Static illustration of the product — no fabricated figures are presented as data. */
function DashboardPreview() {
  const { t } = useTranslation();
  return (
    // min-w-0: the nowrap/truncate rows inside must not widen the grid track.
    <div className="min-w-0 rounded-2xl border border-line bg-surface p-3 shadow-pop sm:p-4">
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-accent/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </div>
        <div className="truncate text-xs text-ink-2">{t('landing.previewTitle')}</div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: t('dashboard.activeTrips'), value: '2' },
          { label: t('dashboard.activeVehicles'), value: '3' },
          { label: t('dashboard.activeDrivers'), value: '3' },
        ].map((item) => (
          <div key={item.label} className="rounded-lg bg-surface-2 p-2.5">
            <div className="truncate text-[10px] uppercase text-ink-2">{item.label}</div>
            <div className="mt-0.5 text-lg font-bold">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {[
          {
            number: 'TR-2026-0002',
            route: 'Toshkent → Navoiy',
            tone: 'orange' as const,
            status: 'IN_PROGRESS',
          },
          {
            number: 'TR-2026-0003',
            route: 'Toshkent → Jizzax',
            tone: 'blue' as const,
            status: 'ASSIGNED',
          },
        ].map((trip) => (
          <div
            key={trip.number}
            className="flex items-center justify-between gap-2 rounded-lg border border-line p-2.5"
          >
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold">{trip.number}</div>
              <div className="truncate text-[11px] text-ink-2">{trip.route}</div>
            </div>
            <Badge tone={trip.tone}>{t(`status.${trip.status}`)}</Badge>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg bg-success/10 p-2.5 text-xs text-success">
        <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
        <span className="min-w-0 truncate">
          01 A 123 BC · {t('map.MOVING')} · {t('landing.previewSubtitle')}
        </span>
      </div>
    </div>
  );
}

export function LandingPage() {
  const { t, i18n } = useTranslation();

  // The marketing page is always light — the panel keeps its own theme choice.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    root.classList.remove('dark');
    return () => {
      if (wasDark) root.classList.add('dark');
    };
  }, []);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          {/* The full wordmark plus the CTA does not fit a 375px header. */}
          <span className="sm:hidden">
            <Logo compact />
          </span>
          <span className="hidden sm:block">
            <Logo />
          </span>
          <nav className="ml-6 hidden items-center gap-6 text-sm text-ink-2 md:flex">
            <a href="#features" className="hover:text-ink">
              {t('landing.navFeatures')}
            </a>
            <a href="#how" className="hover:text-ink">
              {t('landing.navHowItWorks')}
            </a>
            <a href="#contact" className="hover:text-ink">
              {t('landing.navContact')}
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Select
              aria-label={t('common.language')}
              value={i18n.language}
              onChange={(event) => setLocale(event.target.value as Locale)}
              className="hidden w-32 sm:block"
            >
              {LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {LOCALE_LABELS[locale]}
                </option>
              ))}
            </Select>
            <Link to="/login">
              <Button>{t('landing.ctaPrimary')}</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_70%_0%,rgba(245,166,35,0.16),transparent)]"
        />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-2 lg:items-center lg:py-20">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {t('landing.heroBadge')}
            </span>
            <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              {t('landing.heroTitle')}
            </h1>
            <p className="mt-4 max-w-xl text-base text-ink-2 sm:text-lg">
              {t('landing.heroSubtitle')}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/login">
                <Button size="lg">
                  {t('landing.ctaPrimary')}
                  <Icon name="chevronRight" className="h-4 w-4" />
                </Button>
              </Link>
              <a href="#features">
                <Button size="lg" variant="secondary">
                  {t('landing.ctaSecondary')}
                </Button>
              </a>
            </div>
            <p className="mt-3 text-xs text-ink-2">{t('landing.heroNote')}</p>
          </div>
          <DashboardPreview />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-b border-line">
        <div className="mx-auto max-w-6xl px-4 py-14 lg:py-20">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t('landing.featuresTitle')}
          </h2>
          <p className="mt-2 text-ink-2">{t('landing.featuresSubtitle')}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <article
                key={feature.titleKey}
                className="rounded-xl border border-line bg-surface p-5 shadow-card transition hover:border-accent/50"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
                    <Icon name={feature.icon} />
                  </span>
                  <h3 className="font-semibold">{t(feature.titleKey)}</h3>
                  {feature.soon ? <Badge tone="gray">{t('common.comingSoon')}</Badge> : null}
                </div>
                <p className="mt-3 text-sm text-ink-2">{t(feature.textKey)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-b border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 lg:py-20">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('landing.howTitle')}</h2>
          <p className="mt-2 text-ink-2">{t('landing.howSubtitle')}</p>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step} className="rounded-xl border border-line bg-canvas p-5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-navy text-sm font-bold text-white">
                  {index + 1}
                </span>
                <p className="mt-3 font-medium">{t(`landing.steps.${step}`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-6xl px-4 py-14 lg:py-16">
          <div className="rounded-2xl bg-navy px-6 py-10 text-center text-white sm:px-10">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {t('landing.ctaTitle')}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-white/70">{t('landing.ctaText')}</p>
            <div className="mt-7 flex justify-center">
              <Link to="/login">
                <Button size="lg">{t('landing.ctaPrimary')}</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer id="contact" className="bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Logo />
            <p className="mt-2 max-w-sm text-sm text-ink-2">{t('app.tagline')}</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
            <a href="#features" className="hover:text-ink">
              {t('landing.footerAbout')}
            </a>
            <a href="mailto:info@truckcontrol.uz" className="hover:text-ink">
              {t('landing.footerContact')}
            </a>
            <Link to="/privacy" className="hover:text-ink">
              {t('landing.footerPrivacy')}
            </Link>
            <Link to="/terms" className="hover:text-ink">
              {t('landing.footerTerms')}
            </Link>
            <Link to="/login" className="font-medium text-ink hover:text-accent">
              {t('landing.footerLogin')}
            </Link>
          </nav>
        </div>
        <div className="border-t border-line py-4 text-center text-xs text-ink-2">
          © {new Date().getFullYear()} TruckControl AI — {t('landing.footerRights')}
        </div>
      </footer>
    </div>
  );
}

/** Placeholder legal pages so the footer links never dead-end. */
export function LegalPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <Link to="/" className="text-sm text-ink-2 hover:text-ink">
        ← {t('errors.goHome')}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{t(titleKey)}</h1>
      <p className="mt-3 text-sm text-ink-2">{t('landing.comingSoonPage')}</p>
    </div>
  );
}
