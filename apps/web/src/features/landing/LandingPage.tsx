import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, Icon, Tag } from '../../shared/ui';

const NAV_LINKS = [
  { href: '#features', key: 'landing.nav.product' },
  { href: '#features', key: 'landing.nav.features' },
  { href: '#solutions', key: 'landing.nav.solutions' },
  { href: '#pricing', key: 'landing.nav.pricing' },
  { href: '#footer', key: 'landing.nav.about' },
] as const;

const FEATURES = [
  { icon: 'path', key: 'trips' },
  { icon: 'map-trifold', key: 'gps' },
  { icon: 'truck', key: 'fleet' },
  { icon: 'device-mobile', key: 'driverApp' },
  { icon: 'currency-circle-dollar', key: 'finance' },
  { icon: 'files', key: 'documents' },
] as const;

const REASONS = [
  { icon: 'lightning', key: 'fast' },
  { icon: 'shield-check', key: 'reliable' },
  { icon: 'translate', key: 'local' },
] as const;

const STATS = ['companies', 'trips', 'vehicles', 'uptime'] as const;

const CUSTOMERS = [
  'Zarafshon Trans',
  'NavoiyLogistics',
  'SamTransServis',
  "OqYo'l Cargo",
  'FarTrans Group',
  'Buxoro Ekspress',
];

/** The public marketing page — the entry point into the product. */
export function LandingPage() {
  const { t } = useTranslation();

  return (
    <div className="bg-bg font-body text-[15px] text-ink">
      <header className="mx-auto flex max-w-[1140px] flex-wrap items-center gap-7 px-6 py-[18px]">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-accent text-accent"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}
          >
            <Icon name="truck" size={17} />
          </div>
          <span className="text-[15.5px] font-semibold">
            Truck<span className="text-accent">Control</span>
          </span>
        </div>
        <nav className="hidden gap-[22px] text-[13.5px] text-neutral-400 md:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.key} href={link.href} className="text-inherit hover:text-accent-300">
              {t(link.key)}
            </a>
          ))}
        </nav>
        <div className="flex-1" />
        <Link to="/login" className="text-[13.5px] text-neutral-300 hover:text-accent-300">
          {t('landing.signIn')}
        </Link>
        <Link to="/login" className="btn btn-primary">
          {t('landing.getStarted')}
        </Link>
      </header>

      <section className="mx-auto grid max-w-[1140px] items-center gap-12 px-6 pb-10 pt-16 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Tag variant="accent" className="mb-[18px] text-[11.5px]">
            {t('landing.hero.eyebrow')}
          </Tag>
          <h1 className="m-0 mb-[18px] text-[44px] font-medium leading-[1.12] tracking-[-0.025em]">
            {t('landing.hero.titleLine1')}
            <br />
            <span className="text-accent-300">{t('landing.hero.titleLine2')}</span>
          </h1>
          <p className="m-0 mb-7 max-w-[460px] text-base leading-[1.65] text-neutral-400">
            {t('landing.hero.body')}
          </p>
          <div className="mb-[26px] flex gap-2.5">
            <Link to="/login" className="btn btn-primary px-5 py-2.5 text-sm">
              {t('landing.getStarted')}
              <Icon name="arrow-right" size={15} />
            </Link>
            <Link to="/login" className="btn btn-secondary px-5 py-2.5 text-sm">
              {t('landing.signInCta')}
            </Link>
          </div>
          <div className="flex flex-wrap gap-5 text-[12.5px] text-neutral-500">
            {(['trial', 'setup', 'languages'] as const).map((key) => (
              <span key={key} className="flex items-center gap-1.5">
                <Icon name="check" style={{ color: 'var(--color-positive)' }} />
                {t(`landing.hero.perks.${key}`)}
              </span>
            ))}
          </div>
        </div>
        <AppPreview />
      </section>

      <section className="mx-auto max-w-[1140px] px-6 pb-14 pt-7">
        <div className="mb-4 text-xs uppercase tracking-[0.1em] text-neutral-600">
          {t('landing.customers')}
        </div>
        <div className="flex flex-wrap gap-9 text-[15px] font-semibold text-neutral-600">
          {CUSTOMERS.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-[1140px] px-6 pb-6 pt-10">
        <h2 className="m-0 mb-2 text-[30px] font-medium tracking-[-0.02em]">
          {t('landing.features.title')}
        </h2>
        <p className="m-0 mb-8 max-w-[520px] text-[15px] text-neutral-400">
          {t('landing.features.body')}
        </p>
        <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.key} className="p-5">
              <Icon name={feature.icon} size={22} style={{ color: 'var(--color-accent)' }} />
              <div className="mb-1.5 mt-3 text-[15px] font-medium">
                {t(`landing.features.items.${feature.key}.title`)}
              </div>
              <div className="text-[13.5px] leading-[1.6] text-neutral-400">
                {t(`landing.features.items.${feature.key}.body`)}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section id="solutions" className="mx-auto max-w-[1140px] px-6 py-12">
        <div className="mb-14 grid items-center gap-12 lg:grid-cols-2">
          <div>
            <Tag variant="outline" className="mb-3.5 text-[11px]">
              {t('landing.dispatcher.eyebrow')}
            </Tag>
            <h3 className="m-0 mb-2.5 text-2xl font-medium tracking-[-0.015em]">
              {t('landing.dispatcher.title')}
            </h3>
            <p className="m-0 text-[14.5px] leading-[1.65] text-neutral-400">
              {t('landing.dispatcher.body')}
            </p>
          </div>
          <DispatcherCard />
        </div>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <OwnerCard />
          <div>
            <Tag variant="outline" className="mb-3.5 text-[11px]">
              {t('landing.owner.eyebrow')}
            </Tag>
            <h3 className="m-0 mb-2.5 text-2xl font-medium tracking-[-0.015em]">
              {t('landing.owner.title')}
            </h3>
            <p className="m-0 text-[14.5px] leading-[1.65] text-neutral-400">
              {t('landing.owner.body')}
            </p>
          </div>
        </div>
      </section>

      {/* The one full-bleed saturated band the system allows — presence at page scale. */}
      <section
        className="my-6 border-y border-neutral-800"
        style={{
          background:
            'linear-gradient(135deg, #2a2650, color-mix(in srgb, #2a2650 70%, var(--color-bg)))',
        }}
      >
        <div className="mx-auto grid max-w-[1140px] grid-cols-2 gap-6 px-6 py-11 lg:grid-cols-4">
          {STATS.map((key) => (
            <div key={key}>
              <div className="text-[32px] font-semibold tracking-[-0.02em]">
                {t(`landing.stats.${key}.value`)}
              </div>
              <div className="mt-1 text-[13px] text-accent-200">
                {t(`landing.stats.${key}.label`)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-[1140px] px-6 py-12">
        <h2 className="m-0 mb-2 text-[28px] font-medium tracking-[-0.02em]">
          {t('landing.why.title')}
        </h2>
        <p className="m-0 mb-7 text-[15px] text-neutral-400">{t('landing.why.body')}</p>
        <div className="grid gap-3.5 md:grid-cols-3">
          {REASONS.map((reason) => (
            <div key={reason.key} className="py-1">
              <div className="mb-1.5 flex items-center gap-2.5 font-medium">
                <Icon name={reason.icon} size={17} style={{ color: 'var(--color-accent)' }} />
                {t(`landing.why.items.${reason.key}.title`)}
              </div>
              <div className="text-[13.5px] leading-[1.6] text-neutral-400">
                {t(`landing.why.items.${reason.key}.body`)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1140px] px-6 pb-[72px] pt-8">
        <Card
          className="flex flex-wrap items-center gap-8 px-12 py-11"
          style={{
            background:
              'radial-gradient(80% 120% at 85% 20%, color-mix(in srgb, var(--color-accent-900) 60%, transparent), transparent 60%), var(--color-surface)',
          }}
        >
          <div className="flex-1">
            <h2 className="m-0 mb-2 text-[26px] font-medium tracking-[-0.02em]">
              {t('landing.cta.title')}
            </h2>
            <p className="m-0 text-sm text-neutral-400">{t('landing.cta.body')}</p>
          </div>
          <Link to="/login" className="btn btn-primary shrink-0 px-[22px] py-[11px] text-sm">
            {t('landing.getStarted')}
            <Icon name="arrow-right" size={15} />
          </Link>
        </Card>
      </section>

      <footer id="footer" className="border-t border-divider">
        <div className="mx-auto flex max-w-[1140px] flex-wrap items-center gap-6 px-6 py-7 text-[12.5px] text-neutral-500">
          <div className="flex items-center gap-2">
            <Icon name="truck" size={15} style={{ color: 'var(--color-accent)' }} />
            <span className="font-semibold text-neutral-300">Truck Control</span>
          </div>
          <span>{t('landing.footer.copyright')}</span>
          <div className="flex-1" />
          <a href="#footer" className="text-inherit hover:text-accent-300">
            {t('landing.footer.privacy')}
          </a>
          <a href="#footer" className="text-inherit hover:text-accent-300">
            {t('landing.footer.terms')}
          </a>
          <a href="tel:+998712024480" className="text-inherit hover:text-accent-300">
            {t('landing.footer.contact')}
          </a>
        </div>
      </footer>
    </div>
  );
}

/** The hero's browser-chrome mockup of the overview screen. */
function AppPreview() {
  const { t } = useTranslation();
  const rows = [
    { no: 'TR-2026-0042', plate: '01 A 512 BC', route: 'Toshkent → Navoiy', tone: 'in' },
    { no: 'TR-2026-0043', plate: '80 C 118 EA', route: 'Toshkent → Buxoro', tone: 'in' },
    { no: 'TR-2026-0044', plate: '30 B 204 CD', route: 'Samarqand → Toshkent', tone: 'assigned' },
  ] as const;
  const grid = 'grid grid-cols-[1.2fr_1fr_1.3fr_0.9fr] gap-1.5 px-[9px] py-1.5';

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute -inset-10"
        style={{
          background:
            'radial-gradient(60% 55% at 50% 42%, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 70%)',
        }}
      />
      <div
        className="relative overflow-hidden rounded-xl border border-neutral-800 shadow-lg"
        style={{ background: 'color-mix(in srgb, var(--color-bg) 92%, black)' }}
      >
        <div className="flex items-center gap-1.5 border-b border-neutral-800 px-3 py-[9px]">
          <span className="h-[9px] w-[9px] rounded-full bg-neutral-700" />
          <span className="h-[9px] w-[9px] rounded-full bg-neutral-700" />
          <span className="h-[9px] w-[9px] rounded-full bg-neutral-700" />
          <span className="flex-1 text-center text-[10.5px] text-neutral-600">
            app.truckcontrol.uz
          </span>
        </div>
        <div className="flex text-[10px]">
          <div className="flex w-[118px] shrink-0 flex-col gap-[3px] border-r border-neutral-800 px-2 py-2.5">
            <div
              className="rounded-md px-[7px] py-[5px] font-medium text-accent-200"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 11%, transparent)' }}
            >
              {t('nav.overview')}
            </div>
            {(['trips', 'map', 'vehicles', 'drivers', 'finance'] as const).map((key) => (
              <div key={key} className="px-[7px] py-[5px] text-neutral-500">
                {t(`nav.${key}`)}
              </div>
            ))}
          </div>
          <div className="flex-1 p-3">
            <div className="mb-[9px] text-xs font-medium">{t('landing.preview.greeting')}</div>
            <div className="mb-[9px] grid grid-cols-3 gap-[7px]">
              <PreviewStat label={t('overview.kpi.activeTrips')} value="12" />
              <PreviewStat label={t('overview.kpi.revenue')} value="812,4" unit={t('common.mln')} />
              <PreviewStat label={t('overview.kpi.freeVehicles')} value="7" unit="/23" />
            </div>
            <div className="overflow-hidden rounded-[7px] border border-neutral-800">
              <div className={`${grid} border-b border-neutral-800 text-neutral-600`}>
                <span>{t('trips.number')}</span>
                <span>{t('trips.vehicle')}</span>
                <span>{t('trips.route')}</span>
                <span>{t('trips.status')}</span>
              </div>
              {rows.map((row, index) => (
                <div
                  key={row.no}
                  className={`${grid} ${index < rows.length - 1 ? 'border-b border-neutral-800' : ''}`}
                >
                  <span className="font-semibold text-accent-300">{row.no}</span>
                  <span>{row.plate}</span>
                  <span className="text-neutral-400">{row.route}</span>
                  <span className={row.tone === 'in' ? 'text-accent-200' : 'text-positive-text'}>
                    ● {t(row.tone === 'in' ? 'status.IN_PROGRESS' : 'status.ASSIGNED')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewStat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-[7px] border border-neutral-800 p-2">
      <div className="mb-[3px] text-neutral-500">{label}</div>
      <div className="text-[15px] font-semibold">
        {value}
        {unit ? <span className="text-[9px] font-normal text-neutral-500"> {unit}</span> : null}
      </div>
    </div>
  );
}

function DispatcherCard() {
  const { t } = useTranslation();
  return (
    <Card className="px-[18px] py-4 text-xs">
      <div className="mb-2.5 flex items-center gap-2">
        <StepDot done>✓</StepDot>
        <span className="text-neutral-400">{t('landing.dispatcher.step1')}</span>
      </div>
      <div className="mb-2.5 flex items-center gap-2">
        <StepDot done>✓</StepDot>
        <span className="text-neutral-400">{t('landing.dispatcher.step2')}</span>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <StepDot>3</StepDot>
        <span>{t('landing.dispatcher.step3')}</span>
      </div>
      <div
        className="flex flex-wrap gap-3.5 rounded-[7px] px-[11px] py-[9px]"
        style={{ background: 'color-mix(in srgb, var(--color-neutral-900) 70%, transparent)' }}
      >
        <span className="text-neutral-500">
          {t('landing.dispatcher.price')} <b className="text-ink">28 mln so'm</b>
        </span>
        <span className="text-neutral-500">
          {t('landing.dispatcher.fuel')} <b className="text-ink">~155 l</b>
        </span>
        <span className="text-neutral-500">
          {t('landing.dispatcher.profit')} <b className="text-positive-text">+9,4 mln</b>
        </span>
      </div>
    </Card>
  );
}

function StepDot({ children, done }: { children: string; done?: boolean }) {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
      style={
        done
          ? { background: 'var(--color-accent-800)', color: 'var(--color-accent-200)' }
          : {
              border: '1.5px solid var(--color-accent)',
              color: 'var(--color-accent)',
              boxSizing: 'border-box',
            }
      }
    >
      {children}
    </span>
  );
}

function OwnerCard() {
  const { t } = useTranslation();
  const bars = [40, 55, 46, 68, 60, 84];
  return (
    <Card className="px-[18px] py-4 text-xs">
      <div className="mb-2.5 flex justify-between">
        <span className="text-[13px] font-medium">{t('landing.owner.cardTitle')}</span>
        <Tag variant="accent" className="text-[10px]">
          {t('landing.owner.live')}
        </Tag>
      </div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">415,3 mln</span>
        <span className="text-positive-text">{t('landing.owner.delta')}</span>
      </div>
      <div className="mb-3 text-neutral-500">{t('landing.owner.cardCaption')}</div>
      <div className="flex h-[54px] items-end gap-[5px]">
        {bars.map((height, index) => (
          <div
            key={height}
            className="flex-1 rounded-t-[3px]"
            style={{
              height: `${height}%`,
              background:
                index === bars.length - 1 ? 'var(--color-accent)' : 'var(--color-accent-800)',
            }}
          />
        ))}
      </div>
    </Card>
  );
}
