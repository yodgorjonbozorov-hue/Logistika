import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { UserRole } from 'shared';
import { api } from '../../shared/api/client';
import { useCrudMutations, useList } from '../../shared/api/crud';
import type { Company, User } from '../../shared/api/entities';
import { useAuth } from '../../shared/auth/AuthContext';
import { can } from '../../shared/auth/permissions';
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  Tabs,
  type Column,
} from '../../shared/ui';
import { formatDate, formatDateTime } from '../../shared/utils/date';

type Tab = 'company' | 'profile' | 'users' | 'security';

/** Roles a tenant may assign — SUPERADMIN is platform-only (backend TENANT_ROLES). */
const ASSIGNABLE_ROLES = [
  UserRole.OWNER,
  UserRole.LOGIST,
  UserRole.ACCOUNTANT,
  UserRole.DRIVER,
] as const;

export function SettingsPage() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const [tab, setTab] = useState<Tab>('company');

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'company', label: t('settings.tabs.company') },
    { key: 'profile', label: t('settings.tabs.profile') },
    ...(can(role, 'manageUsers') ? [{ key: 'users' as Tab, label: t('settings.tabs.users') }] : []),
    { key: 'security', label: t('settings.tabs.security') },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <Tabs<Tab> active={tab} onChange={setTab} tabs={tabs} />
      {tab === 'company' && <CompanyTab />}
      {tab === 'profile' && <ProfileTab />}
      {tab === 'users' && can(role, 'manageUsers') && <UsersTab />}
      {tab === 'security' && <SecurityTab />}
    </div>
  );
}

function CompanyTab() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const editable = can(role, 'editCompany');

  const { data, isLoading, error } = useQuery({
    queryKey: ['company'],
    queryFn: async () => (await api<Company>('/company')).data,
  });

  const [form, setForm] = useState({ name: '', phone: '', address: '', inn: '' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setForm({
      name: data.name ?? '',
      phone: data.phone ?? '',
      address: data.address ?? '',
      inn: data.inn ?? '',
    });
  }, [data]);

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api<Company>('/company', { method: 'PATCH', body })).data,
    onSuccess: async () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await queryClient.invalidateQueries({ queryKey: ['company'] });
    },
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (error) return <ErrorMessage error={error} />;

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Card>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate({
            name: form.name,
            phone: form.phone || undefined,
            address: form.address || undefined,
            inn: form.inn || undefined,
          });
        }}
        className="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settings.companyName')} required>
            <Input value={form.name} onChange={set('name')} disabled={!editable} required />
          </Field>
          <Field label={t('settings.companyPhone')}>
            <Input value={form.phone} onChange={set('phone')} disabled={!editable} />
          </Field>
          <Field label={t('settings.companyInn')}>
            <Input value={form.inn} onChange={set('inn')} disabled={!editable} />
          </Field>
          <Field label={t('settings.companyAddress')}>
            <Input value={form.address} onChange={set('address')} disabled={!editable} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-4 rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <span>
            <span className="text-ink-2">{t('settings.tariffPlan')}: </span>
            {data?.tariffPlan ?? '—'}
          </span>
          <span>
            <span className="text-ink-2">{t('settings.subscriptionUntil')}: </span>
            {formatDate(data?.subscriptionUntil)}
          </span>
        </div>

        <ErrorMessage error={save.error} />
        {editable ? (
          <div className="flex items-center justify-end gap-3">
            {saved ? <span className="text-sm text-success">{t('settings.saved')}</span> : null}
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-ink-2">{t('settings.ownerOnly')}</p>
        )}
      </form>
    </Card>
  );
}

function ProfileTab() {
  const { t } = useTranslation();
  const { user, role } = useAuth();
  return (
    <Card>
      <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase text-ink-2">{t('settings.profileName')}</dt>
          <dd className="mt-0.5 font-medium">{user?.fullName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-ink-2">{t('settings.profileRole')}</dt>
          <dd className="mt-0.5">
            {role ? <Badge tone="orange">{t(`roles.${role}`)}</Badge> : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-ink-2">{t('settings.profileEmail')}</dt>
          <dd className="mt-0.5">{user?.email ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-ink-2">{t('settings.profilePhone')}</dt>
          <dd className="mt-0.5">{user?.phone ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-ink-2">{t('settings.lastLogin')}</dt>
          <dd className="mt-0.5">{formatDateTime(user?.lastLogin)}</dd>
        </div>
      </dl>
    </Card>
  );
}

function UsersTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useList<User>('users', page);
  const { remove } = useCrudMutations('users');
  const { user } = useAuth();

  const total = data?.meta?.pagination?.total ?? 0;

  const columns: Array<Column<User>> = [
    { key: 'name', header: t('settings.userName'), primary: true, cell: (row) => row.fullName },
    {
      key: 'status',
      header: t('settings.userStatus'),
      secondary: true,
      cell: (row) => (
        <Badge tone={row.isActive ? 'green' : 'gray'}>
          {row.isActive ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
    },
    { key: 'role', header: t('settings.userRole'), cell: (row) => t(`roles.${row.role}`) },
    { key: 'email', header: t('settings.userEmail'), cell: (row) => row.email ?? '—' },
    { key: 'phone', header: t('settings.userPhone'), cell: (row) => row.phone ?? '—' },
    {
      key: 'actions',
      header: t('common.actions'),
      desktopOnly: true,
      cell: (row) =>
        row.isActive && row.id !== user?.id ? (
          <button
            className="text-xs text-danger hover:underline"
            onClick={() => {
              if (window.confirm(t('common.confirmDeactivate'))) {
                void remove.mutateAsync(row.id);
              }
            }}
          >
            {t('common.deactivate')}
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setShowForm(true)}>+ {t('settings.newUser')}</Button>
      </div>
      <ErrorMessage error={error ?? remove.error} />
      {isLoading ? (
        <Skeleton className="h-56" />
      ) : (
        <>
          <DataTable rows={data?.data ?? []} columns={columns} getKey={(row) => row.id} />
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}
      <UserFormModal open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}

function UserFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { create } = useCrudMutations('users');
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: UserRole.LOGIST as UserRole,
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Modal title={t('settings.newUser')} open={open} onClose={onClose}>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void create
            .mutateAsync({
              fullName: form.fullName,
              email: form.email || undefined,
              phone: form.phone || undefined,
              password: form.password,
              role: form.role,
            })
            .then(onClose);
        }}
        className="space-y-3"
      >
        <Field label={t('settings.userName')} required>
          <Input value={form.fullName} onChange={set('fullName')} required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settings.userEmail')}>
            <Input type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label={t('settings.userPhone')}>
            <Input value={form.phone} onChange={set('phone')} placeholder="+99890XXXXXXX" />
          </Field>
          <Field label={t('settings.userPassword')} hint={t('settings.userPasswordHint')} required>
            <Input
              type="password"
              value={form.password}
              onChange={set('password')}
              minLength={8}
              required
            />
          </Field>
          <Field label={t('settings.userRole')} required>
            <Select value={form.role} onChange={set('role')}>
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`roles.${role}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ErrorMessage error={create.error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SecurityTab() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  return (
    <Card className="space-y-4">
      <p className="text-sm text-ink-2">{t('settings.securityNote')}</p>
      <Button variant="danger" onClick={() => void logout()}>
        {t('settings.logoutEverywhere')}
      </Button>
    </Card>
  );
}
