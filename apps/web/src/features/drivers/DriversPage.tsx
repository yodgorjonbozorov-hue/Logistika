import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SalaryType } from 'shared';
import { useCrudMutations, useList } from '../../shared/api/crud';
import type { Driver } from '../../shared/api/entities';
import {
  Badge,
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
  Select,
  Spinner,
  Table,
} from '../../shared/ui';
import { formatDate } from '../../shared/utils/date';
import { RatingCard } from './RatingCard';
import { formatTiyin, somToTiyin } from '../../shared/utils/money';

export function DriversPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useList<Driver>('drivers', page);
  const { remove } = useCrudMutations('drivers');

  const drivers = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;

  return (
    <div>
      <PageHeader
        title={t('drivers.title')}
        actions={<Button onClick={() => setShowForm(true)}>+ {t('drivers.new')}</Button>}
      />
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : drivers.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Table
            headers={[
              t('drivers.fullName'),
              t('drivers.phone'),
              t('drivers.license'),
              t('drivers.licenseExpiry'),
              t('drivers.salaryType'),
              t('drivers.salaryValue'),
              t('common.actions'),
            ]}
          >
            {drivers.map((driver) => (
              <Row key={driver.id}>
                <Cell className="font-semibold">
                  {driver.fullName}{' '}
                  {!driver.isActive && <Badge tone="gray">{t('common.deactivate')}</Badge>}
                </Cell>
                <Cell>{driver.phone ?? '—'}</Cell>
                <Cell>{driver.licenseNumber ?? '—'}</Cell>
                <Cell>{formatDate(driver.licenseExpiry)}</Cell>
                <Cell>
                  {driver.salaryType ? t(`drivers.salaryTypes.${driver.salaryType}`) : '—'}
                </Cell>
                <Cell className="tabular-nums">
                  {driver.salaryType === 'PERCENT'
                    ? driver.salaryValue
                      ? `${Number(driver.salaryValue) / 100}%`
                      : '—'
                    : formatTiyin(driver.salaryValue)}
                </Cell>
                <Cell>
                  {driver.isActive && (
                    <button
                      className="text-xs text-danger hover:underline"
                      onClick={() =>
                        window.confirm(t('common.confirmDeactivate')) &&
                        void remove.mutateAsync(driver.id)
                      }
                    >
                      {t('common.deactivate')}
                    </button>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}
      <RatingCard />

      <DriverFormModal open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}

function DriverFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { create } = useCrudMutations('drivers');
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    licenseNumber: '',
    licenseExpiry: '',
    hireDate: '',
    salaryType: '' as '' | SalaryType,
    salaryValue: '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    // PERCENT is basis points (1% = 100); money types are so'm → tiyin.
    const salaryValue = !form.salaryValue
      ? undefined
      : form.salaryType === 'PERCENT'
        ? String(Math.round(Number(form.salaryValue) * 100))
        : (somToTiyin(form.salaryValue) ?? undefined);
    await create.mutateAsync({
      fullName: form.fullName,
      phone: form.phone || undefined,
      licenseNumber: form.licenseNumber || undefined,
      licenseExpiry: form.licenseExpiry ? new Date(form.licenseExpiry).toISOString() : undefined,
      hireDate: form.hireDate ? new Date(form.hireDate).toISOString() : undefined,
      salaryType: form.salaryType || undefined,
      salaryValue,
    });
    onClose();
  }

  return (
    <Modal title={t('drivers.new')} open={open} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <Field label={t('drivers.fullName')}>
          <Input value={form.fullName} onChange={set('fullName')} required />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('drivers.phone')}>
            <Input value={form.phone} onChange={set('phone')} placeholder="+99890XXXXXXX" />
          </Field>
          <Field label={t('drivers.hireDate')}>
            <Input type="date" value={form.hireDate} onChange={set('hireDate')} />
          </Field>
          <Field label={t('drivers.license')}>
            <Input value={form.licenseNumber} onChange={set('licenseNumber')} />
          </Field>
          <Field label={t('drivers.licenseExpiry')}>
            <Input type="date" value={form.licenseExpiry} onChange={set('licenseExpiry')} />
          </Field>
          <Field label={t('drivers.salaryType')}>
            <Select value={form.salaryType} onChange={set('salaryType')}>
              <option value="">{t('common.select')}</option>
              {Object.values(SalaryType).map((type) => (
                <option key={type} value={type}>
                  {t(`drivers.salaryTypes.${type}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('drivers.salaryValue')} hint={t('drivers.salaryHint')}>
            <Input inputMode="numeric" value={form.salaryValue} onChange={set('salaryValue')} />
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
