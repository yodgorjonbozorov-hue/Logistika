import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Currency } from 'shared';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  Textarea,
} from '../../shared/ui';
import { Icon } from '../../shared/ui/icons';
import { dateInputToIso } from '../../shared/utils/date';
import { somToTiyin } from '../../shared/utils/money';
import { useRefLists, useTripMutations } from './api';

const EMPTY = {
  clientId: '',
  cargoName: '',
  cargoWeight: '',
  loadingAddress: '',
  loadingDate: '',
  unloadingAddress: '',
  unloadingDate: '',
  plannedDistanceKm: '',
  agreedPrice: '',
  currency: Currency.UZS as Currency,
  driverAdvance: '',
  driverId: '',
  vehicleId: '',
  trailerId: '',
  notes: '',
};

export function TripCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { vehicles, drivers, clients } = useRefLists();
  const { create } = useTripMutations();
  const [form, setForm] = useState(EMPTY);
  const [invalidMoney, setInvalidMoney] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const trucks = (vehicles.data ?? []).filter((v) => v.type !== 'TRAILER' && v.isActive);
  const trailers = (vehicles.data ?? []).filter((v) => v.type === 'TRAILER' && v.isActive);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setInvalidMoney(null);

    // so'm → tiyin happens here; a malformed amount must never reach the API.
    const agreedPrice = form.agreedPrice ? somToTiyin(form.agreedPrice) : undefined;
    const driverAdvance = form.driverAdvance ? somToTiyin(form.driverAdvance) : undefined;
    if ((form.agreedPrice && !agreedPrice) || (form.driverAdvance && !driverAdvance)) {
      setInvalidMoney(t('common.errorGeneric'));
      return;
    }

    const trip = await create.mutateAsync({
      clientId: form.clientId || undefined,
      cargoName: form.cargoName || undefined,
      cargoWeight: form.cargoWeight ? Number(form.cargoWeight) : undefined,
      loadingAddress: form.loadingAddress || undefined,
      loadingDate: form.loadingDate ? dateInputToIso(form.loadingDate) : undefined,
      unloadingAddress: form.unloadingAddress || undefined,
      unloadingDate: form.unloadingDate ? dateInputToIso(form.unloadingDate) : undefined,
      plannedDistanceKm: form.plannedDistanceKm ? Number(form.plannedDistanceKm) : undefined,
      agreedPrice,
      currency: form.currency,
      driverAdvance,
      driverId: form.driverId || undefined,
      vehicleId: form.vehicleId || undefined,
      trailerId: form.trailerId || undefined,
      notes: form.notes || undefined,
    });

    navigate(`/trips/${trip.id}`, { state: { created: trip.tripNumber } });
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t('trips.newTitle')}
        actions={
          <Button variant="secondary" onClick={() => navigate('/trips')}>
            <Icon name="chevronLeft" className="h-4 w-4" />
            {t('common.back')}
          </Button>
        }
      />

      <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
        <Card>
          <SectionTitle>{t('trips.sections.main')}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('trips.client')}>
              <Select value={form.clientId} onChange={set('clientId')}>
                <option value="">{t('common.select')}</option>
                {(clients.data ?? []).map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            </Field>
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
            <Field label={t('trips.plannedKm')}>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={form.plannedDistanceKm}
                onChange={set('plannedDistanceKm')}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <SectionTitle>{t('trips.sections.route')}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('trips.loadingAddress')}>
              <Input value={form.loadingAddress} onChange={set('loadingAddress')} />
            </Field>
            <Field label={t('trips.loadingDate')}>
              <Input type="date" value={form.loadingDate} onChange={set('loadingDate')} />
            </Field>
            <Field label={t('trips.unloadingAddress')}>
              <Input value={form.unloadingAddress} onChange={set('unloadingAddress')} />
            </Field>
            <Field label={t('trips.unloadingDate')}>
              <Input type="date" value={form.unloadingDate} onChange={set('unloadingDate')} />
            </Field>
          </div>
        </Card>

        <Card>
          <SectionTitle>{t('trips.sections.assignment')}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('trips.driver')}>
              <Select value={form.driverId} onChange={set('driverId')}>
                <option value="">{t('common.select')}</option>
                {(drivers.data ?? [])
                  .filter((driver) => driver.isActive)
                  .map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.fullName}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('trips.vehicle')}>
              <Select value={form.vehicleId} onChange={set('vehicleId')}>
                <option value="">{t('common.select')}</option>
                {trucks.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plateNumber}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('trips.trailer')}>
              <Select value={form.trailerId} onChange={set('trailerId')}>
                <option value="">{t('common.select')}</option>
                {trailers.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plateNumber}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <SectionTitle>{t('trips.sections.money')}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('trips.price')}>
              <Input
                inputMode="numeric"
                value={form.agreedPrice}
                onChange={set('agreedPrice')}
                placeholder="0"
              />
            </Field>
            <Field label={t('trips.currency')}>
              <Select value={form.currency} onChange={set('currency')}>
                {Object.values(Currency).map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('trips.advance')}>
              <Input
                inputMode="numeric"
                value={form.driverAdvance}
                onChange={set('driverAdvance')}
                placeholder="0"
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label={t('trips.comment')}>
              <Textarea value={form.notes} onChange={set('notes')} maxLength={1000} />
            </Field>
          </div>
        </Card>

        <ErrorMessage error={invalidMoney ? new Error(invalidMoney) : create.error} />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/trips')}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" size="lg" disabled={create.isPending}>
            {create.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
