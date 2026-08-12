import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api/client';
import { useCrudMutations, useList } from '../../shared/api/crud';
import type { FuelControlRow, FuelLog, StationRow, Vehicle } from '../../shared/api/entities';
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
import { dateInputToIso, formatDateTime } from '../../shared/utils/date';
import { formatTiyin, somToTiyin } from '../../shared/utils/money';

type Tab = 'control' | 'stations' | 'journal';

function monthStartInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function FuelPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('control');
  const [from, setFrom] = useState(monthStartInput());
  const [to, setTo] = useState('');

  const period = {
    from: dateInputToIso(from),
    to: to ? dateInputToIso(to) : undefined,
  };

  return (
    <div>
      <PageHeader
        title={t('fuel.title')}
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-muted">—</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        }
      />
      <div className="mb-3 flex gap-1 border-b border-gray-200 dark:border-white/10">
        {(['control', 'stations', 'journal'] as Tab[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? 'border-b-2 border-accent px-4 py-2 text-sm font-semibold text-accent'
                : 'px-4 py-2 text-sm text-muted hover:text-gray-700 dark:hover:text-gray-200'
            }
          >
            {t(`fuel.tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === 'control' ? (
        <ControlTab from={period.from} to={period.to} />
      ) : tab === 'stations' ? (
        <StationsTab from={period.from} to={period.to} />
      ) : (
        <JournalTab />
      )}
    </div>
  );
}

function ControlTab({ from, to }: { from?: string; to?: string }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['fuel-control', { from, to }],
    queryFn: () => api<FuelControlRow[]>('/fuel/control', { query: { from, to } }),
  });
  const rows = data?.data ?? [];

  return (
    <div>
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <Table
          headers={[
            t('fuel.vehicle'),
            t('fuel.distance'),
            t('fuel.norm'),
            t('fuel.actual'),
            t('fuel.diff'),
            t('fuel.loss'),
            t('fuel.deviation'),
          ]}
        >
          {rows.map((row) => (
            <Row key={row.vehicleId}>
              <Cell className="font-medium">{row.plateNumber}</Cell>
              <Cell className="tabular-nums">{row.distanceKm}</Cell>
              <Cell className="tabular-nums">{row.normLiters}</Cell>
              <Cell className="tabular-nums">{row.actualLiters}</Cell>
              <Cell
                className={
                  'tabular-nums font-semibold ' +
                  (row.diffLiters > 0 ? 'text-danger' : 'text-success')
                }
              >
                {row.diffLiters > 0 ? `+${row.diffLiters}` : row.diffLiters}
              </Cell>
              <Cell className="tabular-nums">{formatTiyin(row.lossAmount)}</Cell>
              <Cell>
                {row.deviationPercent == null ? (
                  '—'
                ) : (
                  <Badge tone={row.overThreshold ? 'red' : 'green'}>
                    {row.deviationPercent > 0 ? '+' : ''}
                    {row.deviationPercent}%
                  </Badge>
                )}
              </Cell>
            </Row>
          ))}
        </Table>
      )}
    </div>
  );
}

function StationsTab({ from, to }: { from?: string; to?: string }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['fuel-stations', { from, to }],
    queryFn: () => api<StationRow[]>('/fuel/by-station', { query: { from, to } }),
  });
  const rows = data?.data ?? [];

  return (
    <div>
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <Table
          headers={[
            t('fuel.station'),
            t('fuel.refuelCount'),
            t('fuel.liters'),
            t('fuel.totalAmount'),
            t('fuel.pricePerLiter'),
          ]}
        >
          {rows.map((row) => (
            <Row key={row.stationName}>
              <Cell className="font-medium">{row.stationName}</Cell>
              <Cell className="tabular-nums">{row.refuelCount}</Cell>
              <Cell className="tabular-nums">{row.liters}</Cell>
              <Cell className="tabular-nums">{formatTiyin(row.totalAmount)}</Cell>
              <Cell className="tabular-nums">{formatTiyin(row.avgPricePerLiter)}</Cell>
            </Row>
          ))}
        </Table>
      )}
    </div>
  );
}

function JournalTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useList<FuelLog>('fuel', page);
  const { data: vehiclesData } = useList<Vehicle>('vehicles', 1);

  const logs = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;
  const vehicles = vehiclesData?.data ?? [];
  const plateById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.plateNumber]));

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setShowForm(true)}>+ {t('fuel.newLog')}</Button>
      </div>
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : logs.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Table
            headers={[
              t('fuel.refuelTime'),
              t('fuel.vehicle'),
              t('fuel.liters'),
              t('fuel.pricePerLiter'),
              t('fuel.totalAmount'),
              t('fuel.station'),
              t('fuel.odometer'),
            ]}
          >
            {logs.map((log) => (
              <Row key={log.id}>
                <Cell>{formatDateTime(log.refuelTime)}</Cell>
                <Cell className="font-medium">{plateById.get(log.vehicleId) ?? '—'}</Cell>
                <Cell className="tabular-nums">{log.liters}</Cell>
                <Cell className="tabular-nums">{formatTiyin(log.pricePerLiter)}</Cell>
                <Cell className="tabular-nums">{formatTiyin(log.totalAmount)}</Cell>
                <Cell>{log.stationName ?? '—'}</Cell>
                <Cell className="tabular-nums">{log.odometer ?? '—'}</Cell>
              </Row>
            ))}
          </Table>
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}
      <FuelLogFormModal open={showForm} onClose={() => setShowForm(false)} vehicles={vehicles} />
    </div>
  );
}

function FuelLogFormModal({
  open,
  onClose,
  vehicles,
}: {
  open: boolean;
  onClose: () => void;
  vehicles: Vehicle[];
}) {
  const { t } = useTranslation();
  const { create } = useCrudMutations('fuel');
  const [form, setForm] = useState({
    vehicleId: '',
    liters: '',
    pricePerLiter: '',
    totalAmount: '',
    stationName: '',
    odometer: '',
    refuelTime: new Date().toISOString().slice(0, 16),
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      vehicleId: form.vehicleId,
      liters: Number(form.liters.replace(',', '.')),
      pricePerLiter: form.pricePerLiter ? somToTiyin(form.pricePerLiter) : undefined,
      totalAmount: form.totalAmount ? somToTiyin(form.totalAmount) : undefined,
      stationName: form.stationName || undefined,
      odometer: form.odometer ? Number(form.odometer) : undefined,
      refuelTime: new Date(form.refuelTime).toISOString(),
    });
    onClose();
  }

  return (
    <Modal title={t('fuel.newLog')} open={open} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('fuel.vehicle')}>
            <Select value={form.vehicleId} onChange={set('vehicleId')} required>
              <option value="">{t('common.select')}</option>
              {vehicles
                .filter((vehicle) => vehicle.type !== 'TRAILER')
                .map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plateNumber}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('fuel.liters')}>
            <Input
              inputMode="decimal"
              value={form.liters}
              onChange={set('liters')}
              required
              pattern="\d+([.,]\d{1,2})?"
            />
          </Field>
          <Field label={t('fuel.pricePerLiter')}>
            <Input inputMode="numeric" value={form.pricePerLiter} onChange={set('pricePerLiter')} />
          </Field>
          <Field label={t('fuel.totalAmount')}>
            <Input inputMode="numeric" value={form.totalAmount} onChange={set('totalAmount')} />
          </Field>
          <Field label={t('fuel.station')}>
            <Input value={form.stationName} onChange={set('stationName')} />
          </Field>
          <Field label={t('fuel.odometer')}>
            <Input inputMode="numeric" value={form.odometer} onChange={set('odometer')} />
          </Field>
          <Field label={t('fuel.refuelTime')}>
            <Input
              type="datetime-local"
              value={form.refuelTime}
              onChange={set('refuelTime')}
              required
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
