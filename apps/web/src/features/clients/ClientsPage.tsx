import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../../shared/api/client';
import { useCrudMutations, useList } from '../../shared/api/crud';
import type { Client, Trip } from '../../shared/api/entities';
import {
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
import { formatTiyin } from '../../shared/utils/money';

export function ClientsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useList<Client>('clients', page);

  // Per-client totals are derived from real trips; there is no aggregate endpoint yet.
  // TODO: backend `GET /clients/:id/stats` (trips, revenue, receivables) with Finance Core.
  const trips = useQuery({
    queryKey: ['trips', { limit: 100, forClients: true }],
    queryFn: async () => (await api<Trip[]>('/trips', { query: { limit: 100 } })).data,
  });

  const stats = useMemo(() => {
    const map = new Map<string, { trips: number; revenue: bigint }>();
    for (const trip of trips.data ?? []) {
      if (!trip.clientId) continue;
      const bucket = map.get(trip.clientId) ?? { trips: 0, revenue: 0n };
      bucket.trips += 1;
      if (trip.status !== 'CANCELLED') bucket.revenue += BigInt(trip.agreedPrice);
      map.set(trip.clientId, bucket);
    }
    return map;
  }, [trips.data]);

  const clients = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;

  const columns: Array<Column<Client>> = [
    { key: 'name', header: t('clients.name'), primary: true, cell: (client) => client.name },
    {
      key: 'balance',
      header: t('clients.balance'),
      secondary: true,
      className: 'money',
      cell: (client) =>
        BigInt(client.balance) > 0n ? (
          <span className="font-semibold text-danger money">{formatTiyin(client.balance)}</span>
        ) : (
          <span className="text-ink-2">{formatTiyin(client.balance)}</span>
        ),
    },
    {
      key: 'contact',
      header: t('clients.contactPerson'),
      cell: (client) => client.contactPerson ?? '—',
    },
    { key: 'phone', header: t('clients.phone'), cell: (client) => client.phone ?? '—' },
    {
      key: 'trips',
      header: t('clients.trips'),
      className: 'money',
      cell: (client) => stats.get(client.id)?.trips ?? 0,
    },
    {
      key: 'revenue',
      header: t('clients.revenue'),
      className: 'money',
      cell: (client) => formatTiyin(stats.get(client.id)?.revenue ?? 0n),
    },
    {
      key: 'terms',
      header: t('clients.paymentTerms'),
      cell: (client) => client.paymentTermsDays ?? '—',
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('clients.title')}
        subtitle={t('clients.subtitle')}
        actions={<Button onClick={() => setShowForm(true)}>+ {t('clients.new')}</Button>}
      />
      <ErrorMessage error={error} />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <DataTable
            rows={clients}
            columns={columns}
            getKey={(client) => client.id}
            onRowClick={(client) => navigate(`/trips?q=${encodeURIComponent(client.name)}`)}
          />
          <p className="mt-2 text-xs text-ink-2">{t('clients.balanceNote')}</p>
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}
      <ClientFormModal open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}

function ClientFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { create } = useCrudMutations('clients');
  const [form, setForm] = useState({
    name: '',
    inn: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    paymentTermsDays: '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      name: form.name,
      inn: form.inn || undefined,
      contactPerson: form.contactPerson || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      address: form.address || undefined,
      paymentTermsDays: form.paymentTermsDays ? Number(form.paymentTermsDays) : undefined,
    });
    onClose();
  }

  return (
    <Modal title={t('clients.new')} open={open} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <Field label={t('clients.name')}>
          <Input value={form.name} onChange={set('name')} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('clients.inn')}>
            <Input value={form.inn} onChange={set('inn')} />
          </Field>
          <Field label={t('clients.contactPerson')}>
            <Input value={form.contactPerson} onChange={set('contactPerson')} />
          </Field>
          <Field label={t('clients.phone')}>
            <Input value={form.phone} onChange={set('phone')} placeholder="+99890XXXXXXX" />
          </Field>
          <Field label={t('clients.email')}>
            <Input type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label={t('clients.paymentTerms')}>
            <Input
              type="number"
              min="0"
              value={form.paymentTermsDays}
              onChange={set('paymentTermsDays')}
            />
          </Field>
          <Field label={t('clients.address')}>
            <Input value={form.address} onChange={set('address')} />
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
