import { useTranslation } from 'react-i18next';
import type { AiInsight } from 'shared';
import { Card } from '../../shared/ui';
import { useAiInsights } from './api';

/**
 * The insight strip on the dashboard.
 *
 * Every sentence is rendered from the backend's `kind` + `params` through this
 * app's i18n — the same contract as an error code. The backend therefore holds
 * no user-facing prose for these, and a new language needs one file changed
 * rather than two.
 *
 * It renders nothing at all when there is nothing to say or when the request
 * fails: the dashboard's own figures are the page, and an extra must never be
 * able to break it or to fill it with an apology.
 */
const ICONS: Record<AiInsight['kind'], string> = {
  REVENUE_UP: '📈',
  REVENUE_DOWN: '📉',
  PROFIT_UP: '💰',
  PROFIT_DOWN: '📉',
  LOSS_PERIOD: '⚠️',
  TOP_ROUTE: '🛣',
  LOSS_ROUTE: '⚠️',
  TOP_VEHICLE: '🚛',
  HIGH_EXPENSE_VEHICLE: '⚠️',
  FUEL_ANOMALY: '⛽',
  NO_DATA: 'ℹ️',
};

const TONES: Record<AiInsight['severity'], string> = {
  good: 'border-success/40 bg-success/5',
  warning: 'border-danger/40 bg-danger/5',
  info: 'border-gray-200 dark:border-white/10',
};

export function InsightsCard() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useAiInsights();

  if (isError) return null;
  const insights = (data ?? []).filter((insight) => insight.kind !== 'NO_DATA');
  if (!isLoading && insights.length === 0) return null;

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        🤖 {t('ai.insightsTitle')}
      </h2>
      {isLoading ? (
        <p className="text-sm text-muted">{t('ai.loading')}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {insights.map((insight, index) => (
            <li
              key={`${insight.kind}-${index}`}
              className={`flex gap-2 rounded-lg border p-3 text-sm ${TONES[insight.severity]}`}
            >
              <span aria-hidden="true">{ICONS[insight.kind]}</span>
              <span>{t(`ai.insights.${insight.kind}`, insight.params)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
