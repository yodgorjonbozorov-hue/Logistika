import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TripEventType } from 'shared';
import { api, apiUpload } from '../../shared/api/client';
import type { Trip, TripEvent } from '../../shared/api/entities';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from '../../shared/ui';
import { Icon, type IconName } from '../../shared/ui/icons';
import { formatDateTime } from '../../shared/utils/date';
import { formatTiyin } from '../../shared/utils/money';
import {
  applyBatchResult,
  clearRejected,
  loadQueue,
  pendingEvents,
  rejectedEvents,
  saveQueue,
  toPayload,
  type BatchResult,
  type QueuedEvent,
} from './offlineQueue';
import { useDriverGps } from './useDriverGps';

/** Buttons the driver sees, in the order the trip usually happens (TZ §3.1). */
const EVENT_BUTTONS: Array<{ type: TripEventType; icon: IconName }> = [
  { type: TripEventType.LOADED, icon: 'check' },
  { type: TripEventType.START, icon: 'play' },
  { type: TripEventType.REFUEL, icon: 'finance' },
  { type: TripEventType.CUSTOMS, icon: 'shield' },
  { type: TripEventType.REST, icon: 'clock' },
  { type: TripEventType.RESUME, icon: 'route' },
  { type: TripEventType.BREAKDOWN, icon: 'close' },
  { type: TripEventType.DELIVERED, icon: 'clients' },
];

function newId(): string {
  return crypto.randomUUID();
}

export function DriverTripPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const trips = useQuery({
    queryKey: ['trips', 'my'],
    queryFn: async () => (await api<Trip[]>('/trips/my')).data,
  });

  const trip = (trips.data ?? [])[0];
  const gps = useDriverGps(trip?.id);

  const [queue, setQueue] = useState<QueuedEvent[]>(() => loadQueue());
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [odometer, setOdometer] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => saveQueue(queue), [queue]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const events = useQuery({
    queryKey: ['events', trip?.id],
    queryFn: async () => (await api<TripEvent[]>('/events', { query: { tripId: trip!.id } })).data,
    enabled: Boolean(trip?.id),
  });

  const sync = useCallback(async () => {
    const pending = pendingEvents(loadQueue());
    if (pending.length === 0 || !navigator.onLine) return;
    setSyncing(true);
    setError(null);
    try {
      const { data } = await api<BatchResult>('/events/batch', {
        method: 'POST',
        body: { events: pending.map(toPayload) },
      });
      setQueue((current) => applyBatchResult(current, data));
      await queryClient.invalidateQueries({ queryKey: ['events'] });
      await queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
    } catch (err) {
      // Nothing is confirmed, so nothing leaves the queue.
      setError(err);
    } finally {
      setSyncing(false);
    }
  }, [queryClient]);

  // Anything queued goes out as soon as there is a connection again.
  useEffect(() => {
    if (online) void sync();
  }, [online, sync]);

  const startTrip = useMutation({
    mutationFn: async () =>
      (
        await api<Trip>(`/trips/${trip!.id}/start`, {
          method: 'POST',
          body: odometer ? { startOdometer: Number(odometer) } : {},
        })
      ).data,
    onSuccess: async () => {
      setNotice(t('driver.tripStarted'));
      setOdometer('');
      await queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
    },
  });

  const finishTrip = useMutation({
    mutationFn: async () =>
      (
        await api<Trip>(`/trips/${trip!.id}/complete`, {
          method: 'POST',
          body: odometer ? { endOdometer: Number(odometer) } : {},
        })
      ).data,
    onSuccess: async () => {
      setOdometer('');
      await queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => apiUpload<{ id: string }>('/files/upload', file),
    onSuccess: (stored) => setPhotoIds((current) => [...current, stored.id]),
  });

  function enqueue(eventType: TripEventType) {
    if (!trip) return;
    const fix = gps.current();
    const event: QueuedEvent = {
      clientEventId: newId(),
      tripId: trip.id,
      eventType,
      eventTime: new Date().toISOString(),
      lat: fix?.lat,
      lng: fix?.lng,
      odometer: odometer ? Number(odometer) : undefined,
      comment: comment || undefined,
      photoFileIds: photoIds.length > 0 ? photoIds : undefined,
      state: 'pending',
    };
    // Persist before syncing: sync() reads the queue from storage, and the
    // state-effect write would land after the send, so the fresh press would be
    // skipped until the next sync trigger.
    const next = [...loadQueue(), event];
    saveQueue(next);
    setQueue(next);
    setComment('');
    setOdometer('');
    setPhotoIds([]);
    setNotice(t('driver.eventSaved'));
    void sync();
  }

  async function onFinish() {
    if (!window.confirm(t('driver.confirmFinish'))) return;
    enqueue(TripEventType.FINISH);
    await finishTrip.mutateAsync().catch(() => undefined);
  }

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (trips.isLoading) return <Skeleton className="h-64" />;
  if (trips.error) return <ErrorMessage error={trips.error} />;

  const pending = pendingEvents(queue);
  const rejected = rejectedEvents(queue);

  if (!trip) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={t('driver.title')} />
        <EmptyState title={t('driver.noTrip')} hint={t('driver.noTripHint')} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={t('driver.title')} />

      {/* Connection + GPS status strip */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={online ? 'green' : 'red'}>
          {online ? t('driver.online') : t('driver.offline')}
        </Badge>
        <Badge tone={gps.state === 'on' ? 'green' : gps.state === 'blocked' ? 'red' : 'gray'}>
          {gps.state === 'on'
            ? t('driver.gpsOn')
            : gps.state === 'blocked'
              ? t('driver.gpsBlocked')
              : t('driver.gpsOff')}
        </Badge>
        {gps.lastSyncedAt ? (
          <span className="text-ink-2">
            {t('driver.lastSynced')}: {gps.lastSyncedAt.toLocaleTimeString()}
          </span>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => (gps.state === 'on' ? gps.stop() : gps.start())}
        >
          {gps.state === 'on' ? t('driver.gpsDisable') : t('driver.gpsEnable')}
        </Button>
      </div>

      {pending.length > 0 ? (
        <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
          <div className="font-medium text-accent">
            {t('driver.queued', { count: pending.length })}
          </div>
          <div className="mt-0.5 text-xs text-ink-2">{t('driver.queueNote')}</div>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={!online || syncing}
            onClick={() => void sync()}
          >
            {syncing ? t('driver.syncing') : t('driver.syncNow')}
          </Button>
        </div>
      ) : null}

      {rejected.length > 0 ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm">
          <div className="font-medium text-danger">
            {t('driver.queueRejected', { count: rejected.length })}
          </div>
          <div className="mt-0.5 text-xs text-ink-2">{t('driver.queueRejectedNote')}</div>
          <ul className="mt-1 text-xs text-ink-2">
            {rejected.map((event) => (
              <li key={event.clientEventId}>
                {t(`event.${event.eventType}`)} · {formatDateTime(event.eventTime)} ·{' '}
                {event.rejectedCode}
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => setQueue((current) => clearRejected(current))}
          >
            {t('common.close')}
          </Button>
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {notice}
        </div>
      ) : null}

      <ErrorMessage error={error ?? startTrip.error ?? finishTrip.error ?? upload.error} />

      {/* Trip card */}
      <Card>
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg font-bold">{trip.tripNumber}</span>
          <Badge tone={trip.status === 'IN_PROGRESS' ? 'orange' : 'blue'}>
            {t(`status.${trip.status}`)}
          </Badge>
        </div>
        <div className="mt-2 text-base font-medium">
          {trip.loadingAddress ?? '—'} → {trip.unloadingAddress ?? '—'}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase text-ink-2">{t('driver.cargo')}</dt>
            <dd>{trip.cargoName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-ink-2">{t('driver.client')}</dt>
            <dd>{trip.client?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-ink-2">{t('trips.vehicle')}</dt>
            <dd>
              {trip.vehicle
                ? `${[trip.vehicle.brand, trip.vehicle.model].filter(Boolean).join(' ')} · ${trip.vehicle.plateNumber}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-ink-2">{t('driver.advance')}</dt>
            <dd className="money">{formatTiyin(trip.driverAdvance)}</dd>
          </div>
        </dl>
      </Card>

      {/* Shared inputs for the next event */}
      <Card className="space-y-3">
        <Field label={t('driver.odometer')}>
          <Input
            type="number"
            inputMode="numeric"
            min="0"
            value={odometer}
            onChange={(event) => setOdometer(event.target.value)}
          />
        </Field>
        <Field label={t('driver.comment')}>
          <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
        </Field>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            disabled={!online || upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="camera" className="h-5 w-5" />
            {upload.isPending ? t('common.saving') : t('driver.photoAdd')}
          </Button>
          {photoIds.length > 0 ? (
            <p className="mt-1 text-xs text-success">
              {t('driver.photoCount', { count: photoIds.length })}
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-2">{t('driver.photo')}</p>
          )}
        </div>
      </Card>

      {trip.status === 'ASSIGNED' ? (
        <Button
          size="lg"
          className="w-full py-6 text-lg"
          disabled={startTrip.isPending}
          onClick={() => startTrip.mutate()}
        >
          <Icon name="play" className="h-6 w-6" />
          {t('driver.startTrip')}
        </Button>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {EVENT_BUTTONS.map((button) => (
              <Button
                key={button.type}
                variant="secondary"
                size="lg"
                className="h-16 flex-col gap-1 text-xs leading-tight"
                onClick={() => enqueue(button.type)}
              >
                <Icon name={button.icon} className="h-5 w-5" />
                {t(`event.${button.type}`)}
              </Button>
            ))}
          </div>
          <Button
            variant="danger"
            size="lg"
            className="w-full py-5"
            disabled={finishTrip.isPending}
            onClick={() => void onFinish()}
          >
            {t('event.FINISH')}
          </Button>
        </>
      )}

      <Card>
        <div className="mb-2 text-sm font-semibold">{t('driver.history')}</div>
        {(events.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-2">{t('common.empty')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {(events.data ?? [])
              .slice()
              .reverse()
              .map((event) => (
                <li key={event.id} className="flex items-start gap-2">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <span className="min-w-0">
                    <span className="block font-medium">{t(`event.${event.eventType}`)}</span>
                    <span className="block text-xs text-ink-2">
                      {formatDateTime(event.eventTime)}
                      {event.odometer != null ? ` · ${event.odometer} km` : ''}
                    </span>
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
