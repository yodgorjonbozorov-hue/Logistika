import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SalaryType } from 'shared';
import { useCrudMutations } from '../../shared/api/crud';
import { useAllTrips, useDrivers } from '../../shared/api/queries';
import type { Trip } from '../../shared/api/entities';
import {
  Avatar,
  Button,
  Card,
  Cell,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  Row,
  Select,
  Spinner,
  StatusChip,
  Table,
  initialsOf,
} from '../../shared/ui';
import { dateInputToIso, formatDate } from '../../shared/utils/date';
import { formatTiyin, somToTiyin } from '../../shared/utils/money';
import { RESOURCE_STATE_TONE, driverState } from '../../shared/utils/status';
import { busyResourceIds, openTrips } from '../overview/metrics';

export function DriversPage() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const { data: drivers, isLoading, error } = useDrivers();
  const trips = useAllTrips();

  const rows = useMemo(() => {
    const busy = busyResourceIds(trips.data ?? []);
    const tripByDriver = new Map<string, Trip>();
    for (const trip of openTrips(trips.data ?? [])) {
      if (trip.driverId && !tripByDriver.has(trip.driverId)) tripByDriver.set(trip.driverId, trip);
    }
    return (drivers ?? []).map((driver) => ({
      driver,
      trip: tripByDriver.get(driver.id) ?? null,
      state: driverState({ isActive: driver.isActive, hasOpenTrip: busy.drivers.has(driver.id) }),
    }));
  }, [drivers, trips.data]);

  return (
    <div>
      <PageHeader
        title={t('drivers.title')}
        subtitle={t('drivers.subtitle', { count: rows.length })}
        actions={
          <Button icon="plus" onClick={() => setShowForm(true)}>
            {t('drivers.new')}
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
                <th className="pl-[18px]">{t('drivers.title')}</th>
                <th>{t('drivers.phone')}</th>
                <th>{t('drivers.license')}</th>
                <th>{t('trips.vehicle')}</th>
                <th>{t('drivers.activeTrip')}</th>
                <th>{t('trips.status')}</th>
                <th className="pr-[18px] text-right">{t('drivers.salaryValue')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ driver, trip, state }) => (
                <Row key={driver.id}>
                  <Cell className="pl-[18px]">
                    <div className="flex items-center gap-[9px]">
                      <Avatar initials={initialsOf(driver.fullName)} size={27} />
                      <span className="whitespace-nowrap font-medium">{driver.fullName}</span>
                    </div>
                  </Cell>
                  <Cell className="whitespace-nowrap tabular-nums text-neutral-400">
                    {driver.phone ?? '—'}
                  </Cell>
                  <Cell className="text-neutral-400">
                    {driver.licenseNumber ?? '—'}
                    {driver.licenseExpiry ? (
                      <span className="block text-[11.5px] text-neutral-600">
                        {formatDate(driver.licenseExpiry)}
                      </span>
                    ) : null}
                  </Cell>
                  <Cell className="whitespace-nowrap font-medium">
                    {trip?.vehicle?.plateNumber ?? '—'}
                  </Cell>
                  <Cell className="font-medium tabular-nums text-accent-300">
                    {trip?.tripNumber ?? '—'}
                  </Cell>
                  <Cell>
                    <StatusChip tone={RESOURCE_STATE_TONE[state]}>
                      {t(`resourceState.${state}`)}
                    </StatusChip>
                  </Cell>
                  <Cell className="whitespace-nowrap pr-[18px] text-right text-neutral-400">
                    {formatSalary(driver.salaryType, driver.salaryValue, t)}
                  </Cell>
                </Row>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <DriverFormModal open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}

/** PERCENT is basis points (1% = 100); the other types are tiyin. */
export function formatSalary(
  type: SalaryType | null,
  value: string | null,
  t: (key: string) => string,
): string {
  if (!type || !value) return '—';
  if (type === SalaryType.PERCENT) return `${Number(value) / 100}%`;
  const amount = formatTiyin(value);
  return type === SalaryType.PER_KM
    ? `${amount} ${t('common.som')}/km`
    : `${amount} ${t('common.som')}`;
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
    setForm((current) => ({ ...current, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const salaryValue = !form.salaryValue
      ? undefined
      : form.salaryType === SalaryType.PERCENT
        ? String(Math.round(Number(form.salaryValue) * 100))
        : (somToTiyin(form.salaryValue) ?? undefined);
    await create.mutateAsync({
      fullName: form.fullName,
      phone: form.phone || undefined,
      licenseNumber: form.licenseNumber || undefined,
      licenseExpiry: dateInputToIso(form.licenseExpiry),
      hireDate: dateInputToIso(form.hireDate),
      salaryType: form.salaryType || undefined,
      salaryValue,
    });
    onClose();
  }

  return (
    <Modal title={t('drivers.new')} open={open} onClose={onClose} width={520}>
      <form onSubmit={(e) => void onSubmit(e)}>
        <Field label={t('drivers.fullName')} className="mb-3">
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
