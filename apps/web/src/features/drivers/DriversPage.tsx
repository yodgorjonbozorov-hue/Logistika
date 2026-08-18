import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SalaryType } from 'shared';
import { useCrudMutations, useList } from '../../shared/api/crud';
import type { Driver } from '../../shared/api/entities';
import { useAuth } from '../../shared/auth/AuthContext';
import { can } from '../../shared/auth/permissions';
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
  Select,
  Skeleton,
  Toolbar,
  type Column,
} from '../../shared/ui';
import { formatDate } from '../../shared/utils/date';
import { formatTiyin, somToTiyin } from '../../shared/utils/money';

/** PERCENT is stored as basis points; every other type is tiyin. */
export function formatSalary(driver: Driver): string {
  if (!driver.salaryValue) return '—';
  if (driver.salaryType === 'PERCENT') return `${Number(driver.salaryValue) / 100}%`;
  return formatTiyin(driver.salaryValue);
}

export function DriversPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { role } = useAuth();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [term, setTerm] = useState('');
  const { data, isLoading, error } = useList<Driver>('drivers', page);
  const { remove } = useCrudMutations('drivers');

  const total = data?.meta?.pagination?.total ?? 0;
  const drivers = (data?.data ?? []).filter((driver) =>
    term
      ? `${driver.fullName} ${driver.phone ?? ''} ${driver.licenseNumber ?? ''}`
          .toLowerCase()
          .includes(term.toLowerCase())
      : true,
  );

  const columns: Array<Column<Driver>> = [
    {
      key: 'name',
      header: t('drivers.fullName'),
      primary: true,
      cell: (driver) => driver.fullName,
    },
    {
      key: 'status',
      header: t('drivers.status'),
      secondary: true,
      cell: (driver) => (
        <Badge tone={driver.isActive ? 'green' : 'gray'}>
          {driver.isActive ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
    },
    { key: 'phone', header: t('drivers.phone'), cell: (driver) => driver.phone ?? '—' },
    { key: 'license', header: t('drivers.license'), cell: (driver) => driver.licenseNumber ?? '—' },
    {
      key: 'licenseExpiry',
      header: t('drivers.licenseExpiry'),
      cell: (driver) => formatDate(driver.licenseExpiry),
    },
    {
      key: 'salaryType',
      header: t('drivers.salaryType'),
      cell: (driver) => (driver.salaryType ? t(`drivers.salaryTypes.${driver.salaryType}`) : '—'),
    },
    {
      key: 'salaryValue',
      header: t('drivers.salaryValue'),
      className: 'money',
      cell: formatSalary,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      desktopOnly: true,
      cell: (driver) =>
        driver.isActive && can(role, 'deactivate') ? (
          <button
            className="text-xs text-danger hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              if (window.confirm(t('common.confirmDeactivate'))) {
                void remove.mutateAsync(driver.id);
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
      <PageHeader
        title={t('drivers.title')}
        subtitle={t('drivers.subtitle')}
        actions={
          can(role, 'manageFleet') ? (
            <Button onClick={() => setShowForm(true)}>+ {t('drivers.new')}</Button>
          ) : null
        }
      />
      <Toolbar>
        <div className="w-full sm:w-64">
          <Field label={t('common.search')}>
            <Input
              value={term}
              placeholder={t('common.searchPlaceholder')}
              onChange={(event) => setTerm(event.target.value)}
            />
          </Field>
        </div>
      </Toolbar>
      <ErrorMessage error={error} />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <DataTable
            rows={drivers}
            columns={columns}
            getKey={(driver) => driver.id}
            onRowClick={(driver) => navigate(`/drivers/${driver.id}`)}
          />
          {!term ? <Pagination page={page} limit={20} total={total} onPage={setPage} /> : null}
        </>
      )}
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
        <div className="grid grid-cols-2 gap-3">
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
