import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TRIAL_DAYS } from 'shared';
import { api } from '../../shared/api/client';
import type { Company } from '../../shared/api/entities';
import {
  Button,
  Card,
  CardList,
  Cell,
  EmptyBlock,
  ErrorMessage,
  Field,
  Icon,
  Input,
  ListCard,
  ListState,
  MetaItem,
  Modal,
  PageHeader,
  Pagination,
  Row,
  SearchInput,
  StatCard,
  StatusChip,
  Table,
} from '../../shared/ui';
import { dateInputToIso, formatDate } from '../../shared/utils/date';
import { daysLeft, standing } from '../../shared/utils/subscription';

const PAGE_SIZE = 20;

/**
 * The platform admin's only workspace: every tenant on the installation, what
 * plan it is on, and how long it has left. Backed by `/admin/companies`, the
 * one endpoint group scoped to SUPERADMIN.
 */
export function CompaniesPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'companies', page],
    queryFn: () => api<Company[]>('/admin/companies', { query: { page, limit: PAGE_SIZE } }),
  });

  const all = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? all.length;
  const rows = search
    ? all.filter((company) => company.name.toLowerCase().includes(search.toLowerCase()))
    : all;

  const counts = {
    active: all.filter((company) => company.isActive).length,
    trial: all.filter((company) => company.tariffPlan === 'TRIAL').length,
    expiring: all.filter((company) => {
      const days = daysLeft(company.subscriptionUntil);
      return company.isActive && days !== null && days >= 0 && days <= 7;
    }).length,
  };

  return (
    <div>
      <PageHeader
        title={t('admin.companies.title')}
        subtitle={t('admin.companies.subtitle', { count: total })}
        actions={
          <Button icon="plus" onClick={() => setCreating(true)}>
            {t('admin.companies.new')}
          </Button>
        }
      />

      <div className="mb-3 grid grid-cols-3 gap-2.5 md:gap-3">
        <StatCard label={t('admin.companies.stats.all')} value={total} />
        <StatCard label={t('admin.companies.stats.trial')} value={counts.trial} />
        <StatCard
          label={t('admin.companies.stats.expiring')}
          value={counts.expiring}
          deltaTone={counts.expiring > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <SearchInput
        className="mb-3 w-full md:w-[260px]"
        value={search}
        onChange={setSearch}
        placeholder={t('admin.companies.searchPlaceholder')}
      />

      {/* Phone: one card per tenant. */}
      <div className="md:hidden">
        <ListState
          isLoading={isLoading}
          error={error}
          isEmpty={rows.length === 0}
          onRetry={() => void refetch()}
          empty={
            <Card>
              <EmptyBlock icon="buildings" title={t('admin.companies.empty')} />
            </Card>
          }
        >
          <CardList>
            {rows.map((company) => {
              const state = standing(company);
              return (
                <ListCard
                  key={company.id}
                  onClick={() => setEditing(company)}
                  title={company.name}
                  subtitle={company.inn ? `INN ${company.inn}` : t('common.notSet')}
                  trailing={
                    <StatusChip tone={state.tone}>{t(`admin.standing.${state.key}`)}</StatusChip>
                  }
                  meta={
                    <>
                      <MetaItem label={t('admin.companies.plan')}>
                        {company.tariffPlan ?? '—'}
                      </MetaItem>
                      <MetaItem label={t('admin.companies.until')}>
                        {formatDate(company.subscriptionUntil)}
                      </MetaItem>
                      <MetaItem label={t('admin.companies.created')}>
                        {formatDate(company.createdAt)}
                      </MetaItem>
                      <MetaItem label={t('admin.companies.daysLeft')}>
                        {state.days === null ? '—' : state.days}
                      </MetaItem>
                    </>
                  }
                />
              );
            })}
          </CardList>
        </ListState>
      </div>

      {/* Desktop: the full table. */}
      <Card className="hidden overflow-hidden p-0 md:block">
        <ListState
          isLoading={isLoading}
          error={error}
          isEmpty={rows.length === 0}
          onRetry={() => void refetch()}
          empty={<EmptyBlock icon="buildings" title={t('admin.companies.empty')} />}
        >
          <Table>
            <thead>
              <tr>
                <th className="pl-[18px]">{t('admin.companies.name')}</th>
                <th>{t('admin.companies.plan')}</th>
                <th>{t('admin.companies.until')}</th>
                <th className="text-right">{t('admin.companies.daysLeft')}</th>
                <th className="pl-4">{t('trips.status')}</th>
                <th>{t('admin.companies.created')}</th>
                <th className="pr-[18px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((company) => {
                const state = standing(company);
                return (
                  <Row key={company.id} onClick={() => setEditing(company)}>
                    <Cell className="pl-[18px] font-medium">
                      {company.name}
                      {company.inn ? (
                        <span className="block text-[11.5px] text-neutral-600">
                          INN {company.inn}
                        </span>
                      ) : null}
                    </Cell>
                    <Cell className="text-neutral-400">{company.tariffPlan ?? '—'}</Cell>
                    <Cell className="whitespace-nowrap text-neutral-400">
                      {formatDate(company.subscriptionUntil)}
                    </Cell>
                    <Cell align="right" className="text-neutral-400">
                      {state.days === null ? '—' : state.days}
                    </Cell>
                    <Cell className="pl-4">
                      <StatusChip tone={state.tone}>{t(`admin.standing.${state.key}`)}</StatusChip>
                    </Cell>
                    <Cell className="whitespace-nowrap text-neutral-500">
                      {formatDate(company.createdAt)}
                    </Cell>
                    <Cell className="pr-[18px] text-right">
                      <Icon
                        name="pencil-simple"
                        size={15}
                        style={{ color: 'var(--color-neutral-500)' }}
                      />
                    </Cell>
                  </Row>
                );
              })}
            </tbody>
          </Table>
        </ListState>
        {total > PAGE_SIZE ? (
          <Pagination page={page} limit={PAGE_SIZE} total={total} onPage={setPage} />
        ) : null}
      </Card>

      <CreateCompanyModal open={creating} onClose={() => setCreating(false)} />
      <EditCompanyModal company={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/** A tenant and its first OWNER, the same pair self-registration creates. */
function CreateCompanyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    tariffPlan: 'TRIAL',
    subscriptionUntil: '',
    fullName: '',
    email: '',
    password: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Company>('/admin/companies', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] });
      onClose();
    },
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      name: form.name,
      tariffPlan: form.tariffPlan || undefined,
      subscriptionUntil: dateInputToIso(form.subscriptionUntil),
      owner: { fullName: form.fullName, email: form.email, password: form.password },
    });
  }

  return (
    <Modal title={t('admin.companies.new')} open={open} onClose={onClose} width={520}>
      <form onSubmit={(event) => void onSubmit(event)}>
        <Field label={t('admin.companies.name')} className="mb-3">
          <Input value={form.name} onChange={set('name')} required maxLength={190} />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('admin.companies.plan')} hint={t('admin.companies.planHint')}>
            <Input value={form.tariffPlan} onChange={set('tariffPlan')} maxLength={50} />
          </Field>
          <Field
            label={t('admin.companies.until')}
            hint={t('admin.companies.untilHint', { days: TRIAL_DAYS })}
          >
            <Input type="date" value={form.subscriptionUntil} onChange={set('subscriptionUntil')} />
          </Field>
        </div>

        <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-500">
          {t('admin.companies.owner')}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('drivers.fullName')}>
            <Input value={form.fullName} onChange={set('fullName')} required maxLength={190} />
          </Field>
          <Field label={t('auth.register.email')}>
            <Input type="email" value={form.email} onChange={set('email')} required />
          </Field>
        </div>
        <Field
          label={t('auth.register.password')}
          hint={t('auth.register.passwordHint')}
          className="mt-3"
        >
          <Input
            type="password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>

        <ErrorMessage error={create.error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t('common.saving') : t('common.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Plan, subscription end and suspension — everything `PATCH` accepts. */
function EditCompanyModal({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ tariffPlan: '', subscriptionUntil: '', isActive: true });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [confirming, setConfirming] = useState(false);

  // Seed the form from the row the admin opened, once per company.
  if (company && loadedFor !== company.id) {
    setLoadedFor(company.id);
    setConfirmName('');
    setConfirming(false);
    setForm({
      tariffPlan: company.tariffPlan ?? '',
      subscriptionUntil: company.subscriptionUntil?.slice(0, 10) ?? '',
      isActive: company.isActive,
    });
  }

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Company>(`/admin/companies/${company?.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      api(`/admin/companies/${company?.id}`, {
        method: 'DELETE',
        body: { confirmName },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] });
      onClose();
    },
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await update.mutateAsync({
      tariffPlan: form.tariffPlan || undefined,
      subscriptionUntil: dateInputToIso(form.subscriptionUntil),
      isActive: form.isActive,
    });
  }

  /** Pushes the subscription out by a whole number of days from today. */
  function extend(days: number) {
    const base = new Date();
    base.setDate(base.getDate() + days);
    setForm((current) => ({ ...current, subscriptionUntil: base.toISOString().slice(0, 10) }));
  }

  return (
    <Modal
      title={company?.name ?? ''}
      open={company !== null}
      onClose={onClose}
      width={460}
      key={company?.id}
    >
      <form onSubmit={(event) => void onSubmit(event)}>
        <Field label={t('admin.companies.plan')} className="mb-3">
          <Input
            value={form.tariffPlan}
            onChange={(event) => setForm((c) => ({ ...c, tariffPlan: event.target.value }))}
            maxLength={50}
          />
        </Field>
        <Field label={t('admin.companies.until')}>
          <Input
            type="date"
            value={form.subscriptionUntil}
            onChange={(event) => setForm((c) => ({ ...c, subscriptionUntil: event.target.value }))}
          />
        </Field>
        <div className="mt-2 flex flex-wrap gap-2">
          {[TRIAL_DAYS, 30, 90, 365].map((days) => (
            <Button key={days} type="button" variant="secondary" onClick={() => extend(days)}>
              +{days} {t('admin.companies.days')}
            </Button>
          ))}
        </div>

        <label className="mt-4 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[13px]">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm((c) => ({ ...c, isActive: event.target.checked }))}
            className="h-[18px] w-[18px]"
            style={{ accentColor: 'var(--color-accent)' }}
          />
          <span>
            {t('admin.companies.isActive')}
            <span className="block text-[11.5px] text-neutral-500">
              {t('admin.companies.isActiveHint')}
            </span>
          </span>
        </label>

        <ErrorMessage error={update.error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>

      {/* Irreversible, so it is folded away until asked for, and then asks the
          admin to type the tenant's name back. */}
      <div
        className="mt-5 rounded-md px-3.5 py-3"
        style={{ border: '1px solid color-mix(in srgb, var(--color-danger) 40%, transparent)' }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-danger-text">
              {t('admin.companies.delete')}
            </div>
            <div className="mt-0.5 text-[12px] text-neutral-500">
              {t('admin.companies.deleteHint')}
            </div>
          </div>
          {confirming ? null : (
            <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
              {t('admin.companies.delete')}
            </Button>
          )}
        </div>

        {confirming ? (
          <div className="mt-3">
            <Field label={t('admin.companies.deleteConfirm', { name: company?.name ?? '' })}>
              <Input
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                placeholder={company?.name ?? ''}
                autoComplete="off"
              />
            </Field>
            <ErrorMessage error={remove.error} />
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={remove.isPending || confirmName.trim() !== company?.name}
                onClick={() => void remove.mutateAsync()}
              >
                {remove.isPending ? t('common.saving') : t('admin.companies.deleteForever')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
