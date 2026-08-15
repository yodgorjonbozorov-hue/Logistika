import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCrudMutations, useList } from '../../shared/api/crud';
import {
  useFuelControl,
  useFuelStations,
  type FuelLog,
  type Period,
} from '../../shared/api/analytics';
import type { Vehicle } from '../../shared/api/entities';
import {
  Badge,
  Button,
  Card,
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
import { PeriodPicker } from '../../shared/ui/stats';
import { formatDate } from '../../shared/utils/date';
import { currentMonthPeriod, formatBp, formatDecimal } from '../../shared/utils/format';
import { formatTiyin, somToTiyin } from '../../shared/utils/money';

type Tab = 'control' | 'stations' | 'journal';

export function FuelPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('control');
  const [period, setPeriod] = useState<Period>(() => currentMonthPeriod());

  return (
    <div>
      <PageHeader
        title={t('fuel.title')}
        actions={<PeriodPicker period={period} onChange={setPeriod} />}
      />
      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-white/10">
        {(['control', 'stations', 'journal'] as Tab[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? 'shrink-0 border-b-2 border-accent px-4 py-2 text-sm font-semibold text-accent'
                : 'shrink-0 px-4 py-2 text-sm text-muted hover:text-gray-700 dark:hover:text-gray-200'
            }
          >
            {t(`fuel.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'control' && <ControlTab period={period} />}
      {tab === 'stations' && <StationsTab period={period} />}
      {tab === 'journal' && <JournalTab />}
    </div>
  );
}

/** W-8 killer table: norm vs actual, with the overrun highlighted in red. */
function ControlTab({ period }: { period: Period }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useFuelControl(period);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState />;

  const totalLoss = rows.reduce(
    (sum, row) => sum + (row.lossTiyin && BigInt(row.lossTiyin) > 0n ? BigInt(row.lossTiyin) : 0n),
    0n,
  );

  return (
    <div className="space-y-3">
      <Card>
        <div className="text-xs uppercase text-muted">{t('fuel.monthlyLoss')}</div>
        <div className="mt-1 text-xl font-bold tabular-nums text-danger">
          {formatTiyin(totalLoss)} {t('common.som')}
        </div>
      </Card>

      <Table
        headers={[
          t('fuel.vehicle'),
          t('fuel.distance'),
          t('fuel.norm'),
          t('fuel.actual'),
          t('fuel.deviation'),
          t('fuel.loss'),
          t('fuel.refuels'),
        ]}
      >
        {rows.map((row) => {
          const over = Number(row.deviationLitres) > 0;
          return (
            <Row key={row.vehicleId}>
              <Cell>
                <span className="font-medium">{row.plateNumber}</span>
                {row.normPer100km ? (
                  <span className="ml-2 text-xs text-muted">
                    {formatDecimal(row.normPer100km, 2)} {t('fuel.per100')}
                  </span>
                ) : null}
              </Cell>
              <Cell className="tabular-nums">{formatDecimal(row.distanceKm)}</Cell>
              <Cell className="tabular-nums">{formatDecimal(row.normLitres, 2)}</Cell>
              <Cell className="tabular-nums">{formatDecimal(row.actualLitres, 2)}</Cell>
              <Cell className="tabular-nums">
                <span className={over ? 'font-semibold text-danger' : 'text-success'}>
                  {over ? '+' : ''}
                  {formatDecimal(row.deviationLitres, 2)}
                </span>
                <span className="ml-2 text-xs text-muted">{formatBp(row.deviationBp)}</span>
                {row.exceedsThreshold ? <Badge tone="red">{t('fuel.overThreshold')}</Badge> : null}
              </Cell>
              <Cell className="tabular-nums">{formatTiyin(row.lossTiyin)}</Cell>
              <Cell className="tabular-nums">{row.refuelCount}</Cell>
            </Row>
          );
        })}
      </Table>
    </div>
  );
}

/** Which filling station the overrun clusters around. */
function StationsTab({ period }: { period: Period }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useFuelStations(period);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState />;

  return (
    <Table
      headers={[
        t('fuel.station'),
        t('fuel.refuels'),
        t('fuel.litres'),
        t('fuel.amount'),
        t('fuel.avgPrice'),
        t('fuel.attributedOverrun'),
      ]}
    >
      {rows.map((row) => (
        <Row key={row.stationName}>
          <Cell>{row.stationName}</Cell>
          <Cell className="tabular-nums">{row.refuelCount}</Cell>
          <Cell className="tabular-nums">{formatDecimal(row.litres, 2)}</Cell>
          <Cell className="tabular-nums">{formatTiyin(row.totalAmount)}</Cell>
          <Cell className="tabular-nums">{formatTiyin(row.avgPricePerLitre)}</Cell>
          <Cell className="tabular-nums text-danger">
            {formatDecimal(row.attributedOverrunLitres, 2)}
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

function JournalTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useList<FuelLog>('fuel', page);

  const logs = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setShowForm(true)}>+ {t('fuel.newEntry')}</Button>
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
              t('fuel.date'),
              t('fuel.station'),
              t('fuel.litres'),
              t('fuel.pricePerLitre'),
              t('fuel.amount'),
              t('fuel.odometer'),
            ]}
          >
            {logs.map((log) => (
              <Row key={log.id}>
                <Cell>{formatDate(log.refuelTime)}</Cell>
                <Cell>{log.stationName ?? '—'}</Cell>
                <Cell className="tabular-nums">{formatDecimal(log.liters, 2)}</Cell>
                <Cell className="tabular-nums">{formatTiyin(log.pricePerLiter)}</Cell>
                <Cell className="tabular-nums">{formatTiyin(log.totalAmount)}</Cell>
                <Cell className="tabular-nums">{log.odometer ?? '—'}</Cell>
              </Row>
            ))}
          </Table>
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}
      <FuelFormModal open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}

function FuelFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { create } = useCrudMutations('fuel');
  const { data: vehicles } = useList<Vehicle>('vehicles', 1, { limit: '100' });
  const [form, setForm] = useState({
    vehicleId: '',
    liters: '',
    pricePerLiter: '',
    stationName: '',
    odometer: '',
    refuelTime: new Date().toISOString().slice(0, 10),
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      vehicleId: form.vehicleId,
      liters: Number(form.liters),
      pricePerLiter: form.pricePerLiter ? somToTiyin(form.pricePerLiter) : undefined,
      stationName: form.stationName || undefined,
      odometer: form.odometer ? Number(form.odometer) : undefined,
      refuelTime: new Date(form.refuelTime).toISOString(),
    });
    onClose();
  }

  return (
    <Modal title={t('fuel.newEntry')} open={open} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('fuel.vehicle')}>
            <Select value={form.vehicleId} onChange={set('vehicleId')} required>
              <option value="">{t('common.select')}</option>
              {(vehicles?.data ?? []).map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plateNumber}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('fuel.litres')}>
            <Input inputMode="decimal" value={form.liters} onChange={set('liters')} required />
          </Field>
          <Field label={t('fuel.pricePerLitre')} hint={t('common.som')}>
            <Input inputMode="numeric" value={form.pricePerLiter} onChange={set('pricePerLiter')} />
          </Field>
          <Field label={t('fuel.station')}>
            <Input value={form.stationName} onChange={set('stationName')} />
          </Field>
          <Field label={t('fuel.odometer')}>
            <Input inputMode="numeric" value={form.odometer} onChange={set('odometer')} />
          </Field>
          <Field label={t('fuel.date')}>
            <Input type="date" value={form.refuelTime} onChange={set('refuelTime')} required />
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
