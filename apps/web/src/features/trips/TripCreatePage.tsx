import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Currency } from 'shared';
import { useAllTrips } from '../../shared/api/queries';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  Icon,
  Input,
  Segmented,
  Select,
  Tag,
  Textarea,
} from '../../shared/ui';
import { dateInputToIso } from '../../shared/utils/date';
import { somToTiyin } from '../../shared/utils/money';
import { busyResourceIds } from '../overview/metrics';
import { useRefLists, useTripMutations } from './api';

const STEPS = [1, 2, 3, 4, 5] as const;
type Step = (typeof STEPS)[number];

interface FormState {
  clientId: string;
  loadingDate: string;
  unloadingDate: string;
  agreedPrice: string;
  currency: Currency;
  driverAdvance: string;
  vehicleId: string;
  trailerId: string;
  driverId: string;
  loadingAddress: string;
  unloadingAddress: string;
  plannedDistanceKm: string;
  cargoName: string;
  cargoWeight: string;
  cargoVolume: string;
  notes: string;
}

const EMPTY: FormState = {
  clientId: '',
  loadingDate: '',
  unloadingDate: '',
  agreedPrice: '',
  currency: Currency.UZS,
  driverAdvance: '',
  vehicleId: '',
  trailerId: '',
  driverId: '',
  loadingAddress: '',
  unloadingAddress: '',
  plannedDistanceKm: '',
  cargoName: '',
  cargoWeight: '',
  cargoVolume: '',
  notes: '',
};

export function TripCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { vehicles, drivers, clients } = useRefLists();
  const trips = useAllTrips();
  const { create } = useTripMutations();

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(EMPTY);

  const set =
    <K extends keyof FormState>(key: K) =>
    (value: FormState[K]) =>
      setForm((current) => ({ ...current, [key]: value }));

  /** Only resources not already riding an open trip can be booked. */
  const free = useMemo(() => {
    const busy = busyResourceIds(trips.data ?? []);
    return {
      vehicles: (vehicles.data ?? []).filter(
        (vehicle) =>
          vehicle.isActive && vehicle.type !== 'TRAILER' && !busy.vehicles.has(vehicle.id),
      ),
      trailers: (vehicles.data ?? []).filter(
        (vehicle) =>
          vehicle.isActive && vehicle.type === 'TRAILER' && !busy.vehicles.has(vehicle.id),
      ),
      drivers: (drivers.data ?? []).filter(
        (driver) => driver.isActive && !busy.drivers.has(driver.id),
      ),
    };
  }, [trips.data, vehicles.data, drivers.data]);

  async function submit(asDraft: boolean) {
    const created = await create.mutateAsync({
      clientId: form.clientId || undefined,
      vehicleId: asDraft ? undefined : form.vehicleId || undefined,
      trailerId: asDraft ? undefined : form.trailerId || undefined,
      driverId: asDraft ? undefined : form.driverId || undefined,
      cargoName: form.cargoName || undefined,
      cargoWeight: form.cargoWeight ? Number(form.cargoWeight) : undefined,
      cargoVolume: form.cargoVolume ? Number(form.cargoVolume) : undefined,
      loadingAddress: form.loadingAddress || undefined,
      loadingDate: dateInputToIso(form.loadingDate),
      unloadingAddress: form.unloadingAddress || undefined,
      unloadingDate: dateInputToIso(form.unloadingDate),
      plannedDistanceKm: form.plannedDistanceKm ? Number(form.plannedDistanceKm) : undefined,
      currency: form.currency,
      agreedPrice: form.agreedPrice ? (somToTiyin(form.agreedPrice) ?? undefined) : undefined,
      driverAdvance: form.driverAdvance ? (somToTiyin(form.driverAdvance) ?? undefined) : undefined,
    });
    navigate(`/trips/${created.data.id}`);
  }

  return (
    <div className="max-w-[980px]">
      <div className="mb-2.5 flex items-center gap-1.5 text-[12.5px] text-neutral-500">
        <Link to="/trips">{t('trips.title')}</Link>
        <Icon name="caret-right" size={10} />
        <span>{t('trips.new')}</span>
      </div>

      <div className="mb-5 flex items-center gap-3">
        <h3 className="m-0 text-[22px]">{t('trips.createTitle')}</h3>
        <Tag variant="outline" className="text-[11.5px] tabular-nums">
          {t('trips.numberAuto')}
        </Tag>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[240px_1fr]">
        <div className="flex flex-col gap-0.5">
          {STEPS.map((n) => (
            <StepButton key={n} n={n} current={step} onClick={() => setStep(n)} />
          ))}
        </div>

        <Card className="px-[22px] py-5">
          {step === 1 ? (
            <>
              <StepTitle>{t('trips.steps.1.title')}</StepTitle>
              <div className="grid gap-3.5 md:grid-cols-2">
                <Field label={t('trips.number')} hint={t('trips.numberHint')}>
                  <Input value={t('trips.numberAuto')} disabled className="tabular-nums" />
                </Field>
                <Field label={t('trips.client')}>
                  <Select value={form.clientId} onChange={(e) => set('clientId')(e.target.value)}>
                    <option value="">{t('common.select')}</option>
                    {(clients.data ?? []).map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('trips.loadingDate')}>
                  <Input
                    type="date"
                    value={form.loadingDate}
                    onChange={(e) => set('loadingDate')(e.target.value)}
                  />
                </Field>
                <Field label={t('trips.unloadingDate')}>
                  <Input
                    type="date"
                    value={form.unloadingDate}
                    onChange={(e) => set('unloadingDate')(e.target.value)}
                  />
                </Field>
                <Field label={t('trips.agreedPrice')}>
                  <div className="flex gap-2">
                    <Input
                      inputMode="numeric"
                      value={form.agreedPrice}
                      onChange={(e) => set('agreedPrice')(e.target.value)}
                      className="flex-1 tabular-nums"
                    />
                    <Segmented<Currency>
                      className="shrink-0"
                      value={form.currency}
                      onChange={set('currency')}
                      options={[
                        { value: Currency.UZS, label: Currency.UZS },
                        { value: Currency.USD, label: Currency.USD },
                      ]}
                    />
                  </div>
                </Field>
                <Field label={t('trips.advance')}>
                  <Input
                    inputMode="numeric"
                    value={form.driverAdvance}
                    onChange={(e) => set('driverAdvance')(e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <StepTitle subtitle={t('trips.steps.2.subtitle')}>
                {t('trips.steps.2.title')}
              </StepTitle>
              <div className="grid gap-3.5 md:grid-cols-2">
                <PickList
                  label={t('trips.vehicle')}
                  emptyLabel={t('trips.noFreeVehicles')}
                  options={free.vehicles.map((vehicle) => ({
                    id: vehicle.id,
                    title: vehicle.plateNumber,
                    subtitle: [vehicle.brand, vehicle.model, vehicle.year]
                      .filter(Boolean)
                      .join(' · '),
                  }))}
                  value={form.vehicleId}
                  onChange={set('vehicleId')}
                />
                <PickList
                  label={t('trips.driver')}
                  emptyLabel={t('trips.noFreeDrivers')}
                  options={free.drivers.map((driver) => ({
                    id: driver.id,
                    title: driver.fullName,
                    subtitle: [driver.licenseNumber, driver.phone].filter(Boolean).join(' · '),
                  }))}
                  value={form.driverId}
                  onChange={set('driverId')}
                />
              </div>
              {free.trailers.length > 0 ? (
                <div className="mt-3.5 max-w-[50%]">
                  <Field label={t('trips.trailer')}>
                    <Select
                      value={form.trailerId}
                      onChange={(e) => set('trailerId')(e.target.value)}
                    >
                      <option value="">{t('common.select')}</option>
                      {free.trailers.map((trailer) => (
                        <option key={trailer.id} value={trailer.id}>
                          {trailer.plateNumber}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              ) : null}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <StepTitle>{t('trips.steps.3.title')}</StepTitle>
              <div className="mb-3.5 grid gap-3.5 md:grid-cols-2">
                <Field label={t('trips.loadingAddress')}>
                  <Input
                    value={form.loadingAddress}
                    onChange={(e) => set('loadingAddress')(e.target.value)}
                  />
                </Field>
                <Field label={t('trips.unloadingAddress')}>
                  <Input
                    value={form.unloadingAddress}
                    onChange={(e) => set('unloadingAddress')(e.target.value)}
                  />
                </Field>
                <Field label={t('trips.plannedKm')}>
                  <Input
                    inputMode="numeric"
                    value={form.plannedDistanceKm}
                    onChange={(e) => set('plannedDistanceKm')(e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
              </div>
              <div
                className="flex gap-5 rounded-md px-3.5 py-3 text-[12.5px]"
                style={{
                  background: 'color-mix(in srgb, var(--color-neutral-900) 70%, transparent)',
                }}
              >
                <div>
                  <span className="text-neutral-500">{t('trips.distanceLabel')}:</span>{' '}
                  <b>{form.plannedDistanceKm ? `${form.plannedDistanceKm} km` : '—'}</b>
                </div>
                <div>
                  <span className="text-neutral-500">{t('trips.fuelNorm')}:</span>{' '}
                  <b>
                    {estimateFuel(
                      form.plannedDistanceKm,
                      fuelNormOf(free.vehicles, form.vehicleId),
                    )}
                  </b>
                </div>
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <StepTitle>{t('trips.steps.4.title')}</StepTitle>
              <div className="grid gap-3.5 md:grid-cols-2">
                <Field label={t('trips.cargoName')}>
                  <Input
                    value={form.cargoName}
                    onChange={(e) => set('cargoName')(e.target.value)}
                  />
                </Field>
                <Field label={t('trips.cargoWeight')}>
                  <Input
                    inputMode="decimal"
                    value={form.cargoWeight}
                    onChange={(e) => set('cargoWeight')(e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
                <Field label={t('trips.cargoVolume')}>
                  <Input
                    inputMode="decimal"
                    value={form.cargoVolume}
                    onChange={(e) => set('cargoVolume')(e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
                <Field label={t('finance.description')} className="md:col-span-2">
                  <Textarea
                    rows={3}
                    value={form.notes}
                    onChange={(e) => set('notes')(e.target.value)}
                  />
                </Field>
              </div>
            </>
          ) : null}

          {step === 5 ? (
            <>
              <StepTitle>{t('trips.steps.5.title')}</StepTitle>
              <div className="flex flex-col text-[13px]">
                <ReviewRow label={t('trips.client')} value={nameOf(clients.data, form.clientId)} />
                <ReviewRow
                  label={t('trips.vehicleDriver')}
                  value={[
                    plateOf(free.vehicles, form.vehicleId),
                    nameOf(free.drivers, form.driverId, 'fullName'),
                  ]
                    .filter((part) => part !== '—')
                    .join(' · ')}
                />
                <ReviewRow
                  label={t('trips.route')}
                  value={`${form.loadingAddress || '—'} → ${form.unloadingAddress || '—'}`}
                />
                <ReviewRow
                  label={t('trips.cargoName')}
                  value={[
                    form.cargoName,
                    form.cargoWeight ? `${form.cargoWeight} ${t('common.ton')}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
                <ReviewRow
                  label={t('trips.dates')}
                  value={`${form.loadingDate || '—'} → ${form.unloadingDate || '—'}`}
                />
                <ReviewRow
                  label={t('trips.priceAdvance')}
                  value={`${form.agreedPrice || '0'} / ${form.driverAdvance || '0'} ${form.currency}`}
                  last
                  strong
                />
              </div>
            </>
          ) : null}

          <ErrorMessage error={create.error} />

          <div className="mt-5 flex gap-2 border-t border-divider pt-4">
            <Button
              variant="ghost"
              icon="arrow-left"
              disabled={step === 1}
              onClick={() => setStep((step - 1) as Step)}
            >
              {t('common.back')}
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" disabled={create.isPending} onClick={() => void submit(true)}>
              {t('trips.saveDraft')}
            </Button>
            <Button
              disabled={create.isPending}
              onClick={() => (step === 5 ? void submit(false) : setStep((step + 1) as Step))}
            >
              {step === 5 ? t('trips.createTrip') : t('common.continue')}
              <Icon name="arrow-right" size={14} />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function StepTitle({ children, subtitle }: { children: string; subtitle?: string }) {
  return (
    <>
      <div className={subtitle ? 'mb-1 text-[15px] font-medium' : 'mb-3.5 text-[15px] font-medium'}>
        {children}
      </div>
      {subtitle ? <div className="mb-3.5 text-[12.5px] text-neutral-500">{subtitle}</div> : null}
    </>
  );
}

function StepButton({ n, current, onClick }: { n: Step; current: Step; onClick: () => void }) {
  const { t } = useTranslation();
  const active = current === n;
  const done = current > n;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-[11px] rounded-md px-3 py-2.5 text-left"
      style={
        active
          ? { background: 'color-mix(in srgb, var(--color-accent) 9%, transparent)' }
          : undefined
      }
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold"
        style={
          done
            ? { background: 'var(--color-accent-800)', color: 'var(--color-accent-200)' }
            : {
                border: `1.5px solid ${active ? 'var(--color-accent)' : 'var(--color-neutral-700)'}`,
                color: active ? 'var(--color-accent)' : 'var(--color-neutral-500)',
                boxSizing: 'border-box',
              }
        }
      >
        {done ? '✓' : n}
      </span>
      <span>
        <span className="block text-[13px] font-medium">{t(`trips.steps.${n}.title`)}</span>
        <span className="block text-[11.5px] text-neutral-500">{t(`trips.steps.${n}.sub`)}</span>
      </span>
    </button>
  );
}

/** The design's radio-card list: a bordered row per free resource. */
function PickList({
  label,
  options,
  value,
  onChange,
  emptyLabel,
}: {
  label: string;
  options: Array<{ id: string; title: string; subtitle: string }>;
  value: string;
  onChange: (id: string) => void;
  emptyLabel: string;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-neutral-500">
        {label}
      </div>
      <div className="flex flex-col gap-2">
        {options.length === 0 ? (
          <div className="text-[12.5px] text-neutral-600">{emptyLabel}</div>
        ) : (
          options.map((option) => {
            const selected = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onChange(selected ? '' : option.id)}
                aria-pressed={selected}
                className="flex items-center gap-2.5 rounded-md px-[13px] py-[11px] text-left"
                style={
                  selected
                    ? {
                        border: '1px solid var(--color-accent)',
                        background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
                      }
                    : { border: '1px solid var(--color-neutral-800)' }
                }
              >
                <Icon
                  name={selected ? 'check-circle' : 'circle'}
                  size={17}
                  style={{
                    color: selected ? 'var(--color-accent)' : 'var(--color-neutral-600)',
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{option.title}</span>
                  <span className="block truncate text-[11.5px] text-neutral-500">
                    {option.subtitle || '—'}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  strong,
  last,
}: {
  label: string;
  value: string;
  strong?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`flex justify-between py-[9px] ${last ? '' : 'border-b border-divider'}`}>
      <span className="text-neutral-500">{label}</span>
      {strong ? <b className="tabular-nums">{value || '—'}</b> : <span>{value || '—'}</span>}
    </div>
  );
}

function nameOf<T extends { id: string; name?: string; fullName?: string }>(
  rows: T[] | undefined,
  id: string,
  key: 'name' | 'fullName' = 'name',
): string {
  return rows?.find((row) => row.id === id)?.[key] ?? '—';
}

function plateOf(rows: Array<{ id: string; plateNumber: string }>, id: string): string {
  return rows.find((row) => row.id === id)?.plateNumber ?? '—';
}

function fuelNormOf(
  vehicles: Array<{ id: string; fuelNormPer100km: string | null }>,
  id: string,
): string | null {
  return vehicles.find((vehicle) => vehicle.id === id)?.fuelNormPer100km ?? null;
}

/** Planned litres = distance × norm ÷ 100. Shown as a hint, never stored. */
export function estimateFuel(km: string, normPer100km: string | null): string {
  const distance = Number(km);
  const norm = Number(normPer100km);
  if (!Number.isFinite(distance) || !Number.isFinite(norm) || distance <= 0 || norm <= 0) {
    return '—';
  }
  return `~${Math.round((distance * norm) / 100)} l`;
}
