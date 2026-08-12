import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { VehicleType } from 'shared';
import type { Vehicle } from '../../shared/api/entities';
import { useCrudMutations, useList } from '../../shared/api/crud';
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
import { dateInputToIso } from '../../shared/utils/date';
import { somToTiyin } from '../../shared/utils/money';

export function VehiclesPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useList<Vehicle>('vehicles', page);
  const { remove } = useCrudMutations('vehicles');

  const vehicles = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;

  return (
    <div>
      <PageHeader
        title={t('vehicles.title')}
        actions={<Button onClick={() => setShowForm(true)}>+ {t('vehicles.new')}</Button>}
      />
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : vehicles.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Table
            headers={[
              t('vehicles.plate'),
              t('vehicles.type'),
              t('vehicles.brand'),
              t('vehicles.fuelNorm'),
              t('vehicles.odometer'),
              t('vehicles.insuranceExpiry'),
              t('common.actions'),
            ]}
          >
            {vehicles.map((vehicle) => (
              <Row key={vehicle.id}>
                <Cell className="font-semibold">
                  {vehicle.plateNumber}{' '}
                  {!vehicle.isActive && <Badge tone="gray">{t('common.deactivate')}</Badge>}
                </Cell>
                <Cell>{t(`vehicles.types.${vehicle.type}`)}</Cell>
                <Cell>
                  {vehicle.brand ?? '—'} {vehicle.model ?? ''}
                </Cell>
                <Cell>{vehicle.fuelNormPer100km ?? '—'}</Cell>
                <Cell className="tabular-nums">{vehicle.currentOdometer ?? '—'}</Cell>
                <Cell>{formatDate(vehicle.insuranceExpiry)}</Cell>
                <Cell>
                  {vehicle.isActive && (
                    <button
                      className="text-xs text-danger hover:underline"
                      onClick={() =>
                        window.confirm(t('common.confirmDeactivate')) &&
                        void remove.mutateAsync(vehicle.id)
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
    purchasePrice: '',
    plannedTotalKm: '',
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
      purchasePrice: form.purchasePrice ? somToTiyin(form.purchasePrice) : undefined,
      plannedTotalKm: form.plannedTotalKm ? Number(form.plannedTotalKm) : undefined,
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
          <Field label={t('vehicles.purchasePrice')} hint={t('vehicles.purchasePriceHint')}>
            <Input inputMode="numeric" value={form.purchasePrice} onChange={set('purchasePrice')} />
          </Field>
          <Field label={t('vehicles.plannedTotalKm')}>
            <Input
              type="number"
              min="1"
              value={form.plannedTotalKm}
              onChange={set('plannedTotalKm')}
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
