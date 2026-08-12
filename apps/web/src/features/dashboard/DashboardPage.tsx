import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/client';
import type { DashboardData } from '../../shared/api/entities';
import { Card, ErrorMessage, PageHeader, Spinner } from '../../shared/ui';
import { formatDateTime } from '../../shared/utils/date';
import { formatTiyin } from '../../shared/utils/money';
import { cn } from '../../shared/utils/cn';

export function DashboardPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/reports/dashboard'),
    refetchInterval: 60_000,
  });

  const dashboard = data?.data;

  return (
    <div>
      <PageHeader title={t('dashboard.title')} />
      <ErrorMessage error={error} />
      {isLoading || !dashboard ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label={t('dashboard.onRoute')}
              value={`${dashboard.vehiclesOnRoute}/${dashboard.vehiclesTotal}`}
            />
            <StatCard label={t('dashboard.todayTrips')} value={String(dashboard.todayTrips)} />
            <StatCard
              label={t('dashboard.monthIncome')}
              value={formatTiyin(dashboard.monthIncome)}
            />
            <StatCard
              label={t('dashboard.monthExpense')}
              value={formatTiyin(dashboard.monthExpense)}
            />
            <StatCard
              label={t('dashboard.monthProfit')}
              value={formatTiyin(dashboard.monthProfit)}
              emphasis={BigInt(dashboard.monthProfit) >= 0n ? 'success' : 'danger'}
            />
            <Link to="/alerts" className="block">
              <StatCard
                label={t('dashboard.alerts')}
                value={String(dashboard.unreadAlerts)}
                emphasis={dashboard.unreadAlerts > 0 ? 'danger' : undefined}
              />
            </Link>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 text-sm font-semibold">{t('dashboard.profitChart')}</h2>
              <ProfitChart series={dashboard.profitSeries} />
            </Card>
            <Card>
              <h2 className="mb-3 text-sm font-semibold">{t('dashboard.recentEvents')}</h2>
              {dashboard.recentEvents.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">{t('common.empty')}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {dashboard.recentEvents.map((event) => (
                    <li key={event.id} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{event.driverName ?? '—'}</span>
                        {' — '}
                        {t(`event.${event.eventType}`)}
                        {event.address ? `, ${event.address}` : ''}
                        {event.tripNumber ? (
                          <span className="text-muted"> · {event.tripNumber}</span>
                        ) : null}
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
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: 'success' | 'danger';
}) {
  return (
    <Card className="h-full">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={cn(
          'mt-1 text-xl font-bold tabular-nums',
          emphasis === 'success' && 'text-success',
          emphasis === 'danger' && 'text-danger',
        )}
      >
        {value}
      </div>
    </Card>
  );
}

/**
 * 12-month profit bars. Polarity is double-encoded: direction from the zero
 * baseline AND color, so it survives color-vision deficiency.
 */
function ProfitChart({ series }: { series: DashboardData['profitSeries'] }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);

  const W = 560;
  const H = 200;
  const PAD = { top: 12, right: 8, bottom: 22, left: 8 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = series.map((point) => Number(BigInt(point.profit) / 100n));
  const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v)));
  // Symmetric scale around zero keeps positive/negative bars comparable.
  const scale = plotH / (2 * maxAbs);
  const baseline = PAD.top + plotH / 2;
  const step = plotW / series.length;
  const barW = Math.max(6, step - 6);

  const hovered = hover != null ? series[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={t('dashboard.profitChart')}
      >
        {/* zero baseline — recessive */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={baseline}
          y2={baseline}
          className="stroke-gray-300 dark:stroke-white/20"
          strokeWidth={1}
        />
        {series.map((point, index) => {
          const value = values[index] ?? 0;
          const height = Math.abs(value) * scale;
          const x = PAD.left + index * step + (step - barW) / 2;
          const y = value >= 0 ? baseline - height : baseline;
          return (
            <g key={point.month}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(height, value === 0 ? 0 : 2)}
                rx={3}
                className={value >= 0 ? 'fill-success' : 'fill-danger'}
                opacity={hover == null || hover === index ? 1 : 0.45}
              />
              {/* hit target wider than the mark */}
              <rect
                x={PAD.left + index * step}
                y={PAD.top}
                width={step}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              />
              {index % 2 === 0 ? (
                <text
                  x={x + barW / 2}
                  y={H - 6}
                  textAnchor="middle"
                  className="fill-muted"
                  fontSize={9}
                >
                  {point.month.slice(2)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hovered && hover != null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-white/10 dark:bg-navy"
          style={{ left: `${Math.min((hover / series.length) * 100, 70)}%` }}
        >
          <div className="font-semibold">{hovered.month}</div>
          <div>
            {t('dashboard.income')}:{' '}
            <span className="tabular-nums">{formatTiyin(hovered.income)}</span>
          </div>
          <div>
            {t('dashboard.expense')}:{' '}
            <span className="tabular-nums">{formatTiyin(hovered.expense)}</span>
          </div>
          <div>
            {t('dashboard.profit')}:{' '}
            <span className="tabular-nums">{formatTiyin(hovered.profit)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
