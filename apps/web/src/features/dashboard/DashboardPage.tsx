import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { FinanceSummary } from 'shared';
import {
  Badge,
  Card,
  Cell,
  EmptyState,
  ErrorMessage,
  Input,
  PageHeader,
  Pagination,
  Row,
  Select,
  Spinner,
  Table,
} from '../../shared/ui';
import { formatTiyin } from '../../shared/utils/money';
import {
  useFinanceFuel,
  useFinanceMonthly,
  useFinanceRoutes,
  useFinanceSummary,
  useFinanceTrips,
  useFinanceVehicles,
} from './api';
import {
  barPercent,
  formatBp,
  formatDecimal,
  TONE_CLASSES,
  toneForDeviation,
  toneForValue,
} from './format';
import { MonthlyChart } from './MonthlyChart';
import {
  customPeriod,
  periodEndInput,
  periodStartInput,
  resolvePeriod,
  type Period,
  type PeriodPreset,
} from './period';

const PRESETS: Array<Exclude<PeriodPreset, 'custom'>> = [
  'thisMonth',
  'lastMonth',
  'last30',
  'last90',
  'thisYear',
];

/**
 * The owner's screen (TZ §6, W-1).
 *
 * Every number on this page is computed by the backend and arrives as a string
 * of tiyin or as basis points. Nothing is summed, divided or converted here:
 * the browser's only job is to make integers readable. That is what keeps the
 * dashboard, the finance page and the exported report agreeing to the tiyin.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<PeriodPreset>('thisMonth');
  const [custom, setCustom] = useState<Period>(() => resolvePeriod('thisMonth'));
  const [tripPage, setTripPage] = useState(1);

  const period = useMemo(
    () => (preset === 'custom' ? custom : resolvePeriod(preset)),
    [preset, custom],
  );

  const summary = useFinanceSummary(period);
  const routes = useFinanceRoutes(period);
  const vehicles = useFinanceVehicles(period);
  const fuel = useFinanceFuel(period);
  const monthly = useFinanceMonthly(12);
  const trips = useFinanceTrips(period, tripPage);

  const onCustomChange = (which: 'from' | 'to') => (value: string) => {
    const from = which === 'from' ? value : periodStartInput(custom);
    const to = which === 'to' ? value : periodEndInput(custom);
    const next = customPeriod(from, to);
    if (next) {
      setCustom(next);
      setPreset('custom');
      setTripPage(1);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('dashboard.title')}
        actions={
          <>
            <Select
              aria-label={t('dashboard.period')}
              className="w-44"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value as PeriodPreset);
                setTripPage(1);
              }}
            >
              {PRESETS.map((key) => (
                <option key={key} value={key}>
                  {t(`dashboard.presets.${key}`)}
                </option>
              ))}
              <option value="custom">{t('dashboard.presets.custom')}</option>
            </Select>
            {preset === 'custom' && (
              <>
                <Input
                  type="date"
                  aria-label={t('dashboard.from')}
                  className="w-40"
                  value={periodStartInput(custom)}
                  onChange={(e) => onCustomChange('from')(e.target.value)}
                />
                <Input
                  type="date"
                  aria-label={t('dashboard.to')}
                  className="w-40"
                  value={periodEndInput(custom)}
                  onChange={(e) => onCustomChange('to')(e.target.value)}
                />
              </>
            )}
          </>
        }
      />

      <ErrorMessage
        error={summary.error ?? routes.error ?? vehicles.error ?? fuel.error ?? monthly.error}
      />

      {summary.isLoading ? <Spinner /> : summary.data ? <Kpis data={summary.data} /> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionTitle>{t('dashboard.monthlyComparison')}</SectionTitle>
          {monthly.isLoading ? (
            <Spinner />
          ) : (monthly.data?.length ?? 0) === 0 ? (
            <EmptyState />
          ) : (
            <MonthlyChart rows={monthly.data!} />
          )}
        </Card>

        <Card>
          <SectionTitle>{t('dashboard.expensesByCategory')}</SectionTitle>
          {summary.isLoading ? (
            <Spinner />
          ) : (summary.data?.expensesByCategory.length ?? 0) === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-2">
              {summary.data!.expensesByCategory.map((entry) => (
                <li key={entry.category}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{t(`finance.categories.${entry.category}`, entry.category)}</span>
                    <span className="tabular-nums text-muted">
                      {formatTiyin(entry.amount)} · {formatBp(entry.shareBp, { decimals: 1 })}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-gray-100 dark:bg-white/10">
                    <div
                      className="h-full rounded bg-accent"
                      style={{ width: `${barPercent(String(entry.shareBp), '10000')}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle>{t('dashboard.byRoute')}</SectionTitle>
        {routes.isLoading ? (
          <Spinner />
        ) : (routes.data?.length ?? 0) === 0 ? (
          <EmptyState />
        ) : (
          <Table
            headers={[
              t('dashboard.route'),
              t('dashboard.trips'),
              t('dashboard.distance'),
              t('dashboard.revenue'),
              t('dashboard.expenses'),
              t('dashboard.profit'),
              t('dashboard.margin'),
              t('dashboard.profitPerTrip'),
              t('dashboard.profitPerKm'),
            ]}
          >
            {routes.data!.map((row) => (
              <Row key={row.routeId ?? 'unassigned'}>
                <Cell className="font-medium">
                  {row.routeId ? row.routeName : t('dashboard.unassignedRoute')}
                </Cell>
                <Cell className="tabular-nums">
                  {row.trips} ({row.completedTrips})
                </Cell>
                <Cell className="tabular-nums">{formatDecimal(row.distanceKm, t('units.km'))}</Cell>
                <Cell className="tabular-nums">{formatTiyin(row.revenue)}</Cell>
                <Cell className="tabular-nums">{formatTiyin(row.expenses)}</Cell>
                <Cell className={`tabular-nums ${TONE_CLASSES[toneForValue(row.profit)]}`}>
                  {formatTiyin(row.profit)}
                </Cell>
                <Cell className="tabular-nums">{formatBp(row.marginBp, { decimals: 1 })}</Cell>
                <Cell className="tabular-nums">{formatTiyin(row.profitPerTrip)}</Cell>
                <Cell className="tabular-nums">{formatTiyin(row.profitPerKm)}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <SectionTitle>{t('dashboard.byVehicle')}</SectionTitle>
        {vehicles.isLoading ? (
          <Spinner />
        ) : (vehicles.data?.length ?? 0) === 0 ? (
          <EmptyState />
        ) : (
          <Table
            headers={[
              t('dashboard.vehicle'),
              t('dashboard.trips'),
              t('dashboard.distance'),
              t('dashboard.revenue'),
              t('dashboard.expenses'),
              t('dashboard.profit'),
              t('dashboard.margin'),
              t('dashboard.profitPerKm'),
            ]}
          >
            {vehicles.data!.map((row) => (
              <Row key={row.vehicleId}>
                <Cell className="font-medium">{row.plateNumber}</Cell>
                <Cell className="tabular-nums">{row.trips}</Cell>
                <Cell className="tabular-nums">{formatDecimal(row.distanceKm, t('units.km'))}</Cell>
                <Cell className="tabular-nums">{formatTiyin(row.revenue)}</Cell>
                <Cell className="tabular-nums">{formatTiyin(row.expenses)}</Cell>
                <Cell className={`tabular-nums ${TONE_CLASSES[toneForValue(row.profit)]}`}>
                  {formatTiyin(row.profit)}
                </Cell>
                <Cell className="tabular-nums">{formatBp(row.marginBp, { decimals: 1 })}</Cell>
                <Cell className="tabular-nums">{formatTiyin(row.profitPerKm)}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <SectionTitle>{t('dashboard.fuel')}</SectionTitle>
        {fuel.isLoading ? (
          <Spinner />
        ) : (fuel.data?.length ?? 0) === 0 ? (
          <EmptyState />
        ) : (
          <Table
            headers={[
              t('dashboard.vehicle'),
              t('dashboard.refuels'),
              t('dashboard.litres'),
              t('dashboard.fuelCost'),
              t('dashboard.distance'),
              t('dashboard.consumption'),
              t('dashboard.norm'),
              t('dashboard.deviation'),
            ]}
          >
            {fuel.data!.map((row) => (
              <Row key={row.vehicleId}>
                <Cell className="font-medium">
                  {row.plateNumber}{' '}
                  {row.overNorm && <Badge tone="red">{t('dashboard.overNorm')}</Badge>}
                </Cell>
                <Cell className="tabular-nums">{row.refuels}</Cell>
                <Cell className="tabular-nums">{formatDecimal(row.litres, t('units.litre'))}</Cell>
                <Cell className="tabular-nums">{formatTiyin(row.cost)}</Cell>
                <Cell className="tabular-nums">{formatDecimal(row.distanceKm, t('units.km'))}</Cell>
                <Cell className="tabular-nums">
                  {formatDecimal(row.consumption, t('units.per100km'))}
                </Cell>
                <Cell className="tabular-nums">
                  {formatDecimal(row.normConsumption, t('units.per100km'))}
                </Cell>
                <Cell className={`tabular-nums ${TONE_CLASSES[toneForDeviation(row.deviationBp)]}`}>
                  {formatBp(row.deviationBp, { signed: true, decimals: 1 })}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <SectionTitle>{t('dashboard.byTrip')}</SectionTitle>
        <ErrorMessage error={trips.error} />
        {trips.isLoading ? (
          <Spinner />
        ) : (trips.data?.data.length ?? 0) === 0 ? (
          <EmptyState />
        ) : (
          <>
            <Table
              headers={[
                t('dashboard.trip'),
                t('dashboard.route'),
                t('dashboard.vehicle'),
                t('dashboard.distance'),
                t('dashboard.revenue'),
                t('dashboard.expenses'),
                t('dashboard.profit'),
                t('dashboard.margin'),
              ]}
            >
              {trips.data!.data.map((row) => (
                <Row key={row.tripId}>
                  <Cell className="font-medium">{row.tripNumber}</Cell>
                  <Cell>{row.routeName ?? '—'}</Cell>
                  <Cell>{row.plateNumber ?? '—'}</Cell>
                  <Cell className="tabular-nums">
                    {formatDecimal(row.distanceKm, t('units.km'))}
                  </Cell>
                  <Cell className="tabular-nums">{formatTiyin(row.revenue)}</Cell>
                  <Cell className="tabular-nums">{formatTiyin(row.expenses)}</Cell>
                  <Cell className={`tabular-nums ${TONE_CLASSES[toneForValue(row.profit)]}`}>
                    {formatTiyin(row.profit)}
                  </Cell>
                  <Cell className="tabular-nums">{formatBp(row.marginBp, { decimals: 1 })}</Cell>
                </Row>
              ))}
            </Table>
            <Pagination
              page={tripPage}
              limit={20}
              total={trips.data?.meta?.pagination?.total ?? 0}
              onPage={setTripPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}

function Kpis({ data }: { data: FinanceSummary }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <Kpi label={t('dashboard.revenue')} value={formatTiyin(data.revenue)} />
      <Kpi label={t('dashboard.expenses')} value={formatTiyin(data.expenses)} />
      <Kpi
        label={t('dashboard.profit')}
        value={formatTiyin(data.profit)}
        tone={toneForValue(data.profit)}
        hint={`${t('dashboard.margin')} ${formatBp(data.marginBp, { decimals: 1 })}`}
      />
      <Kpi
        label={t('dashboard.trips')}
        value={String(data.trips.total)}
        hint={`${t('dashboard.completed')} ${data.trips.completed} · ${t('dashboard.inProgress')} ${data.trips.inProgress}`}
      />
      <Kpi label={t('dashboard.trucksDispatched')} value={String(data.trucksDispatched)} />
      <Kpi label={t('dashboard.routesUsed')} value={String(data.routesUsed)} />
      <Kpi label={t('dashboard.distance')} value={formatDecimal(data.distanceKm, t('units.km'))} />
      <Kpi label={t('dashboard.litres')} value={formatDecimal(data.fuelLitres, t('units.litre'))} />
      <Kpi
        label={t('dashboard.profitPerTrip')}
        value={formatTiyin(data.profitPerTrip)}
        tone={toneForValue(data.profitPerTrip)}
      />
      <Kpi
        label={t('dashboard.profitPerKm')}
        value={formatTiyin(data.profitPerKm)}
        tone={toneForValue(data.profitPerKm)}
        hint={`${t('dashboard.costPerKm')} ${formatTiyin(data.costPerKm)}`}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONE_CLASSES;
}) {
  return (
    <Card className="p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums sm:text-xl ${TONE_CLASSES[tone]}`}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </Card>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
  );
}
