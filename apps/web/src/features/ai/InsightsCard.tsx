import { useTranslation } from 'react-i18next';
import {
  useInsights,
  useSetInsightStatus,
  type AiInsight,
  type AiInsightSeverity,
} from '../../shared/api/ai';
import { Badge, Card, EmptyState, ErrorMessage, Spinner } from '../../shared/ui';
import { formatDate } from '../../shared/utils/date';
import { formatTiyin } from '../../shared/utils/money';

const SEVERITY_TONE: Record<AiInsightSeverity, 'red' | 'orange' | 'blue' | 'gray'> = {
  CRITICAL: 'red',
  HIGH: 'red',
  MEDIUM: 'orange',
  LOW: 'gray',
};

/**
 * W-10 «AI topgan» — anomalies from the nightly scan (TZ §8.5).
 *
 * The text comes from the server already written in the company's language:
 * the numbers were computed by code, the sentence around them by AI, and
 * neither can be reconstructed from an i18n key. Everything the UI adds — the
 * labels, the buttons — goes through i18n as usual.
 */
export function InsightsCard() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useInsights();
  const setStatus = useSetInsightStatus();
  const insights = data ?? [];

  return (
    <Card>
      <div className="mb-3 text-sm font-semibold">{t('ai.insights.title')}</div>
      <ErrorMessage error={error ?? setStatus.error} />
      {isLoading ? (
        <Spinner />
      ) : insights.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {insights.map((insight) => (
            <InsightRow
              key={insight.id}
              insight={insight}
              busy={setStatus.isPending}
              onVerdict={(status) => setStatus.mutate({ id: insight.id, status })}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function InsightRow({
  insight,
  busy,
  onVerdict,
}: {
  insight: AiInsight;
  busy: boolean;
  onVerdict: (status: 'CONFIRMED' | 'FALSE_POSITIVE' | 'RESOLVED') => void;
}) {
  const { t } = useTranslation();

  return (
    <li className="border-b border-gray-200 pb-3 last:border-0 last:pb-0 dark:border-white/10">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge tone={SEVERITY_TONE[insight.severity]}>
          {t(`ai.insights.severity.${insight.severity}`)}
        </Badge>
        <span className="text-sm font-medium">{insight.title}</span>
        <span className="ml-auto text-xs text-muted">{formatDate(insight.createdAt)}</span>
      </div>

      <p className="mt-1 text-sm text-muted">{insight.description}</p>
      {insight.recommendation && (
        <p className="mt-1 text-sm">
          <span className="font-medium">{t('ai.insights.recommendation')}: </span>
          {insight.recommendation}
        </p>
      )}
      {insight.estimatedLoss && (
        <p className="mt-1 text-xs text-danger">
          {t('ai.insights.estimatedLoss')}: {formatTiyin(insight.estimatedLoss)} {t('common.som')}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium">
        {(['CONFIRMED', 'RESOLVED', 'FALSE_POSITIVE'] as const).map((status) => (
          <button
            key={status}
            disabled={busy}
            className="text-accent hover:underline disabled:opacity-50"
            onClick={() => onVerdict(status)}
          >
            {t(`ai.insights.verdict.${status}`)}
          </button>
        ))}
      </div>
    </li>
  );
}
