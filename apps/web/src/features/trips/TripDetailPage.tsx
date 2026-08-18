import { useMutation } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { TripEventType } from 'shared';
import { api } from '../../shared/api/client';
import type { Trip } from '../../shared/api/entities';
import { useAuth } from '../../shared/auth/AuthContext';
import { can } from '../../shared/auth/permissions';
import {
  Badge,
  Button,
  Card,
  ComingSoon,
  DataTable,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  SectionTitle,
  Select,
  Skeleton,
  Tabs,
  type Column,
} from '../../shared/ui';
import { Icon } from '../../shared/ui/icons';
import { formatDate, formatDateTime } from '../../shared/utils/date';
import { formatTiyin, sumTiyin } from '../../shared/utils/money';
import { TrackMap } from '../map/TrackMap';
import { StatusBadge } from './StatusBadge';
import {
  useRefLists,
  useTrip,
  useTripEvents,
  useTripFinance,
  useTripMutations,
  useTripTrack,
} from './api';
import type { Expense } from '../../shared/api/entities';

type Tab = 'timeline' | 'finance' | 'gps' | 'documents';

/** Lifecycle checkpoints shown even before the driver has pressed anything. */
const TIMELINE_STAGES: TripEventType[] = [
  TripEventType.START,
  TripEventType.LOADED,
  TripEventType.RESUME,
  TripEventType.DELIVERED,
  TripEventType.FINISH,
];

export function TripDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { created?: string } };
  const { role } = useAuth();
  const { data: trip, isLoading, error } = useTrip(id);
  const { action } = useTripMutations(id);
  const [tab, setTab] = useState<Tab>('timeline');
  const [dialog, setDialog] = useState<'assign' | 'start' | 'complete' | null>(null);

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !trip) return <ErrorMessage error={error ?? new Error(t('common.errorGeneric'))} />;

  const editable = can(role, 'editTrip');
  const canAssign = editable && (trip.status === 'DRAFT' || trip.status === 'ASSIGNED');
  const canStart = editable && trip.status === 'ASSIGNED';
  const canComplete = editable && trip.status === 'IN_PROGRESS';
  const canCancel = editable && (trip.status === 'DRAFT' || trip.status === 'ASSIGNED');

  return (
    <div>
      {location.state?.created ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          <Icon name="check" className="h-4 w-4" />
          {t('trips.created')} — <span className="font-semibold">{location.state.created}</span>
        </div>
      ) : null}

      <PageHeader
        title={trip.tripNumber}
        subtitle={`${trip.loadingAddress ?? '—'} → ${trip.unloadingAddress ?? '—'}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/trips')}>
              <Icon name="chevronLeft" className="h-4 w-4" />
              {t('common.back')}
            </Button>
            {can(role, 'shareTripLink') ? <ShareLinkButton tripId={id} /> : null}
            {canAssign && (
              <Button variant="secondary" onClick={() => setDialog('assign')}>
                {t('trips.assign')}
              </Button>
            )}
            {canStart && (
              <Button onClick={() => setDialog('start')}>
                <Icon name="play" className="h-4 w-4" />
                {t('trips.start')}
              </Button>
            )}
            {canComplete && (
              <Button onClick={() => setDialog('complete')}>
                <Icon name="check" className="h-4 w-4" />
                {t('trips.complete')}
              </Button>
            )}
            {canCancel && (
              <Button
                variant="danger"
                onClick={() => {
                  if (window.confirm(t('common.confirmDeactivate'))) {
                    void action.mutateAsync({ verb: 'cancel' });
                  }
                }}
              >
                {t('trips.cancelTrip')}
              </Button>
            )}
          </>
        }
      />

      <ErrorMessage error={action.error} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={trip.status} />
            <Badge tone="gray">{trip.currency}</Badge>
            <span className="text-xs text-ink-2">
              {t('trips.createdAt')}: {formatDateTime(trip.createdAt)}
            </span>
          </div>
          <RouteStrip trip={trip} />
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <Info label={t('trips.client')}>{trip.client?.name ?? '—'}</Info>
            <Info label={t('trips.cargoName')}>{trip.cargoName ?? '—'}</Info>
            <Info label={t('trips.cargoWeight')}>{trip.cargoWeight ?? '—'}</Info>
            <Info label={t('trips.plannedKm')}>{trip.plannedDistanceKm ?? '—'}</Info>
            <Info label={t('trips.actualKm')}>{trip.actualDistanceKm ?? '—'}</Info>
            <Info label={t('trips.startedAt')}>{formatDateTime(trip.startedAt)}</Info>
            <Info label={t('trips.finishedAt')}>{formatDateTime(trip.finishedAt)}</Info>
            <Info label={t('trips.trailer')}>{trip.trailer?.plateNumber ?? '—'}</Info>
          </div>
          {trip.notes ? (
            <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <div className="text-xs uppercase text-ink-2">{t('trips.comment')}</div>
              <p className="mt-0.5 whitespace-pre-line">{trip.notes}</p>
            </div>
          ) : null}
        </Card>

        <div className="space-y-4">
          <Card>
            <SectionTitle>{t('trips.driverCard')}</SectionTitle>
            {trip.driver ? (
              <Link
                to={`/drivers/${trip.driver.id}`}
                className="flex items-center gap-3 rounded-lg p-1 hover:bg-surface-2"
              >
                <span className="grid h-10 w-10 place-items-center rounded-full bg-accent/20 font-bold text-accent">
                  {trip.driver.fullName.charAt(0)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{trip.driver.fullName}</span>
                  <span className="block truncate text-xs text-ink-2">
                    {trip.driver.phone ?? '—'}
                  </span>
                </span>
              </Link>
            ) : (
              <p className="text-sm text-ink-2">{t('common.notSet')}</p>
            )}
          </Card>

          <Card>
            <SectionTitle>{t('trips.vehicleCard')}</SectionTitle>
            {trip.vehicle ? (
              <Link
                to={`/vehicles/${trip.vehicle.id}`}
                className="flex items-center gap-3 rounded-lg p-1 hover:bg-surface-2"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-ink-2">
                  <Icon name="vehicles" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{trip.vehicle.plateNumber}</span>
                  <span className="block truncate text-xs text-ink-2">
                    {[trip.vehicle.brand, trip.vehicle.model].filter(Boolean).join(' ') || '—'}
                  </span>
                </span>
              </Link>
            ) : (
              <p className="text-sm text-ink-2">{t('common.notSet')}</p>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-6">
        <Tabs<Tab>
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'timeline', label: t('trips.tabs.timeline') },
            { key: 'finance', label: t('trips.tabs.finance') },
            { key: 'gps', label: t('trips.tabs.gps') },
            { key: 'documents', label: t('trips.tabs.documents') },
          ]}
        />

        {tab === 'timeline' && <TimelineTab trip={trip} />}
        {tab === 'finance' && <FinanceTab trip={trip} />}
        {tab === 'gps' && <GpsTab trip={trip} />}
        {tab === 'documents' && <ComingSoon note={t('trips.documentsNote')} />}
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
    </div>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-ink-2">{label}</div>
      <div className="mt-0.5 truncate">{children}</div>
    </div>
  );
}

function RouteStrip({ trip }: { trip: Trip }) {
  const { t } = useTranslation();
  const stops = [
    { label: trip.loadingAddress, date: trip.loadingDate },
    { label: trip.unloadingAddress, date: trip.unloadingDate },
  ].filter((stop) => stop.label);

  if (stops.length === 0) return null;

  return (
    <ol className="space-y-0">
      {stops.map((stop, index) => (
        <li key={index} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={
                index === 0
                  ? 'mt-1 h-3 w-3 rounded-full border-2 border-accent bg-surface'
                  : 'mt-1 h-3 w-3 rounded-full bg-accent'
              }
            />
            {index < stops.length - 1 && <span className="my-0.5 w-px flex-1 bg-line" />}
          </div>
          <div className={index < stops.length - 1 ? 'pb-4' : ''}>
            <div className="font-medium">{stop.label}</div>
            <div className="text-xs text-ink-2">
              {index === 0 ? t('trips.loadingDate') : t('trips.unloadingDate')}:{' '}
              {formatDate(stop.date)}
            </div>
          </div>
        </li>
      ))}
    </ol>
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

/** W-4 tab 1: the driver's real button presses, time + place + notes. */
function TimelineTab({ trip }: { trip: Trip }) {
  const { t } = useTranslation();
  const { data: events, isLoading } = useTripEvents(trip.id);

  if (isLoading) return <Skeleton className="h-40" />;

  const rows = events ?? [];
  const done = new Set(rows.map((event) => event.eventType));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        {rows.length > 0 ? (
          <ul className="space-y-3 text-sm">
            {rows.map((event) => (
              <li key={event.id} className="flex items-start gap-3">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
                <div className="min-w-0">
                  <div className="font-semibold">{t(`event.${event.eventType}`)}</div>
                  <div className="text-xs text-ink-2">
                    {formatDateTime(event.eventTime)}
                    {event.odometer != null && <> · {event.odometer} km</>}
                    {event.address && <> · {event.address}</>}
                    {event.lat != null && event.lng != null && (
                      <>
                        {' '}
                        · {event.lat.toFixed(3)}, {event.lng.toFixed(3)}
                      </>
                    )}
                  </div>
                  {event.comment && <div className="mt-0.5 text-xs">{event.comment}</div>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState hint={t('trips.timelineNote')} />
        )}
      </Card>

      <Card>
        <SectionTitle>{t('trips.tabs.timeline')}</SectionTitle>
        <ol className="space-y-2 text-sm">
          {TIMELINE_STAGES.map((stage) => (
            <li key={stage} className="flex items-center gap-2">
              <span
                className={
                  done.has(stage)
                    ? 'grid h-5 w-5 place-items-center rounded-full bg-success text-white'
                    : 'grid h-5 w-5 place-items-center rounded-full border border-line text-ink-2'
                }
              >
                {done.has(stage) ? <Icon name="check" className="h-3 w-3" strokeWidth={3} /> : null}
              </span>
              <span className={done.has(stage) ? 'font-medium' : 'text-ink-2'}>
                {t(`event.${stage}`)}
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function FinanceTab({ trip }: { trip: Trip }) {
  const { t } = useTranslation();
  const { expenses, incomes } = useTripFinance(trip.id);
  if (expenses.isLoading || incomes.isLoading) return <Skeleton className="h-40" />;

  const expenseTotal = sumTiyin((expenses.data ?? []).map((expense) => expense.amount));
  const incomeTotal = sumTiyin((incomes.data ?? []).map((income) => income.amount));
  const agreed = BigInt(trip.agreedPrice);
  // Only actual rows are summed; the agreed price is shown separately, never as income.
  const net = incomeTotal - expenseTotal;

  const columns: Array<Column<Expense>> = [
    {
      key: 'date',
      header: t('finance.date'),
      primary: true,
      cell: (expense) => formatDate(expense.expenseDate),
    },
    {
      key: 'approved',
      header: t('finance.paymentStatus'),
      secondary: true,
      cell: (expense) => (
        <Badge tone={expense.isApproved ? 'green' : 'gray'}>
          {expense.isApproved ? t('finance.approved') : t('finance.notApproved')}
        </Badge>
      ),
    },
    {
      key: 'category',
      header: t('finance.category'),
      cell: (expense) => t(`finance.categories.${expense.category}`),
    },
    {
      key: 'amount',
      header: t('finance.amount'),
      className: 'money',
      cell: (expense) => formatTiyin(expense.amount),
    },
    {
      key: 'description',
      header: t('finance.description'),
      cell: (expense) => expense.description ?? '—',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card>
          <div className="text-xs uppercase text-ink-2">{t('trips.financeAgreed')}</div>
          <div className="mt-1 text-lg font-bold money">{formatTiyin(agreed)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-ink-2">{t('trips.financeAdvance')}</div>
          <div className="mt-1 text-lg font-bold money">{formatTiyin(trip.driverAdvance)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-ink-2">{t('trips.financeIncome')}</div>
          <div className="mt-1 text-lg font-bold text-success money">
            {formatTiyin(incomeTotal)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-ink-2">{t('trips.financeExpenses')}</div>
          <div className="mt-1 text-lg font-bold text-danger money">
            {formatTiyin(expenseTotal)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-ink-2">{t('trips.financeBalance')}</div>
          <div
            className={
              net >= 0n
                ? 'mt-1 text-lg font-bold text-success money'
                : 'mt-1 text-lg font-bold text-danger money'
            }
          >
            {formatTiyin(net)}
          </div>
        </Card>
      </div>

      <p className="text-xs text-ink-2">{t('trips.financeNote')}</p>

      <DataTable
        rows={expenses.data ?? []}
        columns={columns}
        getKey={(expense) => expense.id}
        empty={<EmptyState />}
      />
    </div>
  );
}

function GpsTab({ trip }: { trip: Trip }) {
  const { t } = useTranslation();
  const { data: points, isLoading } = useTripTrack(trip);

  if (!trip.vehicleId) return <EmptyState hint={t('trips.noGps')} />;
  if (isLoading) return <Skeleton className="h-80" />;
  if ((points ?? []).length === 0) return <EmptyState hint={t('trips.noGps')} />;

  return (
    <div className="space-y-2">
      <TrackMap points={points ?? []} />
      <p className="text-xs text-ink-2">
        {t('trips.gpsPoints')}: {(points ?? []).length}
      </p>
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
        onSubmit={(event) => {
          event.preventDefault();
          void action
            .mutateAsync({
              verb: 'assign',
              body: { vehicleId, driverId, trailerId: trailerId || undefined },
            })
            .then(onClose);
        }}
        className="space-y-3"
      >
        <Field label={t('trips.vehicle')} required>
          <Select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} required>
            <option value="">{t('common.select')}</option>
            {trucks.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plateNumber}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('trips.trailer')}>
          <Select value={trailerId} onChange={(event) => setTrailerId(event.target.value)}>
            <option value="">{t('common.select')}</option>
            {trailers.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plateNumber}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('trips.driver')} required>
          <Select value={driverId} onChange={(event) => setDriverId(event.target.value)} required>
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
        onSubmit={(event) => {
          event.preventDefault();
          void action
            .mutateAsync({ verb, body: value ? { [field]: Number(value) } : {} })
            .then(onClose);
        }}
        className="space-y-3"
      >
        <Field label={label}>
          <Input
            type="number"
            min="0"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
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
