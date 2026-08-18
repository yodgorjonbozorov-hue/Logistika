import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api/client';
import type {
  DriverReportRow,
  FinanceReport,
  TripsReport,
  VehicleReportRow,
} from '../../shared/api/entities';
import {
  Card,
  ComingSoon,
  DataTable,
  ErrorMessage,
  Field,
  Input,
  KpiCard,
  PageHeader,
  SectionTitle,
  Skeleton,
  Tabs,
  Toolbar,
  type Column,
} from '../../shared/ui';
import { formatTiyin } from '../../shared/utils/money';

type Tab = 'trips' | 'finance' | 'vehicles' | 'drivers';

interface Range {
  from: string;
  to: string;
}

/** Horizontal bar built from the row values themselves — no chart library needed. */
function BarRow({
  label,
  value,
  max,
  text,
}: {
  label: string;
  value: bigint;
  max: bigint;
  text: string;
}) {
  const percent = max > 0n ? Number((value * 100n) / max) : 0;
  return (
    <li className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 font-medium money">{text}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
    </li>
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('trips');
  const [range, setRange] = useState<Range>({ from: '', to: '' });

  const query = {
    from: range.from ? new Date(range.from).toISOString() : undefined,
    to: range.to ? new Date(`${range.to}T23:59:59`).toISOString() : undefined,
  };

  return (
    <div>
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />

      <Toolbar>
        <div className="w-[calc(50%-0.25rem)] sm:w-44">
          <Field label={t('common.from')}>
            <Input
              type="date"
              value={range.from}
              onChange={(event) => setRange((r) => ({ ...r, from: event.target.value }))}
            />
          </Field>
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-44">
          <Field label={t('common.to')}>
            <Input
              type="date"
              value={range.to}
              onChange={(event) => setRange((r) => ({ ...r, to: event.target.value }))}
            />
          </Field>
        </div>
      </Toolbar>

      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'trips', label: t('reports.tabs.trips') },
          { key: 'finance', label: t('reports.tabs.finance') },
          { key: 'vehicles', label: t('reports.tabs.vehicles') },
          { key: 'drivers', label: t('reports.tabs.drivers') },
        ]}
      />

      {tab === 'trips' && <TripsReportView query={query} />}
      {tab === 'finance' && <FinanceReportView query={query} />}
      {tab === 'vehicles' && <VehiclesReportView query={query} />}
      {tab === 'drivers' && <DriversReportView query={query} />}

      <section className="mt-6">
        <SectionTitle>{t('reports.advancedTitle')}</SectionTitle>
        <ComingSoon note={t('reports.advancedNote')} />
      </section>
    </div>
  );
}

type Query = { from?: string; to?: string };

function TripsReportView({ query }: { query: Query }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'trips', query],
    queryFn: async () => (await api<TripsReport>('/reports/trips', { query })).data,
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !data) return <ErrorMessage error={error} />;

  const maxStatus = data.byStatus.reduce(
    (max, row) => (BigInt(row.agreedTotal) > max ? BigInt(row.agreedTotal) : max),
    0n,
  );
  const agreedTotal = data.byStatus.reduce((sum, row) => sum + BigInt(row.agreedTotal), 0n);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <KpiCard label={t('reports.tripsTotal')} value={data.total} />
        <KpiCard
          label={t('reports.agreedTotal')}
          value={formatTiyin(agreedTotal)}
          hint={t('common.som')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>{t('reports.byStatus')}</SectionTitle>
          {data.byStatus.length === 0 ? (
            <p className="text-sm text-ink-2">{t('common.empty')}</p>
          ) : (
            <ul>
              {data.byStatus.map((row) => (
                <BarRow
                  key={row.status}
                  label={`${t(`status.${row.status}`)} · ${row.count}`}
                  value={BigInt(row.agreedTotal)}
                  max={maxStatus}
                  text={formatTiyin(row.agreedTotal)}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>{t('reports.byMonth')}</SectionTitle>
          {data.byMonth.length === 0 ? (
            <p className="text-sm text-ink-2">{t('common.empty')}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {data.byMonth.map((row) => (
                <li key={row.month} className="flex items-center justify-between gap-3 py-2">
                  <span>{row.month}</span>
                  <span className="text-ink-2">
                    {row.count} · <span className="money">{formatTiyin(row.agreedTotal)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function FinanceReportView({ query }: { query: Query }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'finance', query],
    queryFn: async () => (await api<FinanceReport>('/reports/finance', { query })).data,
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !data) return <ErrorMessage error={error} />;

  const maxCategory = data.expenseByCategory.reduce(
    (max, row) => (BigInt(row.amount) > max ? BigInt(row.amount) : max),
    0n,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label={t('reports.incomeTotal')}
          value={formatTiyin(data.incomeTotal)}
          tone="success"
          hint={t('common.som')}
        />
        <KpiCard
          label={t('reports.expenseTotal')}
          value={formatTiyin(data.expenseTotal)}
          tone="danger"
          hint={t('common.som')}
        />
        <KpiCard
          label={t('reports.net')}
          value={formatTiyin(data.net)}
          tone={BigInt(data.net) >= 0n ? 'success' : 'danger'}
          hint={t('common.som')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>{t('reports.byCategory')}</SectionTitle>
          {data.expenseByCategory.length === 0 ? (
            <p className="text-sm text-ink-2">{t('common.empty')}</p>
          ) : (
            <ul>
              {data.expenseByCategory.map((row) => (
                <BarRow
                  key={row.category}
                  label={`${t(`finance.categories.${row.category}`)} · ${row.count}`}
                  value={BigInt(row.amount)}
                  max={maxCategory}
                  text={formatTiyin(row.amount)}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>{t('reports.byMonth')}</SectionTitle>
          {data.byMonth.length === 0 ? (
            <p className="text-sm text-ink-2">{t('common.empty')}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {data.byMonth.map((row) => (
                <li key={row.month} className="flex items-center justify-between gap-3 py-2">
                  <span>{row.month}</span>
                  <span className="flex gap-3">
                    <span className="text-success money">+{formatTiyin(row.income)}</span>
                    <span className="text-danger money">−{formatTiyin(row.expense)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {data.otherCurrencies.length > 0 ? (
        <Card>
          <SectionTitle>{t('reports.otherCurrencies')}</SectionTitle>
          <ul className="divide-y divide-line text-sm">
            {data.otherCurrencies.map((row) => (
              <li key={row.currency} className="flex items-center justify-between gap-3 py-2">
                <span className="font-medium">{row.currency}</span>
                <span className="flex gap-3">
                  <span className="text-success money">+{formatTiyin(row.income)}</span>
                  <span className="text-danger money">−{formatTiyin(row.expense)}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-2">{t('reports.otherCurrenciesNote')}</p>
        </Card>
      ) : null}
    </div>
  );
}

function VehiclesReportView({ query }: { query: Query }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'vehicles', query],
    queryFn: async () => (await api<VehicleReportRow[]>('/reports/vehicles', { query })).data,
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (error) return <ErrorMessage error={error} />;

  const columns: Array<Column<VehicleReportRow>> = [
    {
      key: 'plate',
      header: t('reports.vehicle'),
      primary: true,
      cell: (row) => row.plateNumber,
    },
    {
      key: 'model',
      header: t('vehicles.brand'),
      cell: (row) => [row.brand, row.model].filter(Boolean).join(' ') || '—',
    },
    { key: 'trips', header: t('reports.trips'), className: 'money', cell: (row) => row.trips },
    {
      key: 'distance',
      header: t('reports.distance'),
      className: 'money',
      cell: (row) => row.distanceKm ?? '—',
    },
    {
      key: 'revenue',
      header: t('reports.revenue'),
      className: 'money',
      cell: (row) => formatTiyin(row.revenue),
    },
    {
      key: 'expenses',
      header: t('reports.expenses'),
      className: 'money',
      cell: (row) => formatTiyin(row.expenses),
    },
  ];

  return <DataTable rows={data ?? []} columns={columns} getKey={(row) => row.vehicleId} />;
}

function DriversReportView({ query }: { query: Query }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'drivers', query],
    queryFn: async () => (await api<DriverReportRow[]>('/reports/drivers', { query })).data,
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (error) return <ErrorMessage error={error} />;

  const columns: Array<Column<DriverReportRow>> = [
    { key: 'name', header: t('reports.driver'), primary: true, cell: (row) => row.fullName },
    { key: 'trips', header: t('reports.trips'), className: 'money', cell: (row) => row.trips },
    {
      key: 'completed',
      header: t('reports.completed'),
      className: 'money',
      cell: (row) => row.completedTrips,
    },
    {
      key: 'distance',
      header: t('reports.distance'),
      className: 'money',
      cell: (row) => row.distanceKm ?? '—',
    },
    {
      key: 'revenue',
      header: t('reports.revenue'),
      className: 'money',
      cell: (row) => formatTiyin(row.revenue),
    },
  ];

  return <DataTable rows={data ?? []} columns={columns} getKey={(row) => row.driverId} />;
}
