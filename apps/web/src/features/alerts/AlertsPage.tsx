import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertSeverity, type AlertView } from 'shared';
import {
  Badge,
  Card,
  EmptyState,
  ErrorMessage,
  IconAlert,
  IconArrowRight,
  PageHeader,
  SegmentedControl,
  Spinner,
  StatCard,
  type BadgeTone,
} from '../../shared/ui';
import { formatDate } from '../../shared/utils/date';
import { formatTiyin } from '../../shared/utils/money';
import { formatBp } from '../../shared/utils/units';
import { useAlerts } from './api';

const TONES: Record<AlertSeverity, BadgeTone> = {
  [AlertSeverity.CRITICAL]: 'red',
  [AlertSeverity.WARNING]: 'orange',
  [AlertSeverity.INFO]: 'blue',
};

type Filter = 'all' | AlertSeverity.CRITICAL | AlertSeverity.WARNING;

/** W-10 «Ogohlantirishlar markazi» — what needs attention, worst first. */
export function AlertsPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading, error } = useAlerts();

  const items = (data?.items ?? []).filter(
    (alert) => filter === 'all' || alert.severity === filter,
  );

  return (
    <div>
      <PageHeader
        title={t('alerts.title')}
        subtitle={t('alerts.subtitle')}
        actions={
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('common.all') },
              { value: AlertSeverity.CRITICAL, label: t('alerts.severity.CRITICAL') },
              { value: AlertSeverity.WARNING, label: t('alerts.severity.WARNING') },
            ]}
          />
        }
      />

      <ErrorMessage error={error} />

      {isLoading ? (
        <Spinner />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t('alerts.allClear')} description={t('alerts.allClearHint')} />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard
              label={t('alerts.severity.CRITICAL')}
              value={data.counts.CRITICAL}
              trend={data.counts.CRITICAL > 0 ? 'down' : 'up'}
              icon={data.counts.CRITICAL > 0 ? <IconAlert size={18} /> : undefined}
            />
            <StatCard label={t('alerts.severity.WARNING')} value={data.counts.WARNING} />
            <StatCard label={t('alerts.total')} value={data.counts.total} tone="navy" />
          </div>

          {items.length === 0 ? (
            <EmptyState description={t('alerts.noneInFilter')} />
          ) : (
            <ul className="space-y-2.5">
              {items.map((alert) => (
                <AlertRow key={alert.id} alert={alert} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Where the alert sends you — every alert must be actionable. */
function targetOf(alert: AlertView): string | null {
  switch (alert.entity.kind) {
    case 'vehicle':
      return '/vehicles';
    case 'driver':
      return '/drivers';
    case 'client':
      return '/clients';
    case 'trip':
      return `/trips/${alert.entity.id}`;
    default:
      return '/finance';
  }
}

function AlertRow({ alert }: { alert: AlertView }) {
  const { t } = useTranslation();

  // The API sends a code and its parameters; the sentence is built here, in
  // the reader's language (same contract as error codes).
  const message = t(`alerts.messages.${alert.type}`, {
    ...alert.params,
    amount: alert.params.amount ? formatTiyin(String(alert.params.amount)) : undefined,
    loss: alert.params.loss ? formatTiyin(String(alert.params.loss)) : undefined,
    diff: alert.params.diffBp ? formatBp(Number(alert.params.diffBp)) : undefined,
    docType: alert.params.docType
      ? t(`alerts.docTypes.${alert.params.docType}`, {
          defaultValue: String(alert.params.docType),
        })
      : undefined,
  });

  const target = targetOf(alert);

  return (
    <li>
      <Card className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Badge tone={TONES[alert.severity]} dot={alert.severity === AlertSeverity.CRITICAL}>
          {t(`alerts.severity.${alert.severity}`)}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="text-subhead font-semibold">{alert.subject}</div>
          <div className="text-subhead text-ink-secondary">{message}</div>
        </div>
        {alert.at ? (
          <div className="font-mono text-footnote tabular-nums text-ink-tertiary">
            {formatDate(alert.at)}
          </div>
        ) : null}
        {target ? (
          <Link
            to={target}
            className="inline-flex items-center gap-1 text-subhead font-medium text-brand-primary"
          >
            {t('alerts.open')}
            <IconArrowRight size={16} />
          </Link>
        ) : null}
      </Card>
    </li>
  );
}
