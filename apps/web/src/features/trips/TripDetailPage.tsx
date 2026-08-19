import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TripStatus } from 'shared';
import { api } from '../../shared/api/client';
import type { Trip } from '../../shared/api/entities';
import {
  Avatar,
  Button,
  Card,
  Cell,
  EmptyState,
  ErrorMessage,
  Field,
  Icon,
  Input,
  Modal,
  Row,
  Select,
  Spinner,
  StatusChip,
  Table,
  Tag,
  Textarea,
  initialsOf,
} from '../../shared/ui';
import { formatDate, formatDateTime } from '../../shared/utils/date';
import { formatTiyin, sumTiyin } from '../../shared/utils/money';
import { PAYMENT_STATUS_TONE, TRIP_STATUS_TONE } from '../../shared/utils/status';
import { tripLifecycle, type LifecycleStep } from './lifecycle';
import { useRefLists, useTrip, useTripFinance, useTripMutations } from './api';

type Tab = 'documents' | 'payments' | 'notes' | 'log';

const TABS: readonly Tab[] = ['documents', 'payments', 'notes', 'log'];

export function TripDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: trip, isLoading, error } = useTrip(id);
  const { action } = useTripMutations(id);
  const [tab, setTab] = useState<Tab>('documents');
  const [dialog, setDialog] = useState<'assign' | 'start' | 'complete' | 'cancel' | null>(null);

  if (isLoading) return <Spinner />;
  if (error || !trip) return <ErrorMessage error={error ?? new Error(t('common.errorGeneric'))} />;

  const canAssign = trip.status === TripStatus.DRAFT || trip.status === TripStatus.ASSIGNED;
  const canStart = trip.status === TripStatus.ASSIGNED;
  const canComplete = trip.status === TripStatus.IN_PROGRESS;
  const canCancel = canAssign;

  const remaining = BigInt(trip.agreedPrice) - BigInt(trip.driverAdvance);

  return (
    // On a phone the sections are re-ordered with `order-*` into the sequence a
    // driver or dispatcher reads on a small screen — header, status, the facts,
    // then the actions — while `md:` keeps the desktop layout byte-for-byte.
    <div className="flex flex-col md:block">
      <div className="order-1 mb-2.5 flex items-center gap-1.5 text-[12.5px] text-neutral-500">
        <Link to="/trips" className="-ml-1 inline-flex min-h-[44px] items-center px-1">
          {t('trips.title')}
        </Link>
        <Icon name="caret-right" size={10} />
        <span>{trip.tripNumber}</span>
      </div>

      <div className="order-2 mb-3 flex flex-wrap items-center gap-3 md:mb-[18px]">
        <h3 className="m-0 text-2xl tabular-nums">{trip.tripNumber}</h3>
        <StatusChip tone={TRIP_STATUS_TONE[trip.status]}>{t(`status.${trip.status}`)}</StatusChip>
        <div className="hidden flex-1 md:block" />
        <div className="hidden flex-wrap items-center gap-3 md:flex">
          <TripActions />
        </div>
      </div>

      <div className="order-3">
        <ErrorMessage error={action.error} />
      </div>

      {/* Phone: the actions sit under the facts, as its own stacked block. */}
      <div className="order-5 mb-3.5 grid grid-cols-1 gap-2 md:hidden">
        <TripActions />
      </div>

      <Card className="order-6 mb-3.5 overflow-hidden px-0 pb-3.5 pt-[18px] md:px-5">
        <Lifecycle steps={tripLifecycle(trip)} />
      </Card>

      <div className="order-4 mb-3.5 grid gap-3 lg:grid-cols-3">
        <Card className="px-4 py-3.5">
          <SectionLabel>{t('trips.cards.vehicleDriver')}</SectionLabel>
          <div className="mb-2.5 flex items-center gap-2.5">
            <Icon name="truck" size={18} style={{ color: 'var(--color-accent)' }} />
            <div>
              <div className="font-semibold">{trip.vehicle?.plateNumber ?? '—'}</div>
              <div className="text-xs text-neutral-500">
                {[trip.vehicle?.brand, trip.vehicle?.model, trip.vehicle?.year]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <Avatar initials={initialsOf(trip.driver?.fullName)} size={28} tone="accent" />
            <div>
              <div className="font-medium">{trip.driver?.fullName ?? '—'}</div>
              <div className="text-xs text-neutral-500">{trip.driver?.phone ?? '—'}</div>
            </div>
          </div>
        </Card>

        <Card className="px-4 py-3.5">
          <SectionLabel>{t('trips.cards.routeCargo')}</SectionLabel>
          <div className="mb-[5px] flex items-center gap-2 font-medium">
            {trip.loadingAddress ?? '—'}
            <Icon name="arrow-right" size={12} style={{ color: 'var(--color-accent)' }} />
            {trip.unloadingAddress ?? '—'}
          </div>
          <div className="mb-[9px] text-[12.5px] text-neutral-400">
            {trip.plannedDistanceKm
              ? t('trips.distance', { km: trip.plannedDistanceKm })
              : t('common.notSet')}
          </div>
          <div className="text-[13px]">
            {trip.cargoName ?? '—'}
            {trip.cargoWeight ? (
              <span className="text-neutral-400">
                {' '}
                · {trip.cargoWeight} {t('common.ton')}
              </span>
            ) : null}
          </div>
        </Card>

        <Card className="px-4 py-3.5">
          <SectionLabel>{t('trips.cards.clientFinance')}</SectionLabel>
          <div className="mb-0.5 font-medium">{trip.client?.name ?? '—'}</div>
          <div className="mb-[9px] text-xs text-neutral-500">{trip.client?.phone ?? '—'}</div>
          <MoneyRow label={t('trips.agreedPrice')} value={formatTiyin(trip.agreedPrice)} strong />
          <MoneyRow label={t('trips.advance')} value={formatTiyin(trip.driverAdvance)} />
          <div className="mt-1 flex justify-between border-t border-divider pt-[7px] text-[12.5px]">
            <span className="text-neutral-500">{t('trips.remaining')}</span>
            <b className="tabular-nums text-warning-text">
              {formatTiyin(remaining)} {t('common.som')}
            </b>
          </div>
        </Card>
      </div>

      {/* The four tabs scroll rather than shrink, so none drops below 44px. */}
      <div className="order-7 -mx-4 mb-3.5 flex overflow-x-auto border-b border-divider px-4 md:mx-0 md:overflow-visible md:px-0">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className="mr-5 min-h-[44px] shrink-0 cursor-pointer whitespace-nowrap px-0.5 text-[13px] md:min-h-0 md:py-2"
            style={{
              borderBottom: `2px solid ${tab === key ? 'var(--color-accent)' : 'transparent'}`,
              color: tab === key ? 'var(--color-text)' : 'var(--color-neutral-500)',
            }}
          >
            {t(`trips.tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className="order-8">
        {tab === 'documents' ? <DocumentsTab /> : null}
        {tab === 'payments' ? <PaymentsTab trip={trip} /> : null}
        {tab === 'notes' ? <NotesTab /> : null}
        {tab === 'log' ? <ActivityTab trip={trip} /> : null}
      </div>

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
      <CancelDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        tripNumber={trip.tripNumber}
        tripId={id}
        onCancelled={() => navigate('/trips')}
      />
    </div>
  );

  /** The same buttons in both places; only their container differs. */
  function TripActions() {
    return (
      <>
        {canAssign ? (
          <Button variant="secondary" icon="pencil-simple" onClick={() => setDialog('assign')}>
            {t('trips.assign')}
          </Button>
        ) : null}
        {canStart ? (
          <Button icon="play" onClick={() => setDialog('start')}>
            {t('trips.start')}
          </Button>
        ) : null}
        {canComplete ? (
          <Button icon="flag-checkered" onClick={() => setDialog('complete')}>
            {t('trips.complete')}
          </Button>
        ) : null}
        <ShareLinkButton tripId={id} />
        {canCancel ? (
          <Button variant="ghost" icon="x-circle" onClick={() => setDialog('cancel')}>
            <span className="text-danger-text">{t('trips.cancelTrip')}</span>
          </Button>
        ) : null}
      </>
    );
  }
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-[9px] text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-500">
      {children}
    </div>
  );
}

function MoneyRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-between py-[3px] text-[12.5px]">
      <span className="text-neutral-500">{label}</span>
      {strong ? (
        <b className="tabular-nums">
          {value} {t('common.som')}
        </b>
      ) : (
        <span className="tabular-nums">
          {value} {t('common.som')}
        </span>
      )}
    </div>
  );
}

/** The six-step lifecycle rail across the top of the detail screen. */
function Lifecycle({ steps }: { steps: LifecycleStep[] }) {
  const { t } = useTranslation();
  return (
    <div className="flex overflow-x-auto px-5 md:overflow-visible md:px-0">
      {steps.map((step, index) => (
        <div key={step.key} className="min-w-[96px] flex-1 md:min-w-0">
          <div className="flex w-full items-center">
            <span
              className="shrink-0 rounded-full"
              style={
                step.state === 'pending'
                  ? {
                      width: 10,
                      height: 10,
                      border: '2px solid var(--color-neutral-700)',
                      boxSizing: 'border-box',
                    }
                  : {
                      width: 12,
                      height: 12,
                      background: 'var(--color-accent)',
                      boxShadow:
                        step.state === 'current'
                          ? '0 0 0 4px color-mix(in srgb, var(--color-accent) 22%, transparent)'
                          : undefined,
                    }
              }
            />
            {index < steps.length - 1 ? (
              <span
                className="mx-2 h-0.5 flex-1"
                style={{
                  background:
                    step.state === 'done' ? 'var(--color-accent-700)' : 'var(--color-neutral-800)',
                }}
              />
            ) : null}
          </div>
          <div
            className="mt-2 text-[12.5px] font-medium"
            style={{
              color: step.state === 'pending' ? 'var(--color-neutral-500)' : 'var(--color-text)',
            }}
          >
            {t(`trips.lifecycle.${step.key}`)}
          </div>
          <div className="text-[11.5px] tabular-nums text-neutral-600">
            {step.at ? formatDateTime(step.at) : '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Tabs ----------

/**
 * Trip documents. The backend exposes upload and signed-URL endpoints but no
 * per-trip listing yet, so the tab carries the design's shell and its upload
 * action rather than inventing rows.
 */
function DocumentsTab() {
  const { t } = useTranslation();
  return (
    <Card className="px-0 py-1.5">
      <EmptyState message={t('trips.documentsEmpty')} />
      <div className="px-[18px] py-2.5">
        <Button variant="ghost" icon="plus" className="text-[12.5px]">
          {t('trips.uploadDocument')}
        </Button>
      </div>
    </Card>
  );
}

function PaymentsTab({ trip }: { trip: Trip }) {
  const { t } = useTranslation();
  const { incomes } = useTripFinance(trip.id);
  if (incomes.isLoading) return <Spinner />;

  const rows = incomes.data ?? [];
  const paid = sumTiyin(rows.map((income) => income.amount));
  const outstanding = BigInt(trip.agreedPrice) - paid;

  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <thead>
          <tr>
            <th className="pl-[18px]">{t('finance.date')}</th>
            <th>{t('finance.invoiceNumber')}</th>
            <th className="text-right">{t('finance.amountShort')}</th>
            <th className="pl-4">{t('finance.method')}</th>
            <th>{t('trips.status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((income) => (
            <Row key={income.id}>
              <Cell className="pl-[18px]">
                {formatDate(income.paymentDate ?? income.createdAt)}
              </Cell>
              <Cell>{income.invoiceNumber ?? '—'}</Cell>
              <Cell align="right">
                {formatTiyin(income.amount)} {t('common.som')}
              </Cell>
              <Cell className="pl-4">{income.paymentMethod ?? '—'}</Cell>
              <Cell>
                <StatusChip tone={PAYMENT_STATUS_TONE[income.status]}>
                  {t(`finance.paymentStatuses.${income.status}`)}
                </StatusChip>
              </Cell>
            </Row>
          ))}
          {outstanding > 0n ? (
            <Row>
              <Cell className="pl-[18px]">—</Cell>
              <Cell>{t('trips.remainingPayment')}</Cell>
              <Cell align="right">
                {formatTiyin(outstanding)} {t('common.som')}
              </Cell>
              <Cell className="pl-4">—</Cell>
              <Cell>
                <Tag variant="outline" className="text-[11px]">
                  {t('finance.paymentStatuses.PENDING')}
                </Tag>
              </Cell>
            </Row>
          ) : null}
        </tbody>
      </Table>
      {rows.length === 0 && outstanding <= 0n ? <EmptyState /> : null}
    </Card>
  );
}

/** Trip notes have no endpoint yet — the tab shows the design's empty shell. */
function NotesTab() {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col gap-3 px-[18px] py-4">
      <EmptyState message={t('trips.notesEmpty')} />
      <div className="flex gap-2">
        <Input placeholder={t('trips.addNote')} className="flex-1" disabled />
        <Button disabled>{t('common.send')}</Button>
      </div>
    </Card>
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

/** The driver's real button presses plus the trip's own lifecycle stamps. */
function ActivityTab({ trip }: { trip: Trip }) {
  const { t } = useTranslation();
  const { data: events, isLoading } = useQuery({
    queryKey: ['events', trip.id],
    queryFn: async () =>
      (await api<TripEventRow[]>('/events', { query: { tripId: trip.id } })).data,
  });
  const { expenses } = useTripFinance(trip.id);

  if (isLoading) return <Spinner />;

  const entries = [
    ...(events ?? []).map((event) => ({
      id: event.id,
      at: event.eventTime,
      title: t(`event.${event.eventType}`),
      detail: [event.odometer != null ? `${event.odometer} km` : null, event.address, event.comment]
        .filter(Boolean)
        .join(' · '),
      accent: true,
    })),
    ...(expenses.data ?? []).map((expense) => ({
      id: expense.id,
      at: expense.expenseDate,
      title: t('trips.log.expenseAdded', {
        category: t(`finance.categories.${expense.category}`),
        amount: formatTiyin(expense.amount),
      }),
      detail: expense.description ?? '',
      accent: false,
    })),
    {
      id: 'created',
      at: trip.createdAt,
      title: t('trips.log.created'),
      detail: '',
      accent: false,
    },
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <Card className="px-[18px] py-4">
      <div className="flex flex-col">
        {entries.map((entry, index) => (
          <div key={entry.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className="mt-1 h-2 w-2 rounded-full"
                style={{
                  background: entry.accent ? 'var(--color-accent)' : 'var(--color-neutral-600)',
                }}
              />
              {index < entries.length - 1 ? <span className="w-px flex-1 bg-neutral-800" /> : null}
            </div>
            <div className={index < entries.length - 1 ? 'pb-3.5' : ''}>
              <div className="text-[13px]">{entry.title}</div>
              <div className="text-[11.5px] text-neutral-600">
                {formatDateTime(entry.at)}
                {entry.detail ? ` · ${entry.detail}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- Actions ----------

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
      variant="ghost"
      icon={copied ? 'check' : 'copy'}
      onClick={() => share.mutate()}
      disabled={share.isPending}
    >
      {copied ? t('trips.linkCopied') : t('trips.shareLink')}
    </Button>
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
    <Modal
      title={t('trips.assign')}
      open={open}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={action.isPending || !vehicleId || !driverId}
            onClick={() =>
              void action
                .mutateAsync({
                  verb: 'assign',
                  body: { vehicleId, driverId, trailerId: trailerId || undefined },
                })
                .then(onClose)
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('trips.vehicle')}>
          <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
            <option value="">{t('common.select')}</option>
            {trucks.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plateNumber}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('trips.trailer')}>
          <Select value={trailerId} onChange={(e) => setTrailerId(e.target.value)}>
            <option value="">{t('common.select')}</option>
            {trailers.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plateNumber}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('trips.driver')}>
          <Select value={driverId} onChange={(e) => setDriverId(e.target.value)} required>
            <option value="">{t('common.select')}</option>
            {(drivers.data ?? [])
              .filter((driver) => driver.isActive)
              .map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.fullName}
                </option>
              ))}
          </Select>
        </Field>
        <ErrorMessage error={action.error} />
      </div>
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
    <Modal
      title={title}
      open={open}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={action.isPending}
            onClick={() =>
              void action
                .mutateAsync({ verb, body: value ? { [field]: Number(value) } : {} })
                .then(onClose)
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={label}>
        <Input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <ErrorMessage error={action.error} />
    </Modal>
  );
}

function CancelDialog({
  open,
  onClose,
  tripId,
  tripNumber,
  onCancelled,
}: {
  open: boolean;
  onClose: () => void;
  tripId: string;
  tripNumber: string;
  onCancelled: () => void;
}) {
  const { t } = useTranslation();
  const { action } = useTripMutations(tripId);
  const [reason, setReason] = useState('');

  return (
    <Modal
      title={t('trips.cancelTitle')}
      icon="warning-circle"
      open={open}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.back')}
          </Button>
          <Button
            variant="danger"
            disabled={action.isPending || reason.trim().length === 0}
            onClick={() =>
              void action
                .mutateAsync({ verb: 'cancel', body: { reason } })
                .then(onClose)
                .then(onCancelled)
            }
          >
            {t('trips.cancelTrip')}
          </Button>
        </>
      }
    >
      <div className="mb-3 text-[13.5px]">
        <b className="tabular-nums">{tripNumber}</b> — {t('trips.cancelWarning')}
      </div>
      <Field label={t('trips.cancelReason')}>
        <Textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('trips.cancelReasonPlaceholder')}
        />
      </Field>
      <ErrorMessage error={action.error} />
    </Modal>
  );
}
