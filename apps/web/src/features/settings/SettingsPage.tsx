import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES } from 'shared';
import { useAiStatus } from '../../shared/api/ai';
import {
  SUPPORTED_TIMEZONES,
  microUsdToDollars,
  useCompany,
  useCompanySettings,
  useLinkTelegram,
  useTelegramLink,
  useUpdateCompany,
  useUpdateSettings,
  type CompanySettings,
} from '../../shared/api/settings';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '../../shared/ui';

/**
 * W-11 — company settings.
 *
 * Four cards, in the order an owner cares about them: who the company is, when
 * to be warned, what AI may do and how much it may spend, and where the daily
 * message goes. Everything here was already enforced by the backend; this is
 * the first screen that lets a person change it.
 */
export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <PageHeader title={t('settings.title')} />
      <div className="grid gap-4 xl:grid-cols-2">
        <CompanyCard />
        <ThresholdsCard />
        <AiCard />
        <TelegramCard />
      </div>
    </div>
  );
}

function CompanyCard() {
  const { t } = useTranslation();
  const { data: company, isLoading } = useCompany();
  const update = useUpdateCompany();
  const [form, setForm] = useState({ name: '', phone: '', address: '', locale: '', timezone: '' });

  useEffect(() => {
    if (!company) return;
    setForm({
      name: company.name,
      phone: company.phone ?? '',
      address: company.address ?? '',
      locale: company.locale,
      timezone: company.timezone,
    });
  }, [company]);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">{t('settings.company.title')}</h2>
      {isLoading ? (
        <Spinner />
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate(form);
          }}
        >
          <Field label={t('settings.company.name')}>
            <Input value={form.name} onChange={set('name')} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('settings.company.phone')}>
              <Input value={form.phone} onChange={set('phone')} />
            </Field>
            <Field label={t('settings.company.address')}>
              <Input value={form.address} onChange={set('address')} />
            </Field>
            <Field label={t('settings.company.locale')} hint={t('settings.company.localeHint')}>
              <Select value={form.locale} onChange={set('locale')}>
                {LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {t(`settings.locales.${locale}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('settings.company.timezone')} hint={t('settings.company.timezoneHint')}>
              <Select value={form.timezone} onChange={set('timezone')}>
                {SUPPORTED_TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <SaveRow pending={update.isPending} error={update.error} saved={update.isSuccess} />
        </form>
      )}
    </Card>
  );
}

function ThresholdsCard() {
  const { t } = useTranslation();
  const { data: settings, isLoading } = useCompanySettings();
  const update = useUpdateSettings();
  const [form, setForm] = useState({ fuel: '', idle: '', route: '', digest: '' });

  useEffect(() => {
    if (!settings) return;
    setForm({
      // Basis points are the storage unit; an owner types percent.
      fuel: (settings.fuelDeviationThresholdBp / 100).toString(),
      idle: settings.idleAlertHours.toString(),
      route: settings.routeDeviationKm.toString(),
      digest: settings.digestTime,
    });
  }, [settings]);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate({
      fuelDeviationThresholdBp: Math.round(Number(form.fuel) * 100),
      idleAlertHours: Number(form.idle),
      routeDeviationKm: Number(form.route),
      digestTime: form.digest,
    });
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">{t('settings.thresholds.title')}</h2>
      {isLoading ? (
        <Spinner />
      ) : (
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('settings.thresholds.fuel')} hint={t('settings.thresholds.fuelHint')}>
              <Input inputMode="decimal" value={form.fuel} onChange={set('fuel')} required />
            </Field>
            <Field label={t('settings.thresholds.idle')}>
              <Input inputMode="numeric" value={form.idle} onChange={set('idle')} required />
            </Field>
            <Field label={t('settings.thresholds.route')}>
              <Input inputMode="numeric" value={form.route} onChange={set('route')} required />
            </Field>
            <Field
              label={t('settings.thresholds.digest')}
              hint={t('settings.thresholds.digestHint')}
            >
              <Input type="time" value={form.digest} onChange={set('digest')} required />
            </Field>
          </div>
          <SaveRow pending={update.isPending} error={update.error} saved={update.isSuccess} />
        </form>
      )}
    </Card>
  );
}

const AI_TOGGLES = ['ocrEnabled', 'voiceEnabled', 'chatEnabled', 'anomalyEnabled'] as const;

function AiCard() {
  const { t } = useTranslation();
  const { data: settings, isLoading } = useCompanySettings();
  const { data: status } = useAiStatus();
  const update = useUpdateSettings();
  const [limit, setLimit] = useState('');

  useEffect(() => {
    if (settings) setLimit(microUsdToDollars(settings.monthlyLimitMicroUsd, 0));
  }, [settings]);

  if (isLoading || !settings) {
    return (
      <Card>
        <h2 className="mb-3 text-sm font-semibold">{t('settings.ai.title')}</h2>
        <Spinner />
      </Card>
    );
  }

  const used = microUsdToDollars(settings.currentUsageMicroUsd);
  const cap = microUsdToDollars(settings.monthlyLimitMicroUsd, 0);

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">{t('settings.ai.title')}</h2>

      {status && !status.configured && (
        <p className="mb-3 text-xs text-muted">{t('settings.ai.notConfigured')}</p>
      )}

      <ul className="space-y-2">
        {AI_TOGGLES.map((key) => (
          <li key={key} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {t(`settings.ai.${key}`)}
              <span className="block text-xs text-muted">{t(`settings.ai.${key}Hint`)}</span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-accent"
              checked={settings[key as keyof CompanySettings] as boolean}
              onChange={(event) => update.mutate({ [key]: event.target.checked })}
              disabled={update.isPending}
            />
          </li>
        ))}
      </ul>

      <form
        className="mt-4 space-y-3 border-t border-gray-200 pt-3 dark:border-white/10"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate({ monthlyLimitUsd: Number(limit) });
        }}
      >
        <Field label={t('settings.ai.limit')} hint={t('settings.ai.limitHint')}>
          <Input
            inputMode="numeric"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            required
          />
        </Field>
        <p className="text-xs text-muted">
          {t('settings.ai.usage', { used, cap, month: settings.usageMonth || '—' })}
        </p>
        <SaveRow pending={update.isPending} error={update.error} saved={update.isSuccess} />
      </form>
    </Card>
  );
}

function TelegramCard() {
  const { t } = useTranslation();
  const { data: state, isLoading } = useTelegramLink();
  const { link, unlink } = useLinkTelegram();
  const [chatId, setChatId] = useState('');

  if (isLoading) {
    return (
      <Card>
        <Spinner />
      </Card>
    );
  }
  // No bot on the platform means nothing to link — showing the card would only
  // offer a setting that cannot work.
  if (!state?.available) return null;

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">{t('settings.telegram.title')}</h2>
      <p className="mb-3 text-xs text-muted">{t('settings.telegram.hint')}</p>

      {state.linked ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-success">{t('settings.telegram.linked')}</span>
          <Button variant="secondary" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
            {t('settings.telegram.unlink')}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            link.mutate(chatId);
          }}
        >
          <Field label={t('settings.telegram.chatId')}>
            <Input
              inputMode="numeric"
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
              required
            />
          </Field>
          <SaveRow pending={link.isPending} error={link.error} saved={false} />
        </form>
      )}
      <ErrorMessage error={unlink.error} />
    </Card>
  );
}

function SaveRow({ pending, error, saved }: { pending: boolean; error: unknown; saved: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-end gap-3">
      <ErrorMessage error={error} />
      {saved && !pending && !error && (
        <span className="text-xs text-success">{t('settings.saved')}</span>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t('common.saving') : t('common.save')}
      </Button>
    </div>
  );
}
