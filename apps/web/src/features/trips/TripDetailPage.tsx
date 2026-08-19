import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { api } from '../../shared/api/client';
import {
  Badge,
  Button,
  Card,
  Cell,
  EmptyState,
  ErrorMessage,
  Field,
  IconLink,
  InfoItem,
  Input,
  Modal,
  ModalActions,
  PageHeader,
  Row,
  Select,
  Spinner,
  StatCard,
  Table,
  Tabs,
} from '../../shared/ui';
import { formatDate, formatDateTime } from '../../shared/utils/date';
import { formatTiyin, sumTiyin } from '../../shared/utils/money';
import { StatusBadge } from './StatusBadge';
import { useRefLists, useTrip, useTripFinance, useTripMutations } from './api';

type Tab = 'timeline' | 'finance' | 'documents';

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
        subtitle={`${trip.loadingAddress ?? '—'} → ${trip.unloadingAddress ?? '—'}`}
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
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 md:grid-cols-4">
          <InfoItem label={t('trips.status')}>
            <StatusBadge status={trip.status} />
          </InfoItem>
          <InfoItem label={t('trips.route')}>
            {trip.loadingAddress ?? '—'} → {trip.unloadingAddress ?? '—'}
          </InfoItem>
          <InfoItem label={t('trips.client')}>{trip.client?.name ?? '—'}</InfoItem>
          <InfoItem label={t('trips.cargoName')}>{trip.cargoName ?? '—'}</InfoItem>
          <InfoItem label={t('trips.vehicle')}>{trip.vehicle?.plateNumber ?? '—'}</InfoItem>
          <InfoItem label={t('trips.trailer')}>{trip.trailer?.plateNumber ?? '—'}</InfoItem>
          <InfoItem label={t('trips.driver')}>{trip.driver?.fullName ?? '—'}</InfoItem>
          <InfoItem label={t('trips.price')}>
            <span className="font-mono font-semibold tabular-nums">
              {formatTiyin(trip.agreedPrice)}
            </span>
          </InfoItem>
          <InfoItem label={t('trips.advance')}>{formatTiyin(trip.driverAdvance)}</InfoItem>
          <InfoItem label={t('trips.plannedKm')}>{trip.plannedDistanceKm ?? '—'}</InfoItem>
          <InfoItem label={t('trips.actualKm')}>{trip.actualDistanceKm ?? '—'}</InfoItem>
          <InfoItem label={t('trips.loadingDate')}>{formatDate(trip.loadingDate)}</InfoItem>
        </div>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        options={(['timeline', 'finance', 'documents'] as Tab[]).map((key) => ({
          value: key,
          label: t(`trips.tabs.${key}`),
        }))}
      />

      {tab === 'timeline' && <TimelineTab trip={trip} />}
      {tab === 'finance' && <FinanceTab tripId={trip.id} agreedPrice={trip.agreedPrice} />}
      {tab === 'documents' && <EmptyState description={t('trips.documentsNote')} />}

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
    <Button
      variant="secondary"
      icon={<IconLink size={16} />}
      onClick={() => share.mutate()}
      loading={share.isPending}
    >
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
        <ol className="space-y-4">
          {events!.map((event) => (
            <li key={event.id} className="relative flex gap-3 pl-1">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-primary" />
              <div className="min-w-0">
                <div className="text-subhead font-semibold">{t(`event.${event.eventType}`)}</div>
                <div className="font-mono text-caption tabular-nums text-ink-tertiary">
                  {formatDateTime(event.eventTime)}
                  {event.odometer != null && <> · {event.odometer} km</>}
                  {event.address && <> · {event.address}</>}
                </div>
                {event.comment && (
                  <div className="mt-1 text-footnote text-ink-secondary">{event.comment}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <>
          <ul className="space-y-2.5">
            {fallbackPoints.map((point, index) => (
              <li key={index} className="flex items-center gap-3 text-subhead">
                <span className="h-2 w-2 rounded-full bg-brand-primary" />
                <span className="w-32 shrink-0 text-ink-tertiary">{point.label}</span>
                <span className="font-mono tabular-nums">{formatDateTime(point.at)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-footnote text-ink-tertiary">{t('trips.timelineNote')}</p>
        </>
      )}
    </Card>
  );
}

function FinanceTab({ tripId, agreedPrice }: { tripId: string; agreedPrice: string }) {
  const { t } = useTranslation();
  const { expenses, incomes } = useTripFinance(tripId);
  if (expenses.isLoading || incomes.isLoading) return <Spinner />;

  const expenseTotal = sumTiyin((expenses.data ?? []).map((e) => e.amount));
  const incomeTotal = sumTiyin((incomes.data ?? []).map((i) => i.amount));
  const planned = BigInt(agreedPrice);
  const income = incomeTotal > 0n ? incomeTotal : planned;
  const balance = income - expenseTotal;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t('trips.financeIncome')} value={formatTiyin(income)} trend="up" />
        <StatCard
          label={t('trips.financeExpenses')}
          value={formatTiyin(expenseTotal)}
          trend="down"
        />
        <StatCard
          label={t('trips.financeBalance')}
          value={formatTiyin(balance)}
          tone="navy"
          trend={balance >= 0n ? 'up' : 'down'}
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
              <Cell className="text-ink-secondary">{formatDate(expense.expenseDate)}</Cell>
              <Cell>{t(`finance.categories.${expense.category}`)}</Cell>
              <Cell numeric>{formatTiyin(expense.amount)}</Cell>
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
        <ModalActions>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={action.isPending}>
            {t('common.save')}
          </Button>
        </ModalActions>
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
        <ModalActions>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={action.isPending}>
            {t('common.save')}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
