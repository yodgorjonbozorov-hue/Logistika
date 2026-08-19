import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TripStatus } from 'shared';
import {
  useAllTrips,
  useDrivers,
  useExpenses,
  useIncomes,
  useVehicles,
} from '../../shared/api/queries';
import {
  Button,
  Card,
  CardList,
  Cell,
  EmptyState,
  ListCard,
  MeterRow,
  MetaItem,
  PageHeader,
  Row,
  Segmented,
  Spinner,
  Table,
} from '../../shared/ui';
import { formatMillionsTiyin, formatTiyin } from '../../shared/utils/money';
import { expensesByCategory, sumAmounts } from '../overview/metrics';

type Period = 'week' | 'month' | 'quarter' | 'year';

const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30, quarter: 91, year: 365 };

/** The ramp steps the breakdown bars step through, strongest first. */
const BAR_COLORS = [
  'var(--color-accent)',
  'var(--color-accent-600)',
  'var(--color-accent-700)',
  'var(--color-accent-800)',
  'var(--color-neutral-700)',
];

export function ReportsPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>('month');

  const trips = useAllTrips();
  const incomes = useIncomes();
  const expenses = useExpenses();
  const vehicles = useVehicles();
  const drivers = useDrivers();

  const isLoading = trips.isLoading || incomes.isLoading || expenses.isLoading;

  const report = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - PERIOD_DAYS[period]);

    const periodIncomes = (incomes.data ?? []).filter(
      (income) => new Date(income.paymentDate ?? income.createdAt) >= since,
    );
    const periodExpenses = (expenses.data ?? []).filter(
      (expense) => new Date(expense.expenseDate) >= since,
    );
    const completed = (trips.data ?? []).filter(
      (trip) =>
        trip.status === TripStatus.COMPLETED &&
        trip.finishedAt &&
        new Date(trip.finishedAt) >= since,
    );

    const revenue = sumAmounts(periodIncomes);
    const cost = sumAmounts(periodExpenses);

    /** Distance driven per vehicle, from the odometer span of completed trips. */
    const kmByVehicle = new Map<string, number>();
    const kmByDriver = new Map<string, number>();
    const tripsByDriver = new Map<string, number>();
    const revenueByDriver = new Map<string, bigint>();

    for (const trip of completed) {
      const km =
        trip.actualDistanceKm != null
          ? Number(trip.actualDistanceKm)
          : trip.startOdometer != null && trip.endOdometer != null
            ? trip.endOdometer - trip.startOdometer
            : 0;
      if (trip.vehicleId)
        kmByVehicle.set(trip.vehicleId, (kmByVehicle.get(trip.vehicleId) ?? 0) + km);
      if (trip.driverId) {
        kmByDriver.set(trip.driverId, (kmByDriver.get(trip.driverId) ?? 0) + km);
        tripsByDriver.set(trip.driverId, (tripsByDriver.get(trip.driverId) ?? 0) + 1);
        revenueByDriver.set(
          trip.driverId,
          (revenueByDriver.get(trip.driverId) ?? 0n) + BigInt(trip.agreedPrice),
        );
      }
    }

    const fleet = [...kmByVehicle]
      .map(([id, km]) => ({
        id,
        label: vehicles.data?.find((vehicle) => vehicle.id === id)?.plateNumber ?? '—',
        km,
      }))
      .sort((a, b) => b.km - a.km)
      .slice(0, 5);

    const topDrivers = [...tripsByDriver]
      .map(([id, count]) => ({
        id,
        label: drivers.data?.find((driver) => driver.id === id)?.fullName ?? '—',
        trips: count,
        km: kmByDriver.get(id) ?? 0,
        revenue: revenueByDriver.get(id) ?? 0n,
      }))
      .sort((a, b) => b.trips - a.trips)
      .slice(0, 4);

    return {
      revenue,
      cost,
      profit: revenue - cost,
      completed: completed.length,
      categories: expensesByCategory(periodExpenses),
      fleet,
      fleetMax: Math.max(...fleet.map((row) => row.km), 1),
      topDrivers,
    };
  }, [period, trips.data, incomes.data, expenses.data, vehicles.data, drivers.data]);

  return (
    <div>
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        actions={
          <>
            <Segmented<Period>
              value={period}
              onChange={setPeriod}
              options={(['week', 'month', 'quarter', 'year'] as Period[]).map((value) => ({
                value,
                label: t(`reports.periods.${value}`),
              }))}
            />
            <Button variant="secondary" icon="export" className="hidden md:inline-flex">
              {t('reports.export')}
            </Button>
          </>
        }
      />

      {isLoading ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-3 grid gap-3 xl:grid-cols-[3fr_2fr]">
            <Card className="px-[18px] py-4">
              <div className="text-sm font-medium">{t('reports.revenueVsCost')}</div>
              <div className="mb-3 text-xs text-neutral-500">
                {t('reports.revenueCaption', { period: t(`reports.periods.${period}`) })}
              </div>
              <RevenueCostBars revenue={report.revenue} cost={report.cost} />
              <div className="mt-1.5 flex flex-wrap gap-4 text-xs">
                <Legend color="var(--color-accent)" label={t('reports.revenue')} />
                <Legend color="var(--color-neutral-700)" label={t('reports.cost')} />
                <span className="ml-auto font-medium text-positive-text">
                  {t('reports.netProfit')}: {formatMillionsTiyin(report.profit)} {t('common.mln')}
                </span>
              </div>
            </Card>

            <Card className="px-[18px] py-4">
              <div className="text-sm font-medium">{t('reports.costBreakdown')}</div>
              <div className="mb-3.5 text-xs text-neutral-500">
                {formatMillionsTiyin(report.cost)} {t('common.mlnSom')}
              </div>
              {report.categories.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="flex flex-col gap-3 text-[12.5px]">
                  {report.categories.slice(0, 5).map((share, index) => (
                    <MeterRow
                      key={share.category}
                      label={t(`finance.categories.${share.category}`)}
                      value={`${formatMillionsTiyin(share.amount)} ${t('common.mln')} · ${share.percent}%`}
                      percent={share.percent}
                      color={BAR_COLORS[index] ?? BAR_COLORS[BAR_COLORS.length - 1]}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="px-[18px] py-4">
              <div className="mb-3 text-sm font-medium">{t('reports.fleetUtilisation')}</div>
              {report.fleet.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="flex flex-col gap-2.5 text-[12.5px]">
                  {report.fleet.map((row, index) => (
                    <div key={row.id} className="flex items-center gap-2.5">
                      <span className="w-[90px] shrink-0 font-medium">{row.label}</span>
                      <div className="h-1.5 flex-1 rounded-[3px] bg-neutral-900">
                        <div
                          className="h-full rounded-[3px]"
                          style={{
                            width: `${(row.km / report.fleetMax) * 100}%`,
                            background: BAR_COLORS[index] ?? BAR_COLORS[BAR_COLORS.length - 1],
                          }}
                        />
                      </div>
                      <span className="w-[70px] shrink-0 text-right tabular-nums text-neutral-400">
                        {row.km.toLocaleString()} km
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="overflow-hidden p-0">
              <div className="px-[18px] pb-2.5 pt-3.5">
                <div className="text-sm font-medium">{t('reports.driverPerformance')}</div>
                <div className="text-xs text-neutral-500">{t('reports.topDrivers')}</div>
              </div>
              {report.topDrivers.length === 0 ? (
                <EmptyState />
              ) : (
                <>
                  <div className="px-3.5 pb-3.5 md:hidden">
                    <CardList>
                      {report.topDrivers.map((driver) => (
                        <ListCard
                          key={driver.id}
                          title={driver.label}
                          meta={
                            <>
                              <MetaItem label={t('trips.title')}>{driver.trips}</MetaItem>
                              <MetaItem label="Km">{driver.km.toLocaleString()}</MetaItem>
                              <MetaItem label={t('reports.revenue')} full>
                                <span className="tabular-nums">{formatTiyin(driver.revenue)}</span>
                              </MetaItem>
                            </>
                          }
                        />
                      ))}
                    </CardList>
                  </div>
                  <div className="hidden md:block">
                    <Table>
                      <thead>
                        <tr>
                          <th className="pl-[18px]">{t('trips.driver')}</th>
                          <th className="text-right">{t('trips.title')}</th>
                          <th className="text-right">Km</th>
                          <th className="pr-[18px] text-right">{t('reports.revenue')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.topDrivers.map((driver) => (
                          <Row key={driver.id}>
                            <Cell className="pl-[18px] font-medium">{driver.label}</Cell>
                            <Cell align="right">{driver.trips}</Cell>
                            <Cell align="right" className="text-neutral-400">
                              {driver.km.toLocaleString()}
                            </Cell>
                            <Cell align="right" className="pr-[18px]">
                              {formatTiyin(driver.revenue)}
                            </Cell>
                          </Row>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-[9px] w-[9px] rounded-sm" style={{ background: color }} />
      <span className="text-neutral-400">{label}</span>
    </span>
  );
}

/** Two grounded bars — the period's revenue against its cost. */
function RevenueCostBars({ revenue, cost }: { revenue: bigint; cost: bigint }) {
  const { t } = useTranslation();
  const max = revenue > cost ? revenue : cost;
  const height = (value: bigint) => (max === 0n ? 0 : Number((value * 100n) / max));

  return (
    <div className="flex h-[180px] items-end gap-6 border-b border-neutral-800 pb-0">
      <BarColumn
        percent={height(revenue)}
        color="var(--color-accent)"
        label={t('reports.revenue')}
        value={formatMillionsTiyin(revenue)}
      />
      <BarColumn
        percent={height(cost)}
        color="var(--color-neutral-700)"
        label={t('reports.cost')}
        value={formatMillionsTiyin(cost)}
      />
    </div>
  );
}

function BarColumn({
  percent,
  color,
  label,
  value,
}: {
  percent: number;
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex h-full max-w-[120px] flex-1 flex-col justify-end">
      <div className="mb-1.5 text-center text-[12.5px] font-semibold tabular-nums">{value}</div>
      <div
        className="rounded-t"
        style={{ height: `${Math.max(percent, 2)}%`, background: color }}
      />
      <div className="mt-1.5 text-center text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}
