import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { TripStatus } from 'shared';
import {
  useAllTrips,
  useClients,
  useDrivers,
  useExpenses,
  useIncomes,
  useVehicles,
} from '../../shared/api/queries';
import type { Driver, Expense, Trip } from '../../shared/api/entities';
import { useAuth } from '../../shared/auth/AuthContext';
import {
  Avatar,
  Card,
  CardList,
  Cell,
  EmptyState,
  Icon,
  ListCard,
  MetaItem,
  Row,
  Segmented,
  SkeletonCards,
  StatCard,
  StatusChip,
  Table,
  Tag,
  initialsOf,
} from '../../shared/ui';
import { formatDateTime } from '../../shared/utils/date';
import { formatMillionsTiyin, formatTiyin } from '../../shared/utils/money';
import { TRIP_STATUS_TONE } from '../../shared/utils/status';
import {
  busyResourceIds,
  completedPerDay,
  completedThisMonth,
  countByStatus,
  donutSegments,
  incomeTotals,
  openTrips,
  receivables,
  sumAmounts,
  type IncomeTotals,
} from './metrics';

type DashMode = 'panel' | 'ops';

export function OverviewPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [mode, setMode] = useState<DashMode>('panel');

  const trips = useAllTrips();
  const vehicles = useVehicles();
  const drivers = useDrivers();
  const clients = useClients();
  const incomes = useIncomes();
  const expenses = useExpenses();

  const isLoading =
    trips.isLoading ||
    vehicles.isLoading ||
    drivers.isLoading ||
    clients.isLoading ||
    incomes.isLoading;

  const data = useMemo<OverviewData>(() => {
    const now = new Date();
    const allTrips = trips.data ?? [];
    const busy = busyResourceIds(allTrips);
    const activeVehicles = (vehicles.data ?? []).filter((v) => v.isActive);
    const activeDrivers = (drivers.data ?? []).filter((d) => d.isActive);
    const monthIncomes = (incomes.data ?? []).filter(
      (income) =>
        income.paymentDate &&
        new Date(income.paymentDate).getFullYear() === now.getFullYear() &&
        new Date(income.paymentDate).getMonth() === now.getMonth(),
    );

    return {
      now,
      allTrips,
      open: openTrips(allTrips),
      counts: countByStatus(allTrips),
      inProgress: allTrips.filter((trip) => trip.status === TripStatus.IN_PROGRESS),
      completedMonth: completedThisMonth(allTrips, now),
      perDay: completedPerDay(allTrips, 14, now),
      vehicleTotal: activeVehicles.length,
      vehicleBusy: activeVehicles.filter((v) => busy.vehicles.has(v.id)).length,
      driverTotal: activeDrivers.length,
      driverFree: activeDrivers.filter((d) => !busy.drivers.has(d.id)).length,
      drivers: activeDrivers,
      revenue: sumAmounts(monthIncomes),
      totals: incomeTotals(incomes.data ?? []),
      debt: receivables(clients.data ?? []),
      expenses: expenses.data ?? [],
    };
  }, [trips.data, vehicles.data, drivers.data, clients.data, incomes.data, expenses.data]);

  const greeting = t(greetingKey(new Date().getHours()), {
    name: user?.fullName?.split(' ')[0] ?? '',
  });

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:mb-5 md:flex-row md:flex-wrap md:items-end md:gap-4">
        <div className="min-w-0">
          <h3 className="m-0 mb-[3px] text-[20px] md:text-[22px]">{greeting}</h3>
          <div className="text-[13px] text-neutral-500">
            {formatToday(data.now)} ·{' '}
            {t('overview.subtitle', {
              vehicles: data.vehicleTotal,
              drivers: data.driverTotal,
            })}
          </div>
        </div>
        <div className="hidden flex-1 md:block" />
        <Segmented<DashMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'panel', label: t('overview.modes.panel') },
            { value: 'ops', label: t('overview.modes.ops') },
          ]}
        />
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <SkeletonCards count={6} height={96} />
          <SkeletonCards count={2} height={200} />
        </div>
      ) : mode === 'panel' ? (
        <DashboardPanel data={data} />
      ) : (
        <OpsRoom data={data} />
      )}
    </div>
  );
}

interface OverviewData {
  now: Date;
  allTrips: Trip[];
  open: Trip[];
  counts: Record<TripStatus, number>;
  inProgress: Trip[];
  completedMonth: Trip[];
  perDay: Array<{ day: string; count: number }>;
  vehicleTotal: number;
  vehicleBusy: number;
  driverTotal: number;
  driverFree: number;
  drivers: Driver[];
  revenue: bigint;
  totals: IncomeTotals;
  debt: bigint;
  expenses: Expense[];
}

function greetingKey(hour: number): string {
  if (hour < 12) return 'overview.greeting.morning';
  if (hour < 18) return 'overview.greeting.afternoon';
  return 'overview.greeting.evening';
}

function formatToday(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// ---------- Dashboard panel ----------

function DashboardPanel({ data }: { data: OverviewData }) {
  const { t } = useTranslation();
  const freeVehicles = data.vehicleTotal - data.vehicleBusy;

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2.5 md:mb-3.5 md:grid-cols-3 md:gap-3 xl:grid-cols-6">
        <StatCard label={t('overview.kpi.activeTrips')} value={data.open.length}>
          <Sparkline points={data.perDay.map((d) => d.count)} />
        </StatCard>

        <StatCard
          label={t('overview.kpi.completedMonth')}
          value={data.completedMonth.length}
          delta={t('overview.kpi.completedHint')}
          deltaTone="positive"
        />

        <StatCard
          label={t('overview.kpi.freeVehicles')}
          value={freeVehicles}
          unit={`/ ${data.vehicleTotal}`}
        >
          <div className="mt-3 flex gap-[3px]">
            <Bar flex={data.vehicleBusy} color="var(--color-accent-700)" />
            <Bar flex={freeVehicles} color="var(--color-neutral-800)" />
          </div>
          <div className="mt-1.5 text-[11px] text-neutral-600">
            {t('overview.kpi.vehicleSplit', { busy: data.vehicleBusy, free: freeVehicles })}
          </div>
        </StatCard>

        <StatCard
          label={t('nav.drivers')}
          value={data.driverTotal}
          unit={t('overview.kpi.driversFree', { count: data.driverFree })}
        >
          <div className="mt-2.5 flex">
            {data.drivers.slice(0, 3).map((driver, index) => (
              <span key={driver.id} style={{ marginLeft: index === 0 ? 0 : -6 }}>
                <span className="block rounded-full border-[1.5px] border-bg">
                  <Avatar
                    initials={initialsOf(driver.fullName)}
                    size={22}
                    tone={index === 0 ? 'accent' : 'neutral'}
                  />
                </span>
              </span>
            ))}
            {data.drivers.length > 3 ? (
              <span style={{ marginLeft: -6 }}>
                <span className="block rounded-full border-[1.5px] border-bg">
                  <Avatar initials={`+${data.drivers.length - 3}`} size={22} />
                </span>
              </span>
            ) : null}
          </div>
        </StatCard>

        <StatCard
          label={t('overview.kpi.revenue')}
          value={formatMillionsTiyin(data.revenue)}
          unit={t('common.mlnSom')}
          delta={t('overview.kpi.revenueHint')}
          deltaTone="positive"
        />

        <StatCard
          label={t('overview.kpi.receivables')}
          value={formatMillionsTiyin(data.debt)}
          unit={t('common.mlnSom')}
          delta={
            <>
              <Icon name="warning-circle" size={12} />{' '}
              {t('overview.kpi.overdue', {
                amount: formatMillionsTiyin(data.totals.overdue),
              })}
            </>
          }
          deltaTone="danger"
        />
      </div>

      <div className="mb-3.5 grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Card className="px-[18px] py-4">
          <div className="mb-3.5 flex items-center">
            <div>
              <div className="text-sm font-medium">{t('overview.dynamics.title')}</div>
              <div className="text-xs text-neutral-500">{t('overview.dynamics.subtitle')}</div>
            </div>
            <div className="flex-1" />
            <Tag variant="outline" className="text-[11px]">
              {t('overview.dynamics.range')}
            </Tag>
          </div>
          <BarChart buckets={data.perDay} />
        </Card>

        <Card className="px-[18px] py-4">
          <div className="text-sm font-medium">{t('overview.donut.title')}</div>
          <div className="mb-2.5 text-xs text-neutral-500">
            {t('overview.donut.subtitle', { count: data.allTrips.length })}
          </div>
          <StatusDonut counts={data.counts} total={data.allTrips.length} />
        </Card>
      </div>

      <ActiveTripsCard trips={data.open} />
    </>
  );
}

function Bar({ flex, color }: { flex: number; color: string }) {
  if (flex <= 0) return null;
  return <div className="h-[5px] rounded-[3px]" style={{ flex, background: color }} />;
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length === 0) return null;
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? 120 / (points.length - 1) : 0;
  const path = points.map((value, i) => `${i * step},${18 - (value / max) * 14}`).join(' ');
  return (
    <svg
      width="100%"
      height="22"
      viewBox="0 0 120 22"
      preserveAspectRatio="none"
      className="mt-1.5"
      aria-hidden="true"
    >
      <polyline points={path} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
    </svg>
  );
}

/** The 14-bar dynamics chart — today's bar carries the accent and its glow. */
function BarChart({ buckets }: { buckets: Array<{ day: string; count: number }> }) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const labelAt = [0, 3, 6, 10, 13];

  return (
    <>
      <div className="flex h-[120px] items-end gap-2">
        {buckets.map((bucket, index) => {
          const isToday = index === buckets.length - 1;
          const height = bucket.count === 0 ? 4 : Math.max(8, (bucket.count / max) * 100);
          return (
            <div
              key={bucket.day}
              title={`${bucket.day}: ${bucket.count}`}
              className="flex-1 rounded-t"
              style={{
                height: `${height}%`,
                background: isToday
                  ? 'var(--color-accent-500)'
                  : bucket.count === 0
                    ? 'var(--color-neutral-800)'
                    : 'var(--color-accent-800)',
                boxShadow: isToday
                  ? '0 0 14px color-mix(in srgb, var(--color-accent) 35%, transparent)'
                  : undefined,
              }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10.5px] text-neutral-600">
        {labelAt.map((index) => (
          <span key={index}>{shortDay(buckets[index]?.day)}</span>
        ))}
      </div>
    </>
  );
}

function shortDay(day: string | undefined): string {
  if (!day) return '';
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

const DONUT_COLORS: Record<TripStatus, string> = {
  [TripStatus.IN_PROGRESS]: 'var(--color-accent)',
  [TripStatus.ASSIGNED]: 'var(--color-accent-700)',
  [TripStatus.COMPLETED]: 'var(--color-positive)',
  [TripStatus.DRAFT]: 'var(--color-neutral-700)',
  [TripStatus.CANCELLED]: 'var(--color-neutral-800)',
};

function StatusDonut({ counts, total }: { counts: Record<TripStatus, number>; total: number }) {
  const { t } = useTranslation();
  const segments = donutSegments(counts);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-[18px]">
      <svg width="116" height="116" viewBox="0 0 116 116" aria-hidden="true">
        <circle
          cx="58"
          cy="58"
          r={radius}
          fill="none"
          stroke="var(--color-neutral-900)"
          strokeWidth="10"
        />
        {segments.map((segment) => {
          const length = total === 0 ? 0 : (segment.count / total) * circumference;
          const dash = `${length} ${circumference - length}`;
          const element = (
            <circle
              key={segment.status}
              cx="58"
              cy="58"
              r={radius}
              fill="none"
              stroke={DONUT_COLORS[segment.status]}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              transform="rotate(-90 58 58)"
            />
          );
          offset += length;
          return element;
        })}
        <text
          x="58"
          y="54"
          textAnchor="middle"
          fill="var(--color-text)"
          fontSize="22"
          fontWeight="600"
        >
          {total}
        </text>
        <text x="58" y="70" textAnchor="middle" fill="var(--color-neutral-500)" fontSize="10">
          {t('overview.donut.unit')}
        </text>
      </svg>
      <div className="flex flex-col gap-[7px] text-[12.5px]">
        {Object.values(TripStatus).map((status) => (
          <div key={status} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-sm"
              style={{ background: DONUT_COLORS[status] }}
              aria-hidden="true"
            />
            <span className="text-neutral-400">{t(`status.${status}`)}</span>
            <span className="ml-auto font-semibold tabular-nums">{counts[status]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActiveTripsCard({ trips }: { trips: Trip[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center px-[18px] pb-3 pt-3.5">
        <div>
          <div className="text-sm font-medium">{t('overview.active.title')}</div>
          <div className="text-xs text-neutral-500">{t('overview.active.subtitle')}</div>
        </div>
        <div className="flex-1" />
        <Link to="/trips" className="flex min-h-[40px] items-center gap-1 text-[12.5px]">
          {t('common.all')} <Icon name="arrow-right" size={12} />
        </Link>
      </div>
      {trips.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="px-3 pb-3 md:hidden">
            <CardList>
              {trips.slice(0, 5).map((trip) => (
                <ListCard
                  key={trip.id}
                  onClick={() => navigate(`/trips/${trip.id}`)}
                  title={<span className="tabular-nums text-accent-300">{trip.tripNumber}</span>}
                  subtitle={`${trip.loadingAddress ?? '—'} → ${trip.unloadingAddress ?? '—'}`}
                  trailing={
                    <StatusChip tone={TRIP_STATUS_TONE[trip.status]}>
                      {t(`status.${trip.status}`)}
                    </StatusChip>
                  }
                  meta={
                    <>
                      <MetaItem label={t('trips.vehicle')}>
                        {trip.vehicle?.plateNumber ?? '—'}
                      </MetaItem>
                      <MetaItem label={t('trips.driver')}>{trip.driver?.fullName ?? '—'}</MetaItem>
                      <MetaItem label={t('trips.departure')}>
                        {formatDateTime(trip.startedAt ?? trip.loadingDate)}
                      </MetaItem>
                      <MetaItem label={t('trips.eta')}>
                        {formatDateTime(trip.unloadingDate)}
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
                  <th className="pl-[18px]">{t('trips.number')}</th>
                  <th>{t('trips.vehicle')}</th>
                  <th>{t('trips.driver')}</th>
                  <th>{t('trips.route')}</th>
                  <th>{t('trips.cargoName')}</th>
                  <th>{t('trips.status')}</th>
                  <th>{t('trips.departure')}</th>
                  <th>{t('trips.eta')}</th>
                  <th className="pr-[18px]" />
                </tr>
              </thead>
              <tbody>
                {trips.slice(0, 5).map((trip) => (
                  <Row key={trip.id} onClick={() => navigate(`/trips/${trip.id}`)}>
                    <Cell className="pl-[18px] font-semibold tabular-nums text-accent-300">
                      {trip.tripNumber}
                    </Cell>
                    <Cell>
                      <div className="font-medium">{trip.vehicle?.plateNumber ?? '—'}</div>
                      <div className="text-[11.5px] text-neutral-500">
                        {[trip.vehicle?.brand, trip.vehicle?.model].filter(Boolean).join(' ') ||
                          '—'}
                      </div>
                    </Cell>
                    <Cell>{trip.driver?.fullName ?? '—'}</Cell>
                    <Cell>
                      <RouteCell from={trip.loadingAddress} to={trip.unloadingAddress} />
                    </Cell>
                    <Cell>
                      <div>{trip.cargoName ?? '—'}</div>
                      <div className="text-[11.5px] text-neutral-500">
                        {trip.cargoWeight ? `${trip.cargoWeight} ${t('common.ton')}` : ''}
                      </div>
                    </Cell>
                    <Cell>
                      <StatusChip tone={TRIP_STATUS_TONE[trip.status]}>
                        {t(`status.${trip.status}`)}
                      </StatusChip>
                    </Cell>
                    <Cell className="tabular-nums text-neutral-400">
                      {formatDateTime(trip.startedAt ?? trip.loadingDate)}
                    </Cell>
                    <Cell className="tabular-nums text-neutral-400">
                      {formatDateTime(trip.unloadingDate)}
                    </Cell>
                    <Cell className="pr-[18px] text-right">
                      <Icon
                        name="dots-three"
                        size={16}
                        style={{ color: 'var(--color-neutral-500)' }}
                      />
                    </Cell>
                  </Row>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}
    </Card>
  );
}

export function RouteCell({ from, to }: { from: string | null; to: string | null }) {
  return (
    <span className="whitespace-nowrap">
      {from ?? '—'}{' '}
      <Icon name="arrow-right" size={11} style={{ color: 'var(--color-neutral-600)' }} />{' '}
      {to ?? '—'}
    </span>
  );
}

// ---------- Operations room ----------

function OpsRoom({ data }: { data: OverviewData }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const freeVehicles = data.vehicleTotal - data.vehicleBusy;

  const columns = [
    { status: TripStatus.DRAFT, tone: 'transparent' },
    { status: TripStatus.ASSIGNED, tone: 'var(--color-accent-700)' },
    { status: TripStatus.IN_PROGRESS, tone: 'var(--color-accent)' },
  ] as const;

  return (
    <>
      <div className="mb-3.5 flex flex-wrap gap-[22px] rounded-md border border-neutral-800 px-4 py-3 text-[13px]">
        <div>
          <span className="text-neutral-500">{t('overview.ops.active')}:</span>{' '}
          <b>{data.open.length}</b>
        </div>
        <div>
          <span className="text-neutral-500">{t('overview.ops.freeVehicles')}:</span>{' '}
          <b>{freeVehicles}</b>
        </div>
        <div>
          <span className="text-neutral-500">{t('overview.ops.freeDrivers')}:</span>{' '}
          <b>{data.driverFree}</b>
        </div>
        <div>
          <span className="text-neutral-500">{t('overview.ops.completedMonth')}:</span>{' '}
          <b>{data.completedMonth.length}</b>
        </div>
        <div className="text-danger-text">
          <Icon name="warning-circle" size={13} /> {t('overview.ops.overdueDebt')}:{' '}
          <b>
            {formatMillionsTiyin(data.totals.overdue)} {t('common.mln')}
          </b>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[2fr_1fr]">
        <div className="grid gap-3 md:grid-cols-3">
          {columns.map((column) => {
            const trips = data.allTrips.filter((trip) => trip.status === column.status);
            return (
              <div key={column.status}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.05em] text-neutral-500">
                  {t(`status.${column.status}`)} · {trips.length}
                </div>
                <div className="flex flex-col gap-2">
                  {trips.length === 0 ? (
                    <div className="text-[12px] text-neutral-600">{t('common.empty')}</div>
                  ) : (
                    trips.slice(0, 4).map((trip) => (
                      <Card
                        key={trip.id}
                        onClick={() => navigate(`/trips/${trip.id}`)}
                        className="cursor-pointer px-[13px] py-[11px]"
                        style={
                          column.tone === 'transparent'
                            ? undefined
                            : { borderLeft: `2px solid ${column.tone}` }
                        }
                      >
                        <div className="flex justify-between">
                          <span className="text-[12.5px] font-semibold text-accent-300">
                            {trip.tripNumber}
                          </span>
                          {trip.unloadingDate ? (
                            <span className="text-[11px] text-neutral-500">
                              {t('trips.eta')} {formatDateTime(trip.unloadingDate)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-[3px] text-[12.5px]">
                          {trip.loadingAddress ?? '—'} → {trip.unloadingAddress ?? '—'}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-neutral-500">
                          {trip.driver?.fullName ??
                            trip.cargoName ??
                            t('overview.ops.noVehicleAssigned')}
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-3">
          <Card className="px-4 py-3.5">
            <div className="mb-2.5 text-[13.5px] font-medium">{t('overview.ops.feed')}</div>
            <div className="flex flex-col gap-[11px] text-[12.5px]">
              {data.allTrips.slice(0, 5).map((trip) => (
                <div key={trip.id} className="flex gap-2">
                  <span className="shrink-0 tabular-nums text-neutral-600">
                    {formatDateTime(trip.startedAt ?? trip.createdAt)}
                  </span>
                  <span>
                    <b>{trip.tripNumber}</b> — {t(`status.${trip.status}`)}
                  </span>
                </div>
              ))}
              {data.allTrips.length === 0 ? <EmptyState /> : null}
            </div>
          </Card>

          <Card className="px-4 py-3.5">
            <div className="mb-2.5 text-[13.5px] font-medium">{t('overview.ops.alerts')}</div>
            <div className="flex flex-col gap-2.5 text-[12.5px]">
              {data.totals.overdue > 0n ? (
                <div className="flex items-start gap-2">
                  <Icon
                    name="warning-circle"
                    size={15}
                    style={{ color: 'var(--color-danger)' }}
                    className="shrink-0"
                  />
                  <span>
                    {t('overview.ops.alertOverdue', {
                      amount: formatTiyin(data.totals.overdue),
                    })}
                  </span>
                </div>
              ) : null}
              {data.totals.pending > 0n ? (
                <div className="flex items-start gap-2">
                  <Icon
                    name="clock-countdown"
                    size={15}
                    style={{ color: 'var(--color-warning)' }}
                    className="shrink-0"
                  />
                  <span>
                    {t('overview.ops.alertPending', {
                      amount: formatTiyin(data.totals.pending),
                    })}
                  </span>
                </div>
              ) : null}
              {data.totals.overdue === 0n && data.totals.pending === 0n ? (
                <span className="text-neutral-500">{t('overview.ops.noAlerts')}</span>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
