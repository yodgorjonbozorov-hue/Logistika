import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCrudMutations, useList } from '../../shared/api/crud';
import type { Client } from '../../shared/api/entities';
import {
  Button,
  Cell,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Row,
  Spinner,
  Table,
} from '../../shared/ui';
import { formatTiyin } from '../../shared/utils/money';

export function ClientsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useList<Client>('clients', page);

  const clients = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;

  return (
    <div>
      <PageHeader
        title={t('clients.title')}
        actions={<Button onClick={() => setShowForm(true)}>+ {t('clients.new')}</Button>}
      />
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : clients.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Table
            headers={[
              t('clients.name'),
              t('clients.contactPerson'),
              t('clients.phone'),
              t('clients.paymentTerms'),
              t('clients.balance'),
            ]}
          >
            {clients.map((client) => (
              <Row key={client.id}>
                <Cell className="font-semibold">{client.name}</Cell>
                <Cell>{client.contactPerson ?? '—'}</Cell>
                <Cell>{client.phone ?? '—'}</Cell>
                <Cell>{client.paymentTermsDays ?? '—'}</Cell>
                <Cell className="tabular-nums">{formatTiyin(client.balance)}</Cell>
              </Row>
            ))}
          </Table>
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
