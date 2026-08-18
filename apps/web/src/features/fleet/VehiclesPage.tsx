import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { VehicleType } from 'shared';
import { useCrudMutations } from '../../shared/api/crud';
import { useAllTrips, useVehicles } from '../../shared/api/queries';
import type { Trip, Vehicle } from '../../shared/api/entities';
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
  Select,
  Spinner,
  StatusChip,
  Table,
} from '../../shared/ui';
import { dateInputToIso, formatDate } from '../../shared/utils/date';
import { RESOURCE_STATE_TONE, vehicleState } from '../../shared/utils/status';
import { busyResourceIds, openTrips } from '../overview/metrics';

export function VehiclesPage() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const { data: vehicles, isLoading, error } = useVehicles();
  const trips = useAllTrips();

  const rows = useMemo(() => {
    const busy = busyResourceIds(trips.data ?? []);
    const tripByVehicle = new Map<string, Trip>();
    for (const trip of openTrips(trips.data ?? [])) {
      if (trip.vehicleId && !tripByVehicle.has(trip.vehicleId)) {
        tripByVehicle.set(trip.vehicleId, trip);
      }
    }
    return (vehicles ?? []).map((vehicle) => {
      const trip = tripByVehicle.get(vehicle.id) ?? null;
      return {
        vehicle,
        trip,
        state: vehicleState({
          isActive: vehicle.isActive,
          hasOpenTrip: busy.vehicles.has(vehicle.id),
        }),
      };
    });
  }, [vehicles, trips.data]);

  const counts = useMemo(() => {
    const summary = { ON_TRIP: 0, AVAILABLE: 0, MAINTENANCE: 0, INACTIVE: 0 };
    for (const row of rows) summary[row.state] += 1;
    return summary;
  }, [rows]);

  return (
    <div>
      <PageHeader
        title={t('vehicles.title')}
        subtitle={t('vehicles.subtitle', {
          total: rows.length,
          onTrip: counts.ON_TRIP,
          free: counts.AVAILABLE,
        })}
        actions={
          <Button icon="plus" onClick={() => setShowForm(true)}>
            {t('vehicles.new')}
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
                <th className="pl-[18px]">{t('vehicles.plate')}</th>
                <th>{t('vehicles.type')}</th>
                <th>{t('trips.driver')}</th>
                <th>{t('trips.status')}</th>
                <th>{t('vehicles.currentTrip')}</th>
                <th className="text-right">{t('vehicles.odometer')}</th>
                <th className="pl-4">{t('vehicles.techExpiry')}</th>
                <th className="pr-[18px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ vehicle, trip, state }) => (
                <Row key={vehicle.id}>
                  <Cell className="pl-[18px]">
                    <div className="whitespace-nowrap font-semibold">{vehicle.plateNumber}</div>
                    <div className="text-[11.5px] text-neutral-500">
                      {[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(' · ') ||
                        '—'}
                    </div>
                  </Cell>
                  <Cell className="text-neutral-400">{t(`vehicles.types.${vehicle.type}`)}</Cell>
                  <Cell className="whitespace-nowrap">{trip?.driver?.fullName ?? '—'}</Cell>
                  <Cell>
                    <StatusChip tone={RESOURCE_STATE_TONE[state]}>
                      {t(`resourceState.${state}`)}
                    </StatusChip>
                  </Cell>
                  <Cell className="font-medium tabular-nums text-accent-300">
                    {trip?.tripNumber ?? '—'}
                  </Cell>
                  <Cell align="right" className="text-neutral-400">
                    {vehicle.currentOdometer != null
                      ? `${vehicle.currentOdometer.toLocaleString()} km`
                      : '—'}
                  </Cell>
                  <Cell className="whitespace-nowrap pl-4 text-neutral-500">
                    {formatDate(vehicle.techInspectionExpiry)}
                  </Cell>
                  <Cell className="pr-[18px] text-right">
                    <Icon
                      name="dots-three"
                      size={16}
                      style={{ color: 'var(--color-neutral-500)' }}
                    />
                  </Cell>
                </Row>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

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
    setForm((current) => ({ ...current, [key]: e.target.value }));

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
      insuranceExpiry: dateInputToIso(form.insuranceExpiry),
      techInspectionExpiry: dateInputToIso(form.techInspectionExpiry),
    } satisfies Record<string, unknown>);
    onClose();
  }

  return (
    <Modal title={t('vehicles.new')} open={open} onClose={onClose} width={560}>
      <form onSubmit={(e) => void onSubmit(e)}>
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

export type { Vehicle };
