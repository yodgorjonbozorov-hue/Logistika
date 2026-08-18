import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api/client';
import type { AdminCompany } from '../../shared/api/entities';
import {
  Badge,
  Button,
  DataTable,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Skeleton,
  type Column,
} from '../../shared/ui';
import { formatDate } from '../../shared/utils/date';

const PAGE_SIZE = 20;

function isExpired(company: AdminCompany): boolean {
  return Boolean(company.subscriptionUntil && new Date(company.subscriptionUntil) < new Date());
}

export function AdminCompaniesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AdminCompany | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'companies', { page }],
    queryFn: () => api<AdminCompany[]>('/admin/companies', { query: { page, limit: PAGE_SIZE } }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
  };

  const toggle = useMutation({
    mutationFn: (company: AdminCompany) =>
      api(`/admin/companies/${company.id}`, {
        method: 'PATCH',
        body: { isActive: !company.isActive },
      }),
    onSuccess: invalidate,
  });

  const total = data?.meta?.pagination?.total ?? 0;

  const columns: Array<Column<AdminCompany>> = [
    { key: 'name', header: t('admin.company'), primary: true, cell: (row) => row.name },
    {
      key: 'status',
      header: t('admin.status'),
      secondary: true,
      cell: (row) => (
        <Badge tone={row.isActive ? 'green' : 'gray'}>
          {row.isActive ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
    },
    {
      key: 'owner',
      header: t('admin.owner'),
      cell: (row) =>
        row.owner ? (
          <span className="block min-w-0">
            <span className="block truncate">{row.owner.fullName}</span>
            <span className="block truncate text-xs text-ink-2">{row.owner.email ?? '—'}</span>
          </span>
        ) : (
          <span className="text-ink-2">{t('admin.noOwner')}</span>
        ),
    },
    {
      key: 'users',
      header: t('admin.userCount'),
      className: 'money',
      cell: (row) => row.userCount,
    },
    {
      key: 'trips',
      header: t('admin.tripCount'),
      className: 'money',
      cell: (row) => row.tripCount,
    },
    {
      key: 'subscription',
      header: t('admin.subscription'),
      cell: (row) => (
        <span className={isExpired(row) ? 'text-danger' : undefined}>
          {row.tariffPlan ?? '—'} · {formatDate(row.subscriptionUntil)}
          {isExpired(row) ? ` (${t('admin.expired')})` : ''}
        </span>
      ),
    },
    { key: 'created', header: t('admin.created'), cell: (row) => formatDate(row.createdAt) },
    {
      key: 'actions',
      header: t('common.actions'),
      desktopOnly: true,
      cell: (row) => (
        <span className="flex gap-3">
          <button className="text-xs text-accent hover:underline" onClick={() => setEditing(row)}>
            {t('admin.editSubscription')}
          </button>
          <button
            className={
              row.isActive
                ? 'text-xs text-danger hover:underline'
                : 'text-xs text-success hover:underline'
            }
            onClick={() => toggle.mutate(row)}
          >
            {row.isActive ? t('admin.deactivate') : t('admin.activate')}
          </button>
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('admin.companiesTitle')}
        actions={<Button onClick={() => setShowForm(true)}>+ {t('admin.newCompany')}</Button>}
      />
      <ErrorMessage error={error ?? toggle.error} />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <DataTable rows={data?.data ?? []} columns={columns} getKey={(row) => row.id} />
          <Pagination page={page} limit={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}
      <CreateCompanyModal open={showForm} onClose={() => setShowForm(false)} />
      <SubscriptionModal company={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function CreateCompanyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    tariffPlan: 'TRIAL',
    subscriptionUntil: '',
    ownerName: '',
    ownerEmail: '',
    ownerPassword: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/admin/companies', { method: 'POST', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
  });

  return (
    <Modal title={t('admin.newCompany')} open={open} onClose={onClose}>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          create.mutate({
            name: form.name,
            tariffPlan: form.tariffPlan || undefined,
            subscriptionUntil: form.subscriptionUntil
              ? new Date(form.subscriptionUntil).toISOString()
              : undefined,
            owner: {
              fullName: form.ownerName,
              email: form.ownerEmail,
              password: form.ownerPassword,
            },
          });
        }}
        className="space-y-3"
      >
        <Field label={t('admin.companyName')} required>
          <Input value={form.name} onChange={set('name')} required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('admin.tariffPlan')}>
            <Input value={form.tariffPlan} onChange={set('tariffPlan')} />
          </Field>
          <Field label={t('admin.subscriptionUntil')}>
            <Input type="date" value={form.subscriptionUntil} onChange={set('subscriptionUntil')} />
          </Field>
        </div>
        <Field label={t('admin.ownerName')} required>
          <Input value={form.ownerName} onChange={set('ownerName')} required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('admin.ownerEmail')} required>
            <Input type="email" value={form.ownerEmail} onChange={set('ownerEmail')} required />
          </Field>
          <Field label={t('admin.ownerPassword')} hint={t('settings.userPasswordHint')} required>
            <Input
              type="password"
              value={form.ownerPassword}
              onChange={set('ownerPassword')}
              minLength={8}
              required
            />
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

function SubscriptionModal({
  company,
  onClose,
}: {
  company: AdminCompany | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [tariffPlan, setTariffPlan] = useState('');
  const [until, setUntil] = useState('');

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/admin/companies/${company?.id}`, { method: 'PATCH', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
  });

  if (!company) return null;

  return (
    <Modal title={t('admin.editSubscription')} open onClose={onClose}>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate({
            tariffPlan: tariffPlan || company.tariffPlan || undefined,
            subscriptionUntil: until ? new Date(until).toISOString() : undefined,
          });
        }}
        className="space-y-3"
      >
        <p className="text-sm text-ink-2">{company.name}</p>
        <Field label={t('admin.tariffPlan')}>
          <Input
            value={tariffPlan}
            placeholder={company.tariffPlan ?? ''}
            onChange={(event) => setTariffPlan(event.target.value)}
          />
        </Field>
        <Field label={t('admin.subscriptionUntil')}>
          <Input type="date" value={until} onChange={(event) => setUntil(event.target.value)} />
        </Field>
        <ErrorMessage error={save.error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
