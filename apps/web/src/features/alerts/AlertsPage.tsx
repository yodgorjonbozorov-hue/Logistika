import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api/client';
import type { Alert } from '../../shared/api/entities';
import {
  Badge,
  Button,
  EmptyState,
  ErrorMessage,
  PageHeader,
  Pagination,
  Spinner,
} from '../../shared/ui';
import { formatDateTime } from '../../shared/utils/date';
import { formatTiyin } from '../../shared/utils/money';
import { cn } from '../../shared/utils/cn';

const TYPE_TONES: Record<string, 'red' | 'orange' | 'blue'> = {
  FUEL_DEVIATION: 'red',
  PAYMENT_OVERDUE: 'red',
  DOC_EXPIRY: 'orange',
  MAINTENANCE_DUE: 'orange',
  VEHICLE_STOPPED: 'orange',
  ROUTE_DEVIATION: 'red',
};

/** The backend stores the type + JSON params; the text is rendered here via i18n. */
function alertText(t: (key: string, params?: Record<string, unknown>) => string, alert: Alert) {
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(alert.message) as Record<string, unknown>;
  } catch {
    // Legacy/foreign payload — fall back to the raw message.
    return alert.message;
  }
  if (typeof params.amount === 'string') params.amount = formatTiyin(params.amount);
  return t(`alerts.types.${alert.type}`, params);
}

export function AlertsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ['alerts', { page, unreadOnly }],
    queryFn: () =>
      api<Alert[]>('/alerts', {
        query: { page, limit: 20, unread: unreadOnly ? 'true' : undefined },
      }),
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['alerts'] });
  const ack = useMutation({
    mutationFn: (id: string) => api(`/alerts/${id}/ack`, { method: 'POST', body: {} }),
    onSuccess: invalidate,
  });
  const ackAll = useMutation({
    mutationFn: () => api('/alerts/ack-all', { method: 'POST', body: {} }),
    onSuccess: invalidate,
  });

  const alerts = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;

  return (
    <div>
      <PageHeader
        title={t('alerts.title')}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => {
                  setPage(1);
                  setUnreadOnly(e.target.checked);
                }}
              />
              {t('alerts.unreadOnly')}
            </label>
            <Button variant="secondary" onClick={() => void ackAll.mutateAsync()}>
              {t('alerts.ackAll')}
            </Button>
          </>
        }
      />
      <ErrorMessage error={error ?? ack.error ?? ackAll.error} />
      {isLoading ? (
        <Spinner />
      ) : alerts.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ul className="space-y-2">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-white/5',
                  alert.isRead && 'opacity-60',
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Badge tone={TYPE_TONES[alert.type] ?? 'blue'}>
                    {t(`alerts.typeNames.${alert.type}`)}
                  </Badge>
                  <span className="min-w-0 truncate">{alertText(t, alert)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted">{formatDateTime(alert.createdAt)}</span>
                  {!alert.isRead && (
                    <button
                      className="text-xs font-medium text-accent hover:underline"
                      onClick={() => void ack.mutateAsync(alert.id)}
                    >
                      {t('alerts.ack')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
