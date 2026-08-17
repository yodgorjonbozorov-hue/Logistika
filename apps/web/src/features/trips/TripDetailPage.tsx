import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useTripPnl } from '../../shared/api/analytics';
import { api } from '../../shared/api/client';
import {
  Badge,
  Button,
  Card,
  Cell,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  Row,
  Select,
  Spinner,
  Table,
} from '../../shared/ui';
import { StatCard } from '../../shared/ui/stats';
import { formatDate, formatDateTime } from '../../shared/utils/date';
import { formatBp } from '../../shared/utils/format';
import { formatTiyin } from '../../shared/utils/money';
import { ChatTab } from '../chat/ChatTab';
import { StatusBadge } from './StatusBadge';
import { useRefLists, useTrip, useTripFinance, useTripMutations } from './api';

type Tab = 'timeline' | 'finance' | 'documents' | 'chat';

export function TripDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { data: trip, isLoading, error } = useTrip(id);
  const { action } = useTripMutations(id);
  const [tab, setTab] = useState<Tab>('timeline');
  const [dialog, setDialog] = useState<'assign' | 'start' | 'complete' | null>(null);

  if (isLoading) return <Spinner />;
  if (error || !trip) return <ErrorMessage error={error ?? new Error()} />;

  const canAssign = trip.status === 'DRAFT' || trip.status === 'ASSIGNED';
  const canStart = trip.status === 'ASSIGNED';
  const canComplete = trip.status === 'IN_PROGRESS';
  const canCancel = trip.status === 'DRAFT' || trip.status === 'ASSIGNED';

  return (
    <div>
      <PageHeader
        title={`${t('trips.title')} №${trip.tripNumber}`}
        actions={
          <>
            <ShareLinkButton tripId={id} />
            {canAssign && (
              <Button variant="secondary" onClick={() => setDialog('assign')}>
                {t('trips.assign')}
              </Button>
            )}
            {canStart && <Button onClick={() => setDialog('start')}>{t('trips.start')}</Button>}
            {canComplete && (
              <Button onClick={() => setDialog('complete')}>{t('trips.complete')}</Button>
            )}
            {canCancel && (
              <Button variant="danger" onClick={() => void action.mutateAsync({ verb: 'cancel' })}>
                {t('trips.cancelTrip')}
              </Button>
            )}
          </>
        }
      />
      <ErrorMessage error={action.error} />

      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <Info label={t('trips.status')}>
            <StatusBadge status={trip.status} />
          </Info>
          <Info label={t('trips.route')}>
            {trip.loadingAddress ?? '—'} → {trip.unloadingAddress ?? '—'}
          </Info>
          <Info label={t('trips.client')}>{trip.client?.name ?? '—'}</Info>
          <Info label={t('trips.cargoName')}>{trip.cargoName ?? '—'}</Info>
          <Info label={t('trips.vehicle')}>{trip.vehicle?.plateNumber ?? '—'}</Info>
          <Info label={t('trips.trailer')}>{trip.trailer?.plateNumber ?? '—'}</Info>
          <Info label={t('trips.driver')}>{trip.driver?.fullName ?? '—'}</Info>
          <Info label={t('trips.price')}>
            <span className="font-semibold tabular-nums">{formatTiyin(trip.agreedPrice)}</span>
          </Info>
          <Info label={t('trips.advance')}>{formatTiyin(trip.driverAdvance)}</Info>
          <Info label={t('trips.plannedKm')}>{trip.plannedDistanceKm ?? '—'}</Info>
          <Info label={t('trips.actualKm')}>{trip.actualDistanceKm ?? '—'}</Info>
          <Info label={t('trips.loadingDate')}>{formatDate(trip.loadingDate)}</Info>
        </div>
      </Card>

      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-white/10">
        {(['timeline', 'finance', 'documents', 'chat'] as Tab[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? 'shrink-0 border-b-2 border-accent px-4 py-2 text-sm font-semibold text-accent'
                : 'shrink-0 px-4 py-2 text-sm text-muted hover:text-gray-700 dark:hover:text-gray-200'
            }
          >
            {t(`trips.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'timeline' && <TimelineTab trip={trip} />}
      {tab === 'finance' && <FinanceTab tripId={trip.id} />}
      {tab === 'chat' && <ChatTab tripId={trip.id} />}
      {tab === 'documents' && (
        <Card>
          <p className="text-sm text-muted">{t('trips.documentsNote')}</p>
        </Card>
      )}

      <AssignDialog open={dialog === 'assign'} onClose={() => setDialog(null)} tripId={id} />
      <OdometerDialog
        open={dialog === 'start'}
        onClose={() => setDialog(null)}
        tripId={id}
        verb="start"
        field="startOdometer"
        title={t('trips.start')}
        label={t('trips.startOdometer')}
      />
      <OdometerDialog
        open={dialog === 'complete'}
        onClose={() => setDialog(null)}
        tripId={id}
        verb="complete"
        field="endOdometer"
        title={t('trips.complete')}
        label={t('trips.endOdometer')}
      />
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function ShareLinkButton({ tripId }: { tripId: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const share = useMutation({
    mutationFn: async () =>
      (await api<{ url: string }>(`/trips/${tripId}/share-link`, { method: 'POST', body: {} }))
        .data,
    onSuccess: async ({ url }) => {
      await navigator.clipboard.writeText(url).catch(() => undefined);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    },
  });
  return (
    <Button variant="secondary" onClick={() => share.mutate()} disabled={share.isPending}>
      {copied ? t('trips.linkCopied') : t('trips.shareLink')}
    </Button>
  );
}

interface TripEventRow {
  id: string;
  eventType: string;
  eventTime: string;
  address: string | null;
  odometer: number | null;
  comment: string | null;
}

/** W-4 tab 1: the driver's real button presses, time + place + notes. */
function TimelineTab({ trip }: { trip: import('../../shared/api/entities').Trip }) {
  const { t } = useTranslation();
  const { data: events, isLoading } = useQuery({
    queryKey: ['events', trip.id],
    queryFn: async () =>
      (await api<TripEventRow[]>('/events', { query: { tripId: trip.id } })).data,
  });

  if (isLoading) return <Spinner />;

  const fallbackPoints = [
    { label: t('trips.createdAt'), at: trip.createdAt },
    { label: t('trips.startedAt'), at: trip.startedAt },
    { label: t('trips.finishedAt'), at: trip.finishedAt },
  ].filter((p) => p.at);

  return (
    <Card>
      {(events ?? []).length > 0 ? (
        <ul className="space-y-3 text-sm">
          {events!.map((event) => (
            <li key={event.id} className="flex items-start gap-3">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
              <div>
                <div className="font-semibold">{t(`event.${event.eventType}`)}</div>
                <div className="text-xs text-muted">
                  {formatDateTime(event.eventTime)}
                  {event.odometer != null && <> · {event.odometer} km</>}
                  {event.address && <> · {event.address}</>}
                </div>
                {event.comment && <div className="mt-0.5 text-xs">{event.comment}</div>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <ul className="space-y-2 text-sm">
            {fallbackPoints.map((point, index) => (
              <li key={index} className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-accent" />
                <span className="w-32 text-muted">{point.label}</span>
                <span>{formatDateTime(point.at)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">{t('trips.timelineNote')}</p>
        </>
      )}
    </Card>
  );
}

/**
 * W-4 finance tab. The numbers come from the backend P&L (TZ §6) — including the
 * driver share and the depreciation the raw expense list cannot know about.
 */
function FinanceTab({ tripId }: { tripId: string }) {
  const { t } = useTranslation();
  const { expenses } = useTripFinance(tripId);
  const { data: pnl, isLoading, error } = useTripPnl(tripId);

  if (isLoading || expenses.isLoading) return <Spinner />;
  if (error || !pnl) return <ErrorMessage error={error ?? new Error()} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label={t('trips.financeIncome')} value={formatTiyin(pnl.income)} tone="success" />
        <StatCard
          label={t('trips.financeExpenses')}
          value={formatTiyin(pnl.expensesTotal)}
          tone="danger"
        />
        <StatCard label={t('finance.driverShare')} value={formatTiyin(pnl.driverShare)} />
        <StatCard label={t('finance.depreciation')} value={formatTiyin(pnl.depreciation)} />
        <StatCard
          label={t('trips.financeBalance')}
          value={formatTiyin(pnl.profit)}
          tone={BigInt(pnl.profit) >= 0n ? 'success' : 'danger'}
          hint={`${t('finance.margin')} ${formatBp(pnl.marginBp)}${
            pnl.profitPerKm ? ` · ${formatTiyin(pnl.profitPerKm)}/km` : ''
          }`}
        />
      </div>
      {(expenses.data ?? []).length === 0 ? (
        <EmptyState />
      ) : (
        <Table
          headers={[
            t('finance.date'),
            t('finance.category'),
            t('finance.amount'),
            t('finance.description'),
            '',
          ]}
        >
          {(expenses.data ?? []).map((expense) => (
            <Row key={expense.id}>
              <Cell>{formatDate(expense.expenseDate)}</Cell>
              <Cell>{t(`finance.categories.${expense.category}`)}</Cell>
              <Cell className="tabular-nums">{formatTiyin(expense.amount)}</Cell>
              <Cell>{expense.description ?? '—'}</Cell>
              <Cell>
                <Badge tone={expense.isApproved ? 'green' : 'gray'}>
                  {expense.isApproved ? t('finance.approved') : t('finance.notApproved')}
                </Badge>
              </Cell>
            </Row>
          ))}
        </Table>
      )}
    </div>
  );
}

function AssignDialog({
  open,
  onClose,
  tripId,
}: {
  open: boolean;
  onClose: () => void;
  tripId: string;
}) {
  const { t } = useTranslation();
  const { vehicles, drivers } = useRefLists();
  const { action } = useTripMutations(tripId);
  const [vehicleId, setVehicleId] = useState('');
  const [trailerId, setTrailerId] = useState('');
  const [driverId, setDriverId] = useState('');

  const trucks = (vehicles.data ?? []).filter((v) => v.type !== 'TRAILER' && v.isActive);
  const trailers = (vehicles.data ?? []).filter((v) => v.type === 'TRAILER' && v.isActive);

  return (
    <Modal title={t('trips.assign')} open={open} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action
            .mutateAsync({
              verb: 'assign',
              body: { vehicleId, driverId, trailerId: trailerId || undefined },
            })
            .then(onClose);
        }}
        className="space-y-3"
      >
        <Field label={t('trips.vehicle')}>
          <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
            <option value="">{t('common.select')}</option>
            {trucks.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plateNumber}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('trips.trailer')}>
          <Select value={trailerId} onChange={(e) => setTrailerId(e.target.value)}>
            <option value="">{t('common.select')}</option>
            {trailers.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plateNumber}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('trips.driver')}>
          <Select value={driverId} onChange={(e) => setDriverId(e.target.value)} required>
            <option value="">{t('common.select')}</option>
            {(drivers.data ?? [])
              .filter((d) => d.isActive)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
          </Select>
        </Field>
        <ErrorMessage error={action.error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={action.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function OdometerDialog({
  open,
  onClose,
  tripId,
  verb,
  field,
  title,
  label,
}: {
  open: boolean;
  onClose: () => void;
  tripId: string;
  verb: 'start' | 'complete';
  field: 'startOdometer' | 'endOdometer';
  title: string;
  label: string;
}) {
  const { t } = useTranslation();
  const { action } = useTripMutations(tripId);
  const [value, setValue] = useState('');

  return (
    <Modal title={title} open={open} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action
            .mutateAsync({ verb, body: value ? { [field]: Number(value) } : {} })
            .then(onClose);
        }}
        className="space-y-3"
      >
        <Field label={label}>
          <Input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <ErrorMessage error={action.error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={action.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
