import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CircleMarker, Popup } from 'react-leaflet';
import { LiveStatus } from 'shared';
import { api } from '../../shared/api/client';
import type { GpsPoint, LiveVehicle, Vehicle } from '../../shared/api/entities';
import { Card, Field, Input, PageHeader, Select, Skeleton } from '../../shared/ui';
import { cn } from '../../shared/utils/cn';
import { formatDateTime } from '../../shared/utils/date';
import { MapFrame, TrackMap } from './TrackMap';

const LIVE_POLL_MS = 30_000;

const STATUS_COLORS: Record<LiveStatus, string> = {
  [LiveStatus.MOVING]: '#2FAE6A',
  [LiveStatus.RESTING]: '#F5A623',
  [LiveStatus.BREAKDOWN]: '#E14B4B',
  [LiveStatus.IDLE]: '#8A94A6',
};

type Mode = 'live' | 'history';

export function MapPage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('live');
  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="flex min-h-0 flex-col">
      <PageHeader
        title={t('map.title')}
        subtitle={t('map.subtitle')}
        actions={
          <div className="flex gap-1 rounded-lg border border-line p-0.5">
            {(['live', 'history'] as Mode[]).map((value) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition',
                  mode === value
                    ? 'bg-accent font-semibold text-navy'
                    : 'text-ink-2 hover:text-ink',
                )}
              >
                {t(`map.${value}`)}
              </button>
            ))}
          </div>
        }
      />
      {mode === 'live' ? (
        <LiveMap />
      ) : (
        <HistoryMap vehicleId={vehicleId} onVehicle={setVehicleId} date={date} onDate={setDate} />
      )}
    </div>
  );
}

function LiveMap() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['tracking', 'live'],
    queryFn: async () => (await api<LiveVehicle[]>('/tracking/live')).data,
    refetchInterval: LIVE_POLL_MS,
  });
  const vehicles = useMemo(() => data ?? [], [data]);
  const counts = useMemo(() => {
    const map = { MOVING: 0, RESTING: 0, BREAKDOWN: 0, IDLE: 0 } as Record<LiveStatus, number>;
    for (const vehicle of vehicles) map[vehicle.status] += 1;
    return map;
  }, [vehicles]);

  if (isLoading) return <Skeleton className="h-96" />;

  return (
    <div className="grid gap-3 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="space-y-3">
        <Card>
          <ul className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-1">
            {Object.values(LiveStatus).map((status) => (
              <li key={status} className="flex items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[status] }}
                />
                <span className="min-w-0 flex-1 truncate">{t(`map.${status}`)}</span>
                <span className="font-semibold money">{counts[status]}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="hidden lg:block">
          <ul className="space-y-2 text-sm">
            {vehicles.map((vehicle) => (
              <li key={vehicle.vehicleId} className="border-b border-line pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[vehicle.status] }}
                  />
                  <span className="truncate font-semibold">{vehicle.plateNumber}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-ink-2">
                  {vehicle.driverName ?? t('common.notSet')}
                </div>
                {vehicle.trip ? (
                  <Link
                    to={`/trips/${vehicle.trip.id}`}
                    className="text-xs text-accent hover:underline"
                  >
                    {vehicle.trip.tripNumber}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <MapFrame className="min-h-[420px] sm:min-h-[560px]">
        {vehicles
          .filter((vehicle) => vehicle.lastPosition)
          .map((vehicle) => (
            <CircleMarker
              key={vehicle.vehicleId}
              center={[vehicle.lastPosition!.lat, vehicle.lastPosition!.lng]}
              radius={9}
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                fillColor: STATUS_COLORS[vehicle.status],
                fillOpacity: 1,
              }}
            >
              <Popup>
                <div className="space-y-1 text-sm">
                  <div className="font-bold">{vehicle.plateNumber}</div>
                  <div>
                    {t('map.status')}: {t(`map.${vehicle.status}`)}
                  </div>
                  {vehicle.driverName && (
                    <div>
                      {t('map.driver')}: {vehicle.driverName}
                    </div>
                  )}
                  {vehicle.trip && (
                    <div>
                      {t('map.trip')}: {vehicle.trip.tripNumber} · {vehicle.trip.cargoName ?? ''}
                    </div>
                  )}
                  {vehicle.lastPosition?.speed != null && (
                    <div>
                      {t('map.speed')}: {Math.round(vehicle.lastPosition.speed)} km/h
                    </div>
                  )}
                  {vehicle.deviationKm != null && vehicle.deviationKm > 20 && (
                    <div className="font-semibold text-red-600">
                      {t('map.deviation')}: {vehicle.deviationKm} km
                    </div>
                  )}
                  <div className="text-xs text-gray-500">
                    {t('map.lastSignal')}: {formatDateTime(vehicle.lastPosition?.recordedAt)}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          ))}
      </MapFrame>

      {/* Phones get the fleet as a list under the map instead of a side panel. */}
      <Card className="lg:hidden">
        <ul className="space-y-2 text-sm">
          {vehicles.map((vehicle) => (
            <li key={vehicle.vehicleId} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[vehicle.status] }}
              />
              <span className="min-w-0 flex-1 truncate">
                {vehicle.plateNumber} · {vehicle.driverName ?? t('common.notSet')}
              </span>
              <span className="shrink-0 text-xs text-ink-2">
                {vehicle.lastPosition ? formatDateTime(vehicle.lastPosition.recordedAt) : '—'}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function HistoryMap({
  vehicleId,
  onVehicle,
  date,
  onDate,
}: {
  vehicleId: string;
  onVehicle: (id: string) => void;
  date: string;
  onDate: (date: string) => void;
}) {
  const { t } = useTranslation();
  const { data: vehicles } = useQuery({
    queryKey: ['vehicles', 'ref'],
    queryFn: async () => (await api<Vehicle[]>('/vehicles', { query: { limit: 100 } })).data,
  });

  const from = new Date(`${date}T00:00:00`).toISOString();
  const to = new Date(`${date}T23:59:59`).toISOString();
  const { data: points, isLoading } = useQuery({
    queryKey: ['tracking', 'history', vehicleId, date],
    enabled: Boolean(vehicleId),
    queryFn: async () =>
      (await api<GpsPoint[]>(`/tracking/vehicles/${vehicleId}/history`, { query: { from, to } }))
        .data,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-56">
          <Field label={t('map.selectVehicle')}>
            <Select value={vehicleId} onChange={(event) => onVehicle(event.target.value)}>
              <option value="">{t('common.select')}</option>
              {(vehicles ?? [])
                .filter((vehicle) => vehicle.type !== 'TRAILER')
                .map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plateNumber}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <div className="w-full sm:w-44">
          <Field label={t('map.selectDate')}>
            <Input type="date" value={date} onChange={(event) => onDate(event.target.value)} />
          </Field>
        </div>
        {vehicleId && !isLoading && (points ?? []).length === 0 && (
          <span className="pb-2 text-sm text-ink-2">{t('map.noTrack')}</span>
        )}
      </div>
      <TrackMap points={points ?? []} className="min-h-[420px] sm:min-h-[560px]" />
    </div>
  );
}
