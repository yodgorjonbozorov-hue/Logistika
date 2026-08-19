import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { FuelControlRow } from 'shared';
import {
  Badge,
  Button,
  Cell,
  CurrencyInput,
  EmptyState,
  ErrorMessage,
  Field,
  IconAlert,
  IconPlus,
  Input,
  Modal,
  ModalActions,
  PageHeader,
  Pagination,
  Row,
  Select,
  Spinner,
  StatCard,
  Table,
  Tabs,
} from '../../shared/ui';
import { formatDateTime } from '../../shared/utils/date';
import { formatTiyin, somToTiyin } from '../../shared/utils/money';
import { formatBp, formatKm10, formatLitersCenti } from '../../shared/utils/units';
import { useRefLists } from '../trips/api';
import { useFuelControl, useFuelLogs, useFuelMutations } from './api';

type Tab = 'control' | 'journal';

/** W-8 «Yoqilg'i nazorati» — norm against reality, and the journal behind it. */
export function FuelPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('control');

  return (
    <div>
      <PageHeader title={t('fuel.title')} subtitle={t('fuel.subtitle')} />
      <Tabs
        value={tab}
        onChange={setTab}
        options={(['control', 'journal'] as Tab[]).map((value) => ({
          value,
          label: t(`fuel.tabs.${value}`),
        }))}
      />
      {tab === 'control' ? <ControlTab /> : <JournalTab />}
    </div>
  );
}

function ControlTab() {
  const { t } = useTranslation();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const { data, isLoading, error } = useFuelControl(range);

  const rows = data?.rows ?? [];
  const flagged = rows.filter((row) => row.overThreshold);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={t('finance.from')}>
          <Input
            type="date"
            className="w-44"
            value={range.from?.slice(0, 10) ?? ''}
            onChange={(event) =>
              setRange((current) => ({
                ...current,
                from: event.target.value ? `${event.target.value}T00:00:00.000Z` : undefined,
              }))
            }
          />
        </Field>
        <Field label={t('finance.to')}>
          <Input
            type="date"
            className="w-44"
            value={range.to?.slice(0, 10) ?? ''}
            onChange={(event) =>
              setRange((current) => ({
                ...current,
                to: event.target.value ? `${event.target.value}T00:00:00.000Z` : undefined,
              }))
            }
          />
        </Field>
      </div>

      <ErrorMessage error={error} />

      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState description={t('fuel.emptyHint')} />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard
              label={t('fuel.totalLoss')}
              value={formatTiyin(data!.totalLossTiyin)}
              delta={t('common.som')}
              trend={BigInt(data!.totalLossTiyin) > 0n ? 'down' : 'neutral'}
            />
            <StatCard
              label={t('fuel.flagged')}
              value={flagged.length}
              delta={`${t('fuel.threshold')} ${formatBp(data!.thresholdBp, { signed: false })}`}
              trend={flagged.length > 0 ? 'down' : 'up'}
              icon={flagged.length > 0 ? <IconAlert size={18} /> : undefined}
            />
            <StatCard label={t('fuel.vehiclesTracked')} value={rows.length} tone="navy" />
          </div>

          <Table
            headers={[
              t('vehicles.plate'),
              t('fuel.distance'),
              t('fuel.norm'),
              t('fuel.actual'),
              t('fuel.diff'),
              t('fuel.loss'),
              t('fuel.status'),
            ]}
          >
            {rows.map((row) => (
              <FuelRow key={row.vehicleId} row={row} />
            ))}
          </Table>
        </>
      )}
    </div>
  );
}

function FuelRow({ row }: { row: FuelControlRow }) {
  const { t } = useTranslation();
  const over = row.diffLitersCenti > 0;

  return (
    <Row>
      <Cell numeric className="font-semibold">
        {row.plateNumber}
      </Cell>
      <Cell numeric className="text-ink-secondary">
        {formatKm10(row.distanceKm10)} km
      </Cell>
      <Cell numeric className="text-ink-secondary">
        {row.normLitersCenti === 0 ? '—' : `${formatLitersCenti(row.normLitersCenti)} l`}
      </Cell>
      <Cell numeric>{formatLitersCenti(row.actualLitersCenti)} l</Cell>
      <Cell numeric className={over ? 'font-semibold text-danger' : 'text-success'}>
        {row.normLitersCenti === 0
          ? '—'
          : `${formatLitersCenti(row.diffLitersCenti, { signed: true })} l · ${formatBp(row.diffBp)}`}
      </Cell>
      <Cell numeric className={over ? 'font-semibold' : 'text-ink-tertiary'}>
        {formatTiyin(row.lossTiyin)}
      </Cell>
      <Cell>
        {row.normLitersCenti === 0 ? (
          <Badge tone="gray">{t('fuel.noNorm')}</Badge>
        ) : row.overThreshold ? (
          <Badge tone="red" dot>
            {t('fuel.overThreshold')}
          </Badge>
        ) : over ? (
          <Badge tone="orange">{t('fuel.slightlyOver')}</Badge>
        ) : (
          <Badge tone="green">{t('fuel.withinNorm')}</Badge>
        )}
      </Cell>
    </Row>
  );
}

function JournalTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, error } = useFuelLogs(page);
  const { remove } = useFuelMutations();

  const logs = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setShowForm(true)} icon={<IconPlus size={18} />}>
          {t('fuel.new')}
        </Button>
      </div>
      <ErrorMessage error={error ?? remove.error} />
      {isLoading ? (
        <Spinner />
      ) : logs.length === 0 ? (
        <EmptyState description={t('fuel.journalEmptyHint')} />
      ) : (
        <>
          <Table
            headers={[
              t('fuel.refuelTime'),
              t('vehicles.plate'),
              t('fuel.liters'),
              t('fuel.pricePerLiter'),
              t('fuel.amount'),
              t('fuel.station'),
              t('common.actions'),
            ]}
          >
            {logs.map((log) => (
              <Row key={log.id}>
                <Cell className="text-ink-secondary">{formatDateTime(log.refuelTime)}</Cell>
                <Cell numeric className="font-semibold">
                  {log.vehicle?.plateNumber ?? '—'}
                </Cell>
                <Cell numeric>{Number(log.liters).toFixed(2)}</Cell>
                <Cell numeric>{formatTiyin(log.pricePerLiter)}</Cell>
                <Cell numeric>{formatTiyin(log.totalAmount)}</Cell>
                <Cell className="text-ink-secondary">{log.stationName ?? '—'}</Cell>
                <Cell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    onClick={() =>
                      window.confirm(t('common.confirmDelete')) && void remove.mutateAsync(log.id)
                    }
                  >
                    {t('common.delete')}
                  </Button>
                </Cell>
              </Row>
            ))}
          </Table>
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}
      <FuelLogFormModal open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}

function FuelLogFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { vehicles } = useRefLists();
  const { create } = useFuelMutations();
  const [form, setForm] = useState({
    vehicleId: '',
    liters: '',
    pricePerLiter: '',
    totalAmount: '',
    stationName: '',
    odometer: '',
    refuelTime: new Date().toISOString().slice(0, 10),
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({
      vehicleId: form.vehicleId,
      liters: Number(form.liters),
      pricePerLiter: form.pricePerLiter ? (somToTiyin(form.pricePerLiter) ?? undefined) : undefined,
      totalAmount: form.totalAmount ? (somToTiyin(form.totalAmount) ?? undefined) : undefined,
      stationName: form.stationName || undefined,
      odometer: form.odometer ? Number(form.odometer) : undefined,
      refuelTime: new Date(form.refuelTime).toISOString(),
    });
    onClose();
  }

  const trucks = (vehicles.data ?? []).filter((v) => v.type !== 'TRAILER' && v.isActive);

  return (
    <Modal title={t('fuel.new')} open={open} onClose={onClose}>
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-3">
        <Field label={t('vehicles.plate')}>
          <Select value={form.vehicleId} onChange={set('vehicleId')} required>
            <option value="">{t('common.select')}</option>
            {trucks.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plateNumber}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('fuel.liters')}>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={form.liters}
              onChange={set('liters')}
              required
            />
          </Field>
          <Field label={t('fuel.refuelTime')}>
            <Input type="date" value={form.refuelTime} onChange={set('refuelTime')} required />
          </Field>
          <Field label={t('fuel.pricePerLiter')}>
            <CurrencyInput
              unit={t('common.som')}
              value={form.pricePerLiter}
              onChange={set('pricePerLiter')}
            />
          </Field>
          <Field label={t('fuel.amount')}>
            <CurrencyInput
              unit={t('common.som')}
              value={form.totalAmount}
              onChange={set('totalAmount')}
            />
          </Field>
          <Field label={t('fuel.station')}>
            <Input value={form.stationName} onChange={set('stationName')} />
          </Field>
          <Field label={t('vehicles.odometer')}>
            <Input type="number" min="0" value={form.odometer} onChange={set('odometer')} />
          </Field>
        </div>
        <ErrorMessage error={create.error} />
        <ModalActions>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={create.isPending}>
            {create.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
