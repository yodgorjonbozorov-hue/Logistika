import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../shared/api/client';
import type { DashboardSummary, LiveVehicle } from '../../shared/api/entities';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorMessage,
  KpiCard,
  PageHeader,
  SectionTitle,
  Skeleton,
  type Column,
} from '../../shared/ui';
import { Icon } from '../../shared/ui/icons';
import { formatDate, formatDateTime } from '../../shared/utils/date';
import { formatTiyin } from '../../shared/utils/money';
import { StatusBadge } from '../trips/StatusBadge';
import type { Trip } from '../../shared/api/entities';

const LIVE_POLL_MS = 30_000;

const STATUS_DOT: Record<string, string> = {
  MOVING: 'bg-success',
  RESTING: 'bg-accent',
  BREAKDOWN: 'bg-danger',
  IDLE: 'bg-ink-2',
};

export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const summary = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => (await api<DashboardSummary>('/dashboard/summary')).data,
  });

  const live = useQuery({
    queryKey: ['tracking', 'live'],
    queryFn: async () => (await api<LiveVehicle[]>('/tracking/live')).data,
    refetchInterval: LIVE_POLL_MS,
  });

  const kpi = summary.data?.kpi;

  const tripColumns: Array<Column<Trip>> = [
    {
      key: 'number',
      header: t('trips.number'),
      primary: true,
      cell: (trip) => <span className="whitespace-nowrap">{trip.tripNumber}</span>,
    },
    {
      key: 'status',
      header: t('trips.status'),
      secondary: true,
      cell: (trip) => <StatusBadge status={trip.status} />,
    },
    // The dashboard table shares its row with the map panel, so it carries only
    // what fits on one line — client and full addresses live on /trips.
    {
      key: 'route',
      header: t('trips.route'),
      cell: (trip) => (
        <span className="block max-w-[22rem] truncate">
          {trip.loadingAddress ?? '—'} → {trip.unloadingAddress ?? '—'}
        </span>
      ),
    },
    {
      key: 'client',
      header: t('trips.client'),
      cell: (trip) => (
        <span className="block max-w-[12rem] truncate">{trip.client?.name ?? '—'}</span>
      ),
    },
    {
      key: 'driver',
      header: t('trips.driver'),
      cell: (trip) => (
        <span className="block max-w-[12rem] truncate">{trip.driver?.fullName ?? '—'}</span>
      ),
    },
    {
      key: 'price',
      header: t('trips.price'),
      className: 'money whitespace-nowrap',
      cell: (trip) => formatTiyin(trip.agreedPrice),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        actions={
          <Button variant="secondary" onClick={() => void summary.refetch()}>
            <Icon name="clock" className="h-4 w-4" />
            {t('common.refresh')}
          </Button>
        }
      />

      <ErrorMessage error={summary.error} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {summary.isLoading || !kpi
          ? Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-24" />)
          : [
              { label: t('dashboard.activeTrips'), value: kpi.activeTrips, to: '/trips' },
              { label: t('dashboard.todayTrips'), value: kpi.todayTrips, to: '/trips' },
              { label: t('dashboard.activeVehicles'), value: kpi.activeVehicles, to: '/vehicles' },
              { label: t('dashboard.activeDrivers'), value: kpi.activeDrivers, to: '/drivers' },
              {
                label: t('dashboard.todayIncome'),
                value: formatTiyin(kpi.todayIncome),
                tone: 'success' as const,
                hint: t('common.som'),
                to: '/finance',
              },
              {
                label: t('dashboard.todayExpense'),
                value: formatTiyin(kpi.todayExpense),
                tone: 'danger' as const,
                hint: t('common.som'),
                to: '/finance',
              },
              {
                label: t('dashboard.receivables'),
                value: formatTiyin(kpi.receivables),
                tone: 'accent' as const,
                hint: t('common.som'),
                to: '/clients',
              },
            ].map((card) => (
              <KpiCard
                key={card.label}
                label={card.label}
                value={card.value}
                hint={card.hint}
                tone={card.tone}
                onClick={() => navigate(card.to)}
              />
            ))}
      </div>

      <div className="mt-6 grid gap-4 2xl:grid-cols-3">
        <section className="min-w-0 2xl:col-span-2">
          <SectionTitle
            action={
              <Link to="/trips" className="text-sm text-accent hover:underline">
                {t('dashboard.seeAll')}
              </Link>
            }
          >
            {t('dashboard.activeTripsTitle')}
          </SectionTitle>
          {summary.isLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <DataTable
              rows={summary.data?.activeTrips ?? []}
              columns={tripColumns}
              getKey={(trip) => trip.id}
              onRowClick={(trip) => navigate(`/trips/${trip.id}`)}
              empty={<EmptyState title={t('dashboard.noActiveTrips')} />}
            />
          )}
        </section>

        <section className="min-w-0">
          <SectionTitle
            action={
              <Link to="/tracking" className="text-sm text-accent hover:underline">
                {t('dashboard.openMap')}
              </Link>
            }
          >
            {t('dashboard.mapPreview')}
          </SectionTitle>
          <Card className="space-y-2">
            {live.isLoading ? (
              <Skeleton className="h-32" />
            ) : (live.data ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-2">{t('common.empty')}</p>
            ) : (
              (live.data ?? []).map((vehicle) => (
                <Link
                  key={vehicle.vehicleId}
                  to="/tracking"
                  className="flex items-center gap-3 rounded-lg border border-line p-2.5 hover:bg-surface-2"
                >
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[vehicle.status] ?? 'bg-ink-2'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {vehicle.plateNumber}
                    </span>
                    <span className="block truncate text-xs text-ink-2">
                      {t(`map.${vehicle.status}`)}
                      {vehicle.driverName ? ` · ${vehicle.driverName}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] text-ink-2">
                    {vehicle.lastPosition ? formatDateTime(vehicle.lastPosition.recordedAt) : '—'}
                  </span>
                </Link>
              ))
            )}
          </Card>
        </section>
      </div>

      <section className="mt-6 min-w-0">
        <SectionTitle>{t('dashboard.recentTransactions')}</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="mb-2 text-sm font-semibold text-success">
              {t('dashboard.incomeLabel')}
            </div>
            {(summary.data?.recentIncomes ?? []).length === 0 ? (
              <p className="py-3 text-sm text-ink-2">{t('common.empty')}</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {(summary.data?.recentIncomes ?? []).map((income) => (
                  <li key={income.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {income.client?.name ?? income.trip?.tripNumber ?? '—'}
                      </span>
                      <span className="block truncate text-xs text-ink-2">
                        {formatDate(income.paymentDate ?? income.createdAt)} ·{' '}
                        {t(`finance.paymentStatuses.${income.status}`)}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold text-success money">
                      +{formatTiyin(income.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-2 text-sm font-semibold text-danger">
              {t('dashboard.expenseLabel')}
            </div>
            {(summary.data?.recentExpenses ?? []).length === 0 ? (
              <p className="py-3 text-sm text-ink-2">{t('common.empty')}</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {(summary.data?.recentExpenses ?? []).map((expense) => (
                  <li key={expense.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {t(`finance.categories.${expense.category}`)}
                      </span>
                      <span className="block truncate text-xs text-ink-2">
                        {formatDate(expense.expenseDate)}
                        {expense.trip ? ` · ${expense.trip.tripNumber}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold text-danger money">
                      −{formatTiyin(expense.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
