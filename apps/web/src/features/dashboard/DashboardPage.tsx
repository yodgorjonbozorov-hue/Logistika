import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useDashboard } from '../../shared/api/analytics';
import { Card, EmptyState, ErrorMessage, PageHeader, Spinner } from '../../shared/ui';
import { ProfitChart, StatCard } from '../../shared/ui/stats';
import { formatDateTime } from '../../shared/utils/date';
import { formatBp } from '../../shared/utils/format';
import { formatTiyin } from '../../shared/utils/money';

export function DashboardPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useDashboard();

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorMessage error={error ?? new Error()} />;

  const profitIsPositive = BigInt(data.month.profit) >= 0n;

  return (
    <div className="space-y-4">
      <PageHeader title={t('dashboard.title')} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label={t('dashboard.onRoad')}
          value={`${data.vehiclesOnRoad}/${data.vehiclesTotal}`}
        />
        <StatCard label={t('dashboard.tripsToday')} value={data.tripsToday} />
        <StatCard
          label={t('dashboard.monthRevenue')}
          value={formatTiyin(data.month.revenue)}
          hint={t('common.som')}
        />
        <StatCard
          label={t('dashboard.monthCost')}
          value={formatTiyin(data.month.cost)}
          hint={t('common.som')}
        />
        <StatCard
          label={t('dashboard.monthProfit')}
          value={formatTiyin(data.month.profit)}
          hint={`${t('finance.margin')} ${formatBp(data.month.marginBp)}`}
          tone={profitIsPositive ? 'success' : 'danger'}
        />
        <Link to="/alerts" className="block">
          <StatCard
            label={t('dashboard.alerts')}
            value={data.unreadAlerts}
            tone={data.unreadAlerts > 0 ? 'danger' : 'default'}
            hint={t('dashboard.openAlerts')}
          />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ProfitChart data={data.profitTrend} />

        <Card>
          <div className="mb-3 text-sm font-semibold">{t('dashboard.recentEvents')}</div>
          {data.recentEvents.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-2 text-sm">
              {data.recentEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex items-baseline justify-between gap-3 border-b border-gray-100 pb-2 last:border-0 dark:border-white/5"
                >
                  <span>
                    <span className="font-medium">{event.driverName ?? '—'}</span>{' '}
                    <span className="text-muted">
                      — {t(`event.${event.eventType}`)}
                      {event.address ? `, ${event.address}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {formatDateTime(event.eventTime)}
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
