import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from 'shared';
import { contactChannels, PANEL_URL } from './contacts';
import { setLocale } from './i18n';

const LOCALE_LABELS: Record<Locale, string> = {
  'uz-latn': "O'z",
  'uz-cyrl': 'Ўз',
  ru: 'Ру',
};

const SECTIONS = ['problem', 'features', 'ai', 'results', 'pricing', 'contact'] as const;

/** Rows of a two-column comparison table (problem→consequence, them→us). */
interface PairRow {
  [key: string]: string;
}

export function App() {
  const { t, i18n } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  const channels = contactChannels();
  const scrollTo = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-navy text-gray-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-navy/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <a href="#top" className="text-lg font-extrabold">
            Truck<span className="text-accent">Control</span>
            <span className="ml-1 rounded bg-accent/20 px-1 text-xs font-bold text-accent">AI</span>
          </a>

          <nav className="ml-auto hidden items-center gap-5 lg:flex">
            {SECTIONS.map((section) => (
              <button
                key={section}
                onClick={() => scrollTo(section)}
                className="text-sm text-gray-300 transition hover:text-accent"
              >
                {t(`nav.${section}`)}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <div className="flex rounded-lg border border-white/20 p-0.5">
              {LOCALES.map((locale) => (
                <button
                  key={locale}
                  onClick={() => setLocale(locale)}
                  aria-pressed={i18n.language === locale}
                  className={
                    i18n.language === locale
                      ? 'rounded-md bg-accent px-2 py-0.5 text-xs font-bold text-navy'
                      : 'px-2 py-0.5 text-xs text-gray-300 hover:text-accent'
                  }
                >
                  {LOCALE_LABELS[locale]}
                </button>
              ))}
            </div>
            {PANEL_URL ? (
              <a
                href={PANEL_URL}
                className="hidden rounded-lg border border-white/20 px-3 py-1.5 text-sm text-gray-200 transition hover:border-accent hover:text-accent sm:block"
              >
                {t('nav.login')}
              </a>
            ) : null}
            <button
              className="rounded-lg p-1.5 text-xl leading-none text-gray-300 lg:hidden"
              aria-label="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <nav className="border-t border-white/10 px-4 py-2 lg:hidden">
            {SECTIONS.map((section) => (
              <button
                key={section}
                onClick={() => scrollTo(section)}
                className="block w-full py-2.5 text-left text-sm text-gray-300"
              >
                {t(`nav.${section}`)}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <main id="top">
        <Hero onDemo={() => scrollTo('contact')} onFeatures={() => scrollTo('features')} />
        <Stats />
        <Problem />
        <Audience />
        <Features />
        <Ai />
        <Results />
        <Advantage />
        <Pricing onSelect={() => scrollTo('contact')} />
        <Contact channels={channels} />
      </main>

      <footer className="border-t border-white/10 px-4 py-8 text-center text-xs text-muted sm:px-6">
        <p>
          TruckControl AI — {t('footer.builtFor')} © {new Date().getFullYear()}.{' '}
          {t('footer.rights')}
        </p>
      </footer>
    </div>
  );
}

// ---------- Sections ----------

function Section({
  id,
  title,
  subtitle,
  children,
  tone = 'dark',
}: {
  id?: string;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  tone?: 'dark' | 'light';
}) {
  return (
    <section id={id} className={tone === 'light' ? 'bg-white/5 py-14 sm:py-20' : 'py-14 sm:py-20'}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {title ? <h2 className="text-2xl font-bold sm:text-3xl">{title}</h2> : null}
        {subtitle ? <p className="mt-2 max-w-3xl text-gray-300">{subtitle}</p> : null}
        <div className={title ? 'mt-8' : ''}>{children}</div>
      </div>
    </section>
  );
}

function Hero({ onDemo, onFeatures }: { onDemo: () => void; onFeatures: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="border-b border-white/10 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="text-3xl font-extrabold leading-tight sm:text-5xl">
          <Trans i18nKey="hero.title" components={{ 1: <span className="text-accent" /> }} />
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-gray-300 sm:text-lg">
          {t('hero.subtitle')}
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            onClick={onDemo}
            className="rounded-lg bg-accent px-6 py-3 font-semibold text-navy transition hover:brightness-95"
          >
            {t('hero.primary')}
          </button>
          <button
            onClick={onFeatures}
            className="rounded-lg border border-white/25 px-6 py-3 font-medium text-gray-100 transition hover:border-accent hover:text-accent"
          >
            {t('hero.secondary')}
          </button>
        </div>
        <p className="mt-5 text-sm text-muted">{t('hero.note')}</p>
      </div>
    </section>
  );
}

function Stats() {
  const { t } = useTranslation();
  const keys = ['fuel', 'saving', 'report'] as const;
  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-4 py-10 sm:grid-cols-3 sm:px-6">
      {keys.map((key) => (
        <div key={key} className="rounded-xl border border-white/10 bg-white/5 p-5 text-center">
          <div className="text-2xl font-extrabold text-accent sm:text-3xl">
            {t(`stats.${key}.value`)}
          </div>
          <div className="mt-1 text-sm text-gray-300">{t(`stats.${key}.label`)}</div>
        </div>
      ))}
    </div>
  );
}

function Problem() {
  const { t } = useTranslation();
  const items = t('problem.items', { returnObjects: true }) as PairRow[];
  return (
    <Section id="problem" title={t('problem.title')} subtitle={t('problem.subtitle')} tone="light">
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <li
            key={item.problem}
            className="rounded-xl border border-white/10 bg-navy/40 p-4 sm:flex sm:items-start sm:gap-4"
          >
            <span className="mt-0.5 shrink-0 text-danger">✕</span>
            <div className="mt-2 sm:mt-0">
              <p className="font-medium">{item.problem}</p>
              <p className="mt-1 text-sm text-muted">
                {t('problem.consequence')}: {item.consequence}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Audience() {
  const { t } = useTranslation();
  const roles = ['driver', 'logist', 'owner'] as const;
  return (
    <Section title={t('audience.title')} subtitle={t('audience.subtitle')}>
      <div className="grid gap-4 md:grid-cols-3">
        {roles.map((role) => (
          <div key={role} className="rounded-xl border border-white/10 bg-white/5 p-5">
            <h3 className="font-semibold text-accent">{t(`audience.${role}.title`)}</h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-300">
              {t(`audience.${role}.text`)}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Features() {
  const { t } = useTranslation();
  const keys = ['fuel', 'profit', 'map', 'docs', 'reports', 'offline'] as const;
  return (
    <Section id="features" title={t('features.title')} tone="light">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {keys.map((key) => (
          <div key={key} className="rounded-xl border border-white/10 bg-navy/40 p-5">
            <h3 className="font-semibold">{t(`features.${key}.title`)}</h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-300">
              {t(`features.${key}.text`)}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Ai() {
  const { t } = useTranslation();
  const items = t('ai.items', { returnObjects: true }) as PairRow[];
  const guards = t('ai.guards', { returnObjects: true }) as string[];
  return (
    <Section id="ai" title={t('ai.title')} subtitle={t('ai.subtitle')}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.title} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-sm font-semibold text-accent">{item.title}</h3>
              <p className="mt-1 text-sm text-gray-300">{item.text}</p>
            </div>
          ))}
        </div>
        <ul className="space-y-3 rounded-xl border border-success/30 bg-success/5 p-5">
          {guards.map((guard) => (
            <li key={guard} className="flex gap-3 text-sm text-gray-200">
              <span className="text-success">✓</span>
              {guard}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function Results() {
  const { t } = useTranslation();
  const items = t('results.items', { returnObjects: true }) as PairRow[];
  return (
    <Section id="results" title={t('results.title')} tone="light">
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[520px] border-collapse bg-navy/40 text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase text-muted">
              <th className="px-4 py-3 font-semibold">{t('results.metric')}</th>
              <th className="px-4 py-3 font-semibold">{t('results.before')}</th>
              <th className="px-4 py-3 font-semibold">{t('results.after')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.metric} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3">{item.metric}</td>
                <td className="px-4 py-3 text-muted">{item.before}</td>
                <td className="px-4 py-3 font-semibold text-success">{item.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm text-gray-300">{t('results.note')}</p>
    </Section>
  );
}

function Advantage() {
  const { t } = useTranslation();
  const items = t('advantage.items', { returnObjects: true }) as PairRow[];
  return (
    <Section title={t('advantage.title')}>
      <div className="grid gap-3">
        {items.map((item) => (
          <div
            key={item.us}
            className="grid gap-2 rounded-xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2 sm:gap-6"
          >
            <p className="text-sm text-muted">
              <span className="mr-2">✕</span>
              {item.them}
            </p>
            <p className="text-sm font-medium">
              <span className="mr-2 text-accent">✓</span>
              {item.us}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

interface Plan {
  name: string;
  vehicles: string;
  price: string;
  badge?: string;
}

function Pricing({ onSelect }: { onSelect: () => void }) {
  const { t } = useTranslation();
  const plans = t('pricing.plans', { returnObjects: true }) as Plan[];
  return (
    <Section id="pricing" title={t('pricing.title')} subtitle={t('pricing.subtitle')} tone="light">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={
              plan.badge
                ? 'relative rounded-xl border-2 border-accent bg-navy/60 p-5'
                : 'rounded-xl border border-white/10 bg-navy/40 p-5'
            }
          >
            {plan.badge ? (
              <span className="absolute -top-3 left-5 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-navy">
                {plan.badge}
              </span>
            ) : null}
            <h3 className="text-lg font-bold">{plan.name}</h3>
            <p className="mt-1 text-sm text-muted">{plan.vehicles}</p>
            <p className="mt-4 text-2xl font-extrabold tabular-nums">
              {plan.price || t('pricing.custom')}
            </p>
            {plan.price ? (
              <p className="text-xs text-muted">so'm / {t('pricing.perMonth')}</p>
            ) : null}
            <button
              onClick={onSelect}
              className="mt-5 w-full rounded-lg border border-white/20 py-2 text-sm font-medium transition hover:border-accent hover:text-accent"
            >
              {t('pricing.cta')}
            </button>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">{t('pricing.extras')}</p>
    </Section>
  );
}

function Contact({ channels }: { channels: ReturnType<typeof contactChannels> }) {
  const { t } = useTranslation();
  return (
    <Section id="contact">
      <div className="rounded-2xl border border-accent/30 bg-accent/10 p-6 text-center sm:p-10">
        <h2 className="text-2xl font-bold sm:text-3xl">{t('contact.title')}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-gray-200">{t('contact.subtitle')}</p>
        {channels.length === 0 ? (
          <p className="mt-6 text-sm text-muted">{t('contact.notConfigured')}</p>
        ) : (
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            {channels.map((channel) => (
              <a
                key={channel.kind}
                href={channel.href}
                className={
                  channel.kind === 'phone'
                    ? 'rounded-lg bg-accent px-6 py-3 font-semibold text-navy transition hover:brightness-95'
                    : 'rounded-lg border border-white/25 px-6 py-3 font-medium transition hover:border-accent hover:text-accent'
                }
              >
                {t(`contact.${channel.kind}`)} · {channel.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
