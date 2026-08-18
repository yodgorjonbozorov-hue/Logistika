import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TripStatus } from 'shared';
import { useCrudMutations } from '../../shared/api/crud';
import { useAllTrips, useClients, useIncomes } from '../../shared/api/queries';
import {
  Button,
  Card,
  Cell,
  EmptyState,
  ErrorMessage,
  Field,
  Icon,
  Input,
  Modal,
  PageHeader,
  Row,
  Spinner,
  Table,
} from '../../shared/ui';
import { formatMillionsTiyin, formatTiyin } from '../../shared/utils/money';
import { openTrips } from '../overview/metrics';

export function ClientsPage() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const { data: clients, isLoading, error } = useClients();
  const trips = useAllTrips();
  const incomes = useIncomes();

  const rows = useMemo(() => {
    const allTrips = trips.data ?? [];
    const open = openTrips(allTrips);
    const revenueByClient = new Map<string, bigint>();
    for (const income of incomes.data ?? []) {
      if (!income.clientId) continue;
      revenueByClient.set(
        income.clientId,
        (revenueByClient.get(income.clientId) ?? 0n) + BigInt(income.amount),
      );
    }
    return (clients ?? []).map((client) => ({
      client,
      active: open.filter((trip) => trip.clientId === client.id).length,
      completed: allTrips.filter(
        (trip) => trip.clientId === client.id && trip.status === TripStatus.COMPLETED,
      ).length,
      revenue: revenueByClient.get(client.id) ?? 0n,
    }));
  }, [clients, trips.data, incomes.data]);

  const totalDebt = rows.reduce((sum, row) => {
    const balance = BigInt(row.client.balance);
    return balance > 0n ? sum + balance : sum;
  }, 0n);

  return (
    <div>
      <PageHeader
        title={t('clients.title')}
        subtitle={t('clients.subtitle', {
          count: rows.length,
          debt: formatMillionsTiyin(totalDebt),
        })}
        actions={
          <Button icon="plus" onClick={() => setShowForm(true)}>
            {t('clients.new')}
          </Button>
        }
      />
      <ErrorMessage error={error} />

      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="pl-[18px]">{t('clients.name')}</th>
                <th>{t('clients.phone')}</th>
                <th className="text-right">{t('clients.activeTrips')}</th>
                <th className="text-right">{t('status.COMPLETED')}</th>
                <th className="text-right">{t('clients.debt')}</th>
                <th className="text-right">{t('clients.totalRevenue')}</th>
                <th className="pl-4">{t('clients.paymentTerms')}</th>
                <th className="pr-[18px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ client, active, completed, revenue }) => {
                const balance = BigInt(client.balance);
                return (
                  <Row key={client.id}>
                    <Cell className="whitespace-nowrap pl-[18px] font-medium">{client.name}</Cell>
                    <Cell className="whitespace-nowrap tabular-nums text-neutral-400">
                      {client.phone ?? '—'}
                    </Cell>
                    <Cell align="right">{active}</Cell>
                    <Cell align="right" className="text-neutral-400">
                      {completed}
                    </Cell>
                    <Cell
                      align="right"
                      className="font-semibold"
                      style={{ color: balanceColor(balance) }}
                    >
                      {formatTiyin(client.balance)}
                    </Cell>
                    <Cell align="right">{formatTiyin(revenue)}</Cell>
                    <Cell className="pl-4 text-neutral-500">
                      {client.paymentTermsDays != null
                        ? t('clients.termsDays', { count: client.paymentTermsDays })
                        : t('clients.prepaid')}
                    </Cell>
                    <Cell className="pr-[18px] text-right">
                      <Icon
                        name="dots-three"
                        size={16}
                        style={{ color: 'var(--color-neutral-500)' }}
                      />
                    </Cell>
                  </Row>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <ClientFormModal open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}

/** Debt reads warm; a settled or credit balance stays neutral. */
export function balanceColor(balance: bigint): string {
  if (balance <= 0n) return 'var(--color-neutral-500)';
  return 'var(--color-warning-text)';
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
    setForm((current) => ({ ...current, [key]: e.target.value }));

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
    <Modal title={t('clients.new')} open={open} onClose={onClose} width={520}>
      <form onSubmit={(e) => void onSubmit(e)}>
        <Field label={t('clients.name')} className="mb-3">
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
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
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
