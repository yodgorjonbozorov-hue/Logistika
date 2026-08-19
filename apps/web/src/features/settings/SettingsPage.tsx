import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES, UserRole, type Locale } from 'shared';
import { api } from '../../shared/api/client';
import { useCompany } from '../../shared/api/queries';
import { useAuth } from '../../shared/auth/AuthContext';
import { setLocale } from '../../shared/i18n';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Tag,
} from '../../shared/ui';
import { cn } from '../../shared/utils/cn';
import { formatDate } from '../../shared/utils/date';

const SECTIONS = [
  'organisation',
  'profile',
  'notifications',
  'security',
  'integrations',
  'billing',
] as const;
type Section = (typeof SECTIONS)[number];

const LOCALE_LABELS: Record<Locale, string> = {
  'uz-latn': "O'zbek (lotin)",
  'uz-cyrl': 'Ўзбек (кирил)',
  ru: 'Русский',
};

export function SettingsPage() {
  const { t } = useTranslation();
  const [section, setSection] = useState<Section>('organisation');

  return (
    <div className="max-w-[960px]">
      <PageHeader title={t('settings.title')} />
      <div className="grid items-start gap-5 lg:grid-cols-[210px_1fr]">
        {/* Phone: the six sections scroll as chips rather than stacking six rows
            of navigation above the settings they lead to. */}
        <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 text-[13px] md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0 md:pb-0">
          {SECTIONS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={section === value}
              onClick={() => setSection(value)}
              className={cn(
                'min-h-[44px] shrink-0 whitespace-nowrap rounded-md border border-neutral-800 px-3 text-left md:min-h-0 md:border-0 md:px-2.5 md:py-2',
                section === value
                  ? 'font-medium text-accent-200'
                  : 'text-neutral-400 hover:bg-neutral-800/50',
              )}
              style={
                section === value
                  ? { background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }
                  : undefined
              }
            >
              {t(`settings.sections.${value}`)}
            </button>
          ))}
        </nav>

        <div className="flex flex-col gap-3">
          {section === 'organisation' ? <OrganisationSection /> : null}
          {section === 'profile' ? <ProfileSection /> : null}
          {section !== 'organisation' && section !== 'profile' ? (
            <Card className="px-5 py-[18px] text-[13px] text-neutral-500">
              {t('settings.comingSoon')}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OrganisationSection() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: company, isLoading } = useCompany();
  const canEdit = user?.role === UserRole.OWNER;

  const [form, setForm] = useState({ name: '', inn: '', phone: '', address: '' });

  useEffect(() => {
    if (!company) return;
    setForm({
      name: company.name,
      inn: company.inn ?? '',
      phone: company.phone ?? '',
      address: company.address ?? '',
    });
  }, [company]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/company', { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['company'] }),
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate({
      name: form.name,
      inn: form.inn || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
    });
  }

  if (isLoading) return <Spinner />;

  return (
    <>
      <Card className="px-5 py-[18px]">
        <form onSubmit={onSubmit}>
          <div className="mb-3.5 text-[15px] font-medium">{t('settings.orgTitle')}</div>
          <div className="grid gap-3.5 md:grid-cols-2">
            <Field label={t('settings.orgName')}>
              <Input value={form.name} onChange={set('name')} disabled={!canEdit} required />
            </Field>
            <Field label={t('settings.inn')}>
              <Input value={form.inn} onChange={set('inn')} disabled={!canEdit} />
            </Field>
            <Field label={t('drivers.phone')}>
              <Input value={form.phone} onChange={set('phone')} disabled={!canEdit} />
            </Field>
            <Field label={t('settings.timezone')}>
              <Input value={Intl.DateTimeFormat().resolvedOptions().timeZone} disabled />
            </Field>
            <Field label={t('clients.address')} className="md:col-span-2">
              <Input value={form.address} onChange={set('address')} disabled={!canEdit} />
            </Field>
            <Field label={t('settings.currency')}>
              <Input value={t('settings.currencyUzs')} disabled />
            </Field>
            <Field label={t('settings.language')}>
              <Select value={i18n.language} onChange={(e) => setLocale(e.target.value as Locale)}>
                {LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {LOCALE_LABELS[locale]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <ErrorMessage error={save.error} />
          {canEdit ? (
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => save.reset()}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          ) : (
            <div className="mt-3 text-[12.5px] text-neutral-500">{t('settings.ownerOnly')}</div>
          )}
        </form>
      </Card>

      <Card className="px-5 py-[18px]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <div className="text-sm font-medium">
              {t('settings.subscription', {
                plan: company?.tariffPlan ?? t('settings.noPlan'),
              })}
            </div>
            <div className="mt-0.5 text-[12.5px] text-neutral-500">
              {company?.subscriptionUntil
                ? t('settings.subscriptionUntil', {
                    date: formatDate(company.subscriptionUntil),
                  })
                : t('settings.noSubscription')}
            </div>
          </div>
          <Tag variant="accent" className="text-[11.5px]">
            {t(company?.isActive ? 'users.active' : 'users.inactive')}
          </Tag>
          <Button variant="secondary" className="text-[12.5px]">
            {t('settings.manage')}
          </Button>
        </div>
      </Card>

      {canEdit ? (
        <Card
          className="px-5 py-[18px]"
          style={{ border: '1px solid color-mix(in srgb, var(--color-danger) 40%, transparent)' }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <div className="text-sm font-medium text-danger-text">{t('settings.dangerZone')}</div>
              <div className="mt-0.5 text-[12.5px] text-neutral-500">
                {t('settings.archiveWarning')}
              </div>
            </div>
            <Button variant="danger" className="text-[12.5px]">
              {t('settings.archive')}
            </Button>
          </div>
        </Card>
      ) : null}
    </>
  );
}

function ProfileSection() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <Card className="px-5 py-[18px]">
      <div className="mb-3.5 text-[15px] font-medium">{t('settings.sections.profile')}</div>
      <div className="grid gap-3.5 md:grid-cols-2">
        <Field label={t('users.fullName')}>
          <Input value={user?.fullName ?? ''} disabled />
        </Field>
        <Field label={t('users.role')}>
          <Input value={user ? t(`roles.${user.role}`) : ''} disabled />
        </Field>
        <Field label={t('clients.email')}>
          <Input value={user?.email ?? '—'} disabled />
        </Field>
        <Field label={t('drivers.phone')}>
          <Input value={user?.phone ?? '—'} disabled />
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" icon="sign-out" onClick={() => void logout()}>
          {t('auth.logout')}
        </Button>
      </div>
    </Card>
  );
}
