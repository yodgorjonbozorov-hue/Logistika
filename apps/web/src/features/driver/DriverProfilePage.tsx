import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from 'shared';
import { useAuth } from '../../shared/auth/AuthContext';
import { setLocale } from '../../shared/i18n';
import { Badge, Button, Card, Field, PageHeader, Select } from '../../shared/ui';
import { formatDateTime } from '../../shared/utils/date';
import { loadQueue, pendingEvents, rejectedEvents } from './offlineQueue';

const LOCALE_LABELS: Record<Locale, string> = {
  'uz-latn': "O'zbekcha",
  'uz-cyrl': 'Ўзбекча',
  ru: 'Русский',
};

export function DriverProfilePage() {
  const { t, i18n } = useTranslation();
  const { user, role, logout } = useAuth();
  const queue = loadQueue();

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={t('driver.profile')} />

      <Card>
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-accent/20 text-lg font-bold text-accent">
            {(user?.fullName ?? '?').charAt(0)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold">{user?.fullName}</div>
            <div className="truncate text-sm text-ink-2">{user?.phone ?? user?.email}</div>
          </div>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">{t('settings.profileRole')}</dt>
            <dd>{role ? <Badge tone="orange">{t(`roles.${role}`)}</Badge> : '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">{t('settings.lastLogin')}</dt>
            <dd>{formatDateTime(user?.lastLogin)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">{t('driver.events')}</dt>
            <dd>
              {t('driver.queued', { count: pendingEvents(queue).length })}
              {rejectedEvents(queue).length > 0
                ? ` · ${t('driver.queueRejected', { count: rejectedEvents(queue).length })}`
                : ''}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <Field label={t('common.language')}>
          <Select
            value={i18n.language}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            {LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {LOCALE_LABELS[locale]}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Button variant="danger" size="lg" className="w-full" onClick={() => void logout()}>
        {t('auth.logout')}
      </Button>
    </div>
  );
}
