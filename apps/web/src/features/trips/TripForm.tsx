import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ErrorMessage, Field, Input, Modal, Select } from '../../shared/ui';
import { dateInputToIso } from '../../shared/utils/date';
import { somToTiyin } from '../../shared/utils/money';
import { useRefLists, useTripMutations } from './api';

export function TripFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { vehicles, drivers, clients } = useRefLists();
  const { create } = useTripMutations();

  const [form, setForm] = useState({
    clientId: '',
    vehicleId: '',
    trailerId: '',
    driverId: '',
    cargoName: '',
    cargoWeight: '',
    loadingAddress: '',
    loadingDate: '',
    unloadingAddress: '',
    unloadingDate: '',
    plannedDistanceKm: '',
    agreedPrice: '',
    driverAdvance: '',
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      clientId: form.clientId || undefined,
      vehicleId: form.vehicleId || undefined,
      trailerId: form.trailerId || undefined,
      driverId: form.driverId || undefined,
      cargoName: form.cargoName || undefined,
      cargoWeight: form.cargoWeight ? Number(form.cargoWeight) : undefined,
      loadingAddress: form.loadingAddress || undefined,
      loadingDate: form.loadingDate ? dateInputToIso(form.loadingDate) : undefined,
      unloadingAddress: form.unloadingAddress || undefined,
      unloadingDate: form.unloadingDate ? dateInputToIso(form.unloadingDate) : undefined,
      plannedDistanceKm: form.plannedDistanceKm ? Number(form.plannedDistanceKm) : undefined,
      agreedPrice: form.agreedPrice ? (somToTiyin(form.agreedPrice) ?? undefined) : undefined,
      driverAdvance: form.driverAdvance ? (somToTiyin(form.driverAdvance) ?? undefined) : undefined,
    });
    onClose();
  }

  const trucks = (vehicles.data ?? []).filter((v) => v.type !== 'TRAILER' && v.isActive);
  const trailers = (vehicles.data ?? []).filter((v) => v.type === 'TRAILER' && v.isActive);

  return (
    <Modal title={t('trips.new')} open={open} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <Field label={t('trips.client')}>
          <Select value={form.clientId} onChange={set('clientId')}>
            <option value="">{t('common.select')}</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('trips.cargoName')}>
            <Input value={form.cargoName} onChange={set('cargoName')} />
          </Field>
          <Field label={t('trips.cargoWeight')}>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.cargoWeight}
              onChange={set('cargoWeight')}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('trips.loadingAddress')}>
            <Input value={form.loadingAddress} onChange={set('loadingAddress')} />
          </Field>
          <Field label={t('trips.loadingDate')}>
            <Input type="date" value={form.loadingDate} onChange={set('loadingDate')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('trips.unloadingAddress')}>
            <Input value={form.unloadingAddress} onChange={set('unloadingAddress')} />
          </Field>
          <Field label={t('trips.unloadingDate')}>
            <Input type="date" value={form.unloadingDate} onChange={set('unloadingDate')} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('trips.vehicle')}>
            <Select value={form.vehicleId} onChange={set('vehicleId')}>
              <option value="">{t('common.select')}</option>
              {trucks.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('trips.trailer')}>
            <Select value={form.trailerId} onChange={set('trailerId')}>
              <option value="">{t('common.select')}</option>
              {trailers.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('trips.driver')}>
            <Select value={form.driverId} onChange={set('driverId')}>
              <option value="">{t('common.select')}</option>
              {(drivers.data ?? [])
                .filter((d) => d.isActive)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('trips.plannedKm')}>
            <Input
              type="number"
              step="0.1"
              min="0"
              value={form.plannedDistanceKm}
              onChange={set('plannedDistanceKm')}
            />
          </Field>
          <Field label={t('trips.price')}>
            <Input inputMode="numeric" value={form.agreedPrice} onChange={set('agreedPrice')} />
          </Field>
          <Field label={t('trips.advance')}>
            <Input inputMode="numeric" value={form.driverAdvance} onChange={set('driverAdvance')} />
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
