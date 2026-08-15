import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertType } from 'shared';
import { useExpiringDocuments, useServiceDue, type AlertRow } from '../../shared/api/analytics';
import { api } from '../../shared/api/client';
import {
  Badge,
  Button,
  Card,
  Cell,
  EmptyState,
  ErrorMessage,
  PageHeader,
  Pagination,
  Row,
  Spinner,
  Table,
} from '../../shared/ui';
import { formatDate, formatDateTime } from '../../shared/utils/date';

const TONES: Record<AlertType, 'red' | 'orange' | 'blue' | 'gray'> = {
  [AlertType.DOCUMENT_EXPIRING]: 'orange',
  [AlertType.MAINTENANCE_DUE]: 'blue',
  [AlertType.FUEL_OVERRUN]: 'red',
  [AlertType.VEHICLE_IDLE]: 'gray',
  [AlertType.ROUTE_DEVIATION]: 'orange',
  [AlertType.PAYMENT_OVERDUE]: 'red',
};

/**
 * Alerts are stored as an i18n key plus params, so the same row reads correctly
 * in every locale. Anything unparseable falls back to the raw text.
 */
export function parseAlertMessage(message: string): {
  key: string;
  params: Record<string, unknown>;
} {
  try {
    const parsed = JSON.parse(message) as { key?: string; params?: Record<string, unknown> };
    if (typeof parsed?.key === 'string') return { key: parsed.key, params: parsed.params ?? {} };
  } catch {
    // Not JSON — treat the whole message as the key.
  }
  return { key: message, params: {} };
}

function useAlerts(page: number, unreadOnly: boolean) {
  return useQuery({
    queryKey: ['alerts', { page, unreadOnly }],
    queryFn: () =>
      api<AlertRow[]>('/alerts', {
        query: { page, limit: 20, unreadOnly: unreadOnly ? 'true' : undefined },
      }),
    refetchInterval: 60_000,
  });
}

export function AlertsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const { data, isLoading, error } = useAlerts(page, unreadOnly);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['alerts'] });
  const markRead = useMutation({
    mutationFn: (id: string) => api(`/alerts/${id}/read`, { method: 'POST', body: {} }),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: () => api('/alerts/read-all', { method: 'POST', body: {} }),
    onSuccess: invalidate,
  });

  const alerts = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;
  const unread = (data?.meta?.unread as number | undefined) ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('alerts.title')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setUnreadOnly((value) => !value)}>
              {unreadOnly ? t('alerts.showAll') : t('alerts.showUnread')}
            </Button>
            <Button disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
              {t('alerts.markAllRead')}
            </Button>
          </>
        }
      />

      <ErrorMessage error={error ?? markRead.error ?? markAll.error} />
      {isLoading ? (
        <Spinner />
      ) : alerts.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Table
            headers={[t('alerts.type'), t('alerts.message'), t('alerts.date'), t('common.actions')]}
          >
            {alerts.map((alert) => {
              const message = parseAlertMessage(alert.message);
              return (
                <Row key={alert.id}>
                  <Cell>
                    <Badge tone={TONES[alert.type] ?? 'gray'}>
                      {t(`alerts.types.${alert.type}`)}
                    </Badge>
                  </Cell>
                  <Cell className={alert.isRead ? 'text-muted' : 'font-medium'}>
                    <div>{t(alert.title)}</div>
                    <div className="text-xs text-muted">{t(message.key, message.params)}</div>
                  </Cell>
                  <Cell className="whitespace-nowrap text-xs text-muted">
                    {formatDateTime(alert.createdAt)}
                  </Cell>
                  <Cell>
                    {!alert.isRead && (
                      <button
                        className="text-xs font-medium text-accent hover:underline"
                        onClick={() => markRead.mutate(alert.id)}
                      >
                        {t('alerts.markRead')}
                      </button>
                    )}
                  </Cell>
                </Row>
              );
            })}
          </Table>
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ExpiringDocumentsCard />
        <ServiceDueCard />
      </div>
    </div>
  );
}

function ExpiringDocumentsCard() {
  const { t } = useTranslation();
  const { data, isLoading } = useExpiringDocuments();
  const rows = data ?? [];

  return (
    <Card>
      <div className="mb-3 text-sm font-semibold">{t('alerts.expiringDocuments')}</div>
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex items-baseline justify-between gap-3">
              <span>
                <span className="font-medium">{row.ownerLabel ?? '—'}</span>{' '}
                <span className="text-muted">
                  {t(`documents.types.${row.docType}`, row.docType)}
                </span>
              </span>
              <span
                className={
                  row.daysLeft < 0 ? 'shrink-0 text-xs text-danger' : 'shrink-0 text-xs text-muted'
                }
              >
                {formatDate(row.expiryDate)} ·{' '}
                {row.daysLeft < 0
                  ? t('alerts.expired')
                  : t('alerts.daysLeft', { count: row.daysLeft })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ServiceDueCard() {
  const { t } = useTranslation();
  const { data, isLoading } = useServiceDue();
  const rows = data ?? [];

  return (
    <Card>
      <div className="mb-3 text-sm font-semibold">{t('alerts.serviceDueList')}</div>
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((row) => (
            <li key={row.vehicleId} className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{row.plateNumber}</span>
              <span className={row.isOverdue ? 'text-xs text-danger' : 'text-xs text-muted'}>
                {row.isOverdue
                  ? t('alerts.serviceOverdueBy', { km: Math.abs(row.kmLeft) })
                  : t('alerts.serviceInKm', { km: row.kmLeft })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
