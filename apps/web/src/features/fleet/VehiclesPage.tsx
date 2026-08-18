import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { VehicleType } from 'shared';
import type { Vehicle } from '../../shared/api/entities';
import { useCrudMutations, useList } from '../../shared/api/crud';
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
  type Column,
} from '../../shared/ui';
import { dateInputToIso, formatDate } from '../../shared/utils/date';

export function VehiclesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { role } = useAuth();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useList<Vehicle>('vehicles', page);
  const { remove } = useCrudMutations('vehicles');

  const vehicles = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;

  const columns: Array<Column<Vehicle>> = [
    {
      key: 'plate',
      header: t('vehicles.plate'),
      primary: true,
      cell: (vehicle) => vehicle.plateNumber,
    },
    {
      key: 'status',
      header: t('vehicles.status'),
      secondary: true,
      cell: (vehicle) => (
        <Badge tone={vehicle.isActive ? 'green' : 'gray'}>
          {vehicle.isActive ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
    },
    {
      key: 'type',
      header: t('vehicles.type'),
      cell: (vehicle) => t(`vehicles.types.${vehicle.type}`),
    },
    {
      key: 'brand',
      header: t('vehicles.brand'),
      cell: (vehicle) => [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || '—',
    },
    {
      key: 'norm',
      header: t('vehicles.fuelNorm'),
      cell: (vehicle) => vehicle.fuelNormPer100km ?? '—',
    },
    {
      key: 'odometer',
      header: t('vehicles.odometer'),
      className: 'money',
      cell: (vehicle) => vehicle.currentOdometer ?? '—',
    },
    {
      key: 'insurance',
      header: t('vehicles.insuranceExpiry'),
      cell: (vehicle) => formatDate(vehicle.insuranceExpiry),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      desktopOnly: true,
      cell: (vehicle) =>
        vehicle.isActive && can(role, 'deactivate') ? (
          <button
            className="text-xs text-danger hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              if (window.confirm(t('common.confirmDeactivate'))) {
                void remove.mutateAsync(vehicle.id);
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
        title={t('vehicles.title')}
        subtitle={t('vehicles.subtitle')}
        actions={
          can(role, 'manageFleet') ? (
            <Button onClick={() => setShowForm(true)}>+ {t('vehicles.new')}</Button>
          ) : null
        }
      />
      <ErrorMessage error={error} />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <DataTable
            rows={vehicles}
            columns={columns}
            getKey={(vehicle) => vehicle.id}
            onRowClick={(vehicle) => navigate(`/vehicles/${vehicle.id}`)}
          />
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}
      <VehicleFormModal open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}

function VehicleFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { create } = useCrudMutations('vehicles');
  const [form, setForm] = useState({
    plateNumber: '',
    type: VehicleType.TRUCK as VehicleType,
    brand: '',
    model: '',
    year: '',
    fuelNormPer100km: '',
    currentOdometer: '',
    insuranceExpiry: '',
    techInspectionExpiry: '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      plateNumber: form.plateNumber,
      type: form.type,
      brand: form.brand || undefined,
      model: form.model || undefined,
      year: form.year ? Number(form.year) : undefined,
      fuelNormPer100km: form.fuelNormPer100km ? Number(form.fuelNormPer100km) : undefined,
      currentOdometer: form.currentOdometer ? Number(form.currentOdometer) : undefined,
      insuranceExpiry: form.insuranceExpiry ? dateInputToIso(form.insuranceExpiry) : undefined,
      techInspectionExpiry: form.techInspectionExpiry
        ? dateInputToIso(form.techInspectionExpiry)
        : undefined,
    });
    onClose();
  }

  return (
    <Modal title={t('vehicles.new')} open={open} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('vehicles.plate')}>
            <Input value={form.plateNumber} onChange={set('plateNumber')} required />
          </Field>
          <Field label={t('vehicles.type')}>
            <Select value={form.type} onChange={set('type')}>
              {Object.values(VehicleType).map((type) => (
                <option key={type} value={type}>
                  {t(`vehicles.types.${type}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('vehicles.brand')}>
            <Input value={form.brand} onChange={set('brand')} />
          </Field>
          <Field label={t('vehicles.model')}>
            <Input value={form.model} onChange={set('model')} />
          </Field>
          <Field label={t('vehicles.year')}>
            <Input type="number" min="1950" max="2100" value={form.year} onChange={set('year')} />
          </Field>
          <Field label={t('vehicles.fuelNorm')}>
            <Input
              type="number"
              step="0.1"
              min="0"
              value={form.fuelNormPer100km}
              onChange={set('fuelNormPer100km')}
            />
          </Field>
          <Field label={t('vehicles.odometer')}>
            <Input
              type="number"
              min="0"
              value={form.currentOdometer}
              onChange={set('currentOdometer')}
            />
          </Field>
          <Field label={t('vehicles.insuranceExpiry')}>
            <Input type="date" value={form.insuranceExpiry} onChange={set('insuranceExpiry')} />
          </Field>
          <Field label={t('vehicles.techExpiry')}>
            <Input
              type="date"
              value={form.techInspectionExpiry}
              onChange={set('techInspectionExpiry')}
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
