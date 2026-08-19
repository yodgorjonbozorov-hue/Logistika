import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet';
import { LiveStatus } from 'shared';
import {
  BRAND,
  Card,
  CardHeader,
  EmptyState,
  ErrorMessage,
  IconAlert,
  IconArrowRight,
  Spinner,
  StatCard,
} from '../../shared/ui';
import { formatDate, formatDateTime } from '../../shared/utils/date';
import { formatTiyin } from '../../shared/utils/money';
import { MonthlyProfitChart } from './MonthlyProfitChart';
import { useFuelAlerts, useLiveFleet, useRecentEvents, useSummary } from './api';

const TASHKENT: [number, number] = [41.3, 69.25];

const STATUS_COLORS: Record<LiveStatus, string> = {
  [LiveStatus.MOVING]: BRAND.success,
  [LiveStatus.RESTING]: BRAND.warning,
  [LiveStatus.BREAKDOWN]: BRAND.danger,
  [LiveStatus.IDLE]: BRAND.muted,
};

/** W-1 — the owner's first screen: the month in six numbers, then the detail. */
export function DashboardPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useSummary({});
  const alerts = useFuelAlerts();

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  if (!data) return <EmptyState />;

  const flagged = alerts.data?.rows.filter((row) => row.overThreshold).length ?? 0;
  const profit = BigInt(data.netProfit);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-title2 font-semibold">{t('dashboard.title')}</h1>
        <p className="mt-0.5 text-subhead text-ink-secondary">
          {t('dashboard.period')}: {formatDate(data.range.from)} — {formatDate(data.range.to)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label={t('dashboard.onRoad')}
          value={`${data.vehiclesOnRoad}/${data.vehiclesTotal}`}
        />
        <StatCard label={t('dashboard.tripsToday')} value={data.tripsToday} />
        <StatCard
          label={t('dashboard.income')}
          value={formatTiyin(data.income)}
          delta={t('common.som')}
          trend="up"
        />
        <StatCard
          label={t('dashboard.expenses')}
          value={formatTiyin(data.expenses)}
          delta={`${t('dashboard.amortization')} ${formatTiyin(data.amortization)}`}
          trend="down"
        />
        <StatCard
          label={t('dashboard.netProfit')}
          value={formatTiyin(data.netProfit)}
          delta={t('common.som')}
          tone="navy"
          trend={profit >= 0n ? 'up' : 'down'}
        />
        <Link to="/fuel" className="rounded-lg focus-visible:outline-none">
          <StatCard
            label={t('dashboard.fuelAlerts')}
            value={flagged}
            delta={flagged > 0 ? t('dashboard.seeFuel') : t('dashboard.allWithinNorm')}
            trend={flagged > 0 ? 'down' : 'up'}
            icon={flagged > 0 ? <IconAlert size={18} /> : undefined}
          />
        </Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <MonthlyProfitChart points={data.monthly} />
        </Card>

        <Card>
          <CardHeader title={t('dashboard.receivables')} />
          <dl className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-subhead text-ink-secondary">{t('dashboard.receivable')}</dt>
              <dd className="font-mono text-headline font-semibold tabular-nums">
                {formatTiyin(data.receivable)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-subhead text-ink-secondary">{t('dashboard.overdue')}</dt>
              <dd className="font-mono text-headline font-semibold tabular-nums text-danger">
                {formatTiyin(data.overdue)}
              </dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-line pt-4">
            <h3 className="mb-3 text-subhead font-semibold">{t('dashboard.expenseStructure')}</h3>
            {data.expensesByCategory.length === 0 ? (
              <p className="text-subhead text-ink-tertiary">{t('common.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {data.expensesByCategory.slice(0, 5).map((item) => (
                  <li key={item.category} className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-subhead text-ink-secondary">
                      {t(`finance.categories.${item.category}`)}
                    </span>
                    <span className="font-mono text-subhead tabular-nums">
                      {formatTiyin(item.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" padded={false}>
          <div className="flex items-center justify-between gap-3 p-4 sm:p-5">
            <h2 className="text-headline font-semibold">{t('dashboard.liveMap')}</h2>
            <Link
              to="/map"
              className="inline-flex items-center gap-1 text-subhead font-medium text-brand-primary"
            >
              {t('dashboard.openMap')}
              <IconArrowRight size={16} />
            </Link>
          </div>
          <FleetMiniMap />
        </Card>

        <Card>
          <CardHeader title={t('dashboard.recentEvents')} />
          <RecentEventsFeed />
        </Card>
      </div>
    </div>
  );
}

function FleetMiniMap() {
  const { data } = useLiveFleet();
  const vehicles = (data ?? []).filter((vehicle) => vehicle.lastPosition);

  return (
    <div className="h-[300px] overflow-hidden rounded-b-lg">
      <MapContainer center={TASHKENT} zoom={6} className="h-full w-full" scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {vehicles.map((vehicle) => (
          <CircleMarker
            key={vehicle.vehicleId}
            center={[vehicle.lastPosition!.lat, vehicle.lastPosition!.lng]}
            radius={7}
            pathOptions={{
              color: BRAND.white,
              weight: 2,
              fillColor: STATUS_COLORS[vehicle.status],
              fillOpacity: 1,
            }}
          />
        ))}
      </MapContainer>
    </div>
  );
}

function RecentEventsFeed() {
  const { t } = useTranslation();
  const { data, isLoading } = useRecentEvents();

  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) {
    return <p className="text-subhead text-ink-tertiary">{t('trips.timelineNote')}</p>;
  }

  return (
    <ol className="space-y-3.5">
      {data.map((event) => (
        <li key={event.id} className="flex gap-3">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-primary" />
          <div className="min-w-0">
            <div className="truncate text-subhead">
              <span className="font-medium">{event.driver?.fullName ?? '—'}</span>
              <span className="text-ink-secondary"> · {t(`event.${event.eventType}`)}</span>
            </div>
            <div className="truncate font-mono text-caption tabular-nums text-ink-tertiary">
              {formatDateTime(event.eventTime)}
              {event.trip?.vehicle?.plateNumber ? ` · ${event.trip.vehicle.plateNumber}` : ''}
              {event.address ? ` · ${event.address}` : ''}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
