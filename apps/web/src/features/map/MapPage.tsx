import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from 'react-leaflet';
import { LiveStatus } from 'shared';
import { api } from '../../shared/api/client';
import type { Vehicle } from '../../shared/api/entities';
import { Badge, Card, Cell, MapSkeleton, PageHeader, Row, Select, Table } from '../../shared/ui';
import { formatDateTime } from '../../shared/utils/date';

const TASHKENT: [number, number] = [41.3, 69.25];

/** The list view's equivalent of the marker colours. */
const BADGE_TONES: Record<LiveStatus, 'green' | 'blue' | 'red' | 'gray'> = {
  [LiveStatus.MOVING]: 'green',
  [LiveStatus.RESTING]: 'blue',
  [LiveStatus.BREAKDOWN]: 'red',
  [LiveStatus.IDLE]: 'gray',
};

const STATUS_COLORS: Record<LiveStatus, string> = {
  [LiveStatus.MOVING]: '#2FAE6A',
  [LiveStatus.RESTING]: '#F5A623',
  [LiveStatus.BREAKDOWN]: '#E14B4B',
  [LiveStatus.IDLE]: '#8A94A6',
};

interface LiveVehicle {
  vehicleId: string;
  plateNumber: string;
  status: LiveStatus;
  trip: { id: string; tripNumber: string; cargoName: string | null } | null;
  driverName: string | null;
  lastPosition: { lat: number; lng: number; speed: number | null; recordedAt: string } | null;
  deviationKm: number | null;
}

type Mode = 'live' | 'history';

export function MapPage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('live');
  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('map.title')}
        actions={
          <div className="flex gap-1 rounded-lg border border-gray-300 p-0.5 dark:border-white/20">
            {(['live', 'history'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={
                  mode === m
                    ? 'rounded-md bg-accent px-3 py-1 text-sm font-semibold text-navy'
                    : 'px-3 py-1 text-sm text-muted-text dark:text-muted'
                }
              >
                {t(`map.${m}`)}
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
    refetchInterval: 30_000,
  });
  const vehicles = data ?? [];
  const counts = useMemo(() => {
    const map = { MOVING: 0, RESTING: 0, BREAKDOWN: 0, IDLE: 0 } as Record<LiveStatus, number>;
    for (const v of vehicles) map[v.status] += 1;
    return map;
  }, [vehicles]);

  /**
   * A map is a picture, and a picture is unreadable to a screen reader and
   * unreachable from a keyboard (L-10, TASK-5.5). The same data as a table is
   * not a lesser version — for "which trucks are stopped right now" it is
   * often the faster answer.
   */
  const [asList, setAsList] = useState(false);

  if (isLoading) return <MapSkeleton />;

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <Card className="w-52 shrink-0 self-start">
        <div className="mb-3 flex gap-1" role="group" aria-label={t('map.view')}>
          {(
            [
              ['map', false],
              ['list', true],
            ] as const
          ).map(([key, value]) => (
            <button
              key={key}
              onClick={() => setAsList(value)}
              aria-pressed={asList === value}
              className={
                asList === value
                  ? 'flex-1 rounded-lg bg-accent px-2 py-1 text-xs font-semibold text-navy'
                  : 'flex-1 rounded-lg px-2 py-1 text-xs text-muted-text hover:bg-gray-100 dark:text-muted dark:hover:bg-white/10'
              }
            >
              {t(`map.${key}View`)}
            </button>
          ))}
        </div>
        <ul className="space-y-2 text-sm">
          {Object.values(LiveStatus).map((status) => (
            <li key={status} className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[status] }}
              />
              <span className="flex-1">{t(`map.${status}`)}</span>
              <span className="font-semibold tabular-nums">{counts[status]}</span>
            </li>
          ))}
        </ul>
      </Card>
      {asList ? (
        <div className="min-w-0 flex-1">
          <Table
            headers={[
              t('map.plate'),
              t('map.status'),
              t('map.driver'),
              t('trips.title'),
              t('map.speed'),
              t('map.lastSignal'),
            ]}
          >
            {vehicles.map((vehicle) => (
              <Row key={vehicle.vehicleId}>
                <Cell className="font-semibold">{vehicle.plateNumber}</Cell>
                <Cell>
                  <Badge tone={BADGE_TONES[vehicle.status]}>{t(`map.${vehicle.status}`)}</Badge>
                </Cell>
                <Cell>{vehicle.driverName ?? '—'}</Cell>
                <Cell>{vehicle.trip?.tripNumber ?? '—'}</Cell>
                <Cell className="tabular-nums">
                  {vehicle.lastPosition?.speed != null
                    ? `${Math.round(vehicle.lastPosition.speed)} km/h`
                    : '—'}
                </Cell>
                <Cell>{formatDateTime(vehicle.lastPosition?.recordedAt)}</Cell>
              </Row>
            ))}
          </Table>
        </div>
      ) : (
        <div className="min-h-[480px] flex-1 overflow-hidden rounded-xl">
          <MapContainer
            center={TASHKENT}
            zoom={6}
            className="h-full w-full"
            style={{ minHeight: 480 }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {vehicles
              .filter((v) => v.lastPosition)
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
                      <div>{t(`map.${vehicle.status}`)}</div>
                      {vehicle.driverName && <div>{vehicle.driverName}</div>}
                      {vehicle.trip && (
                        <div>
                          {vehicle.trip.tripNumber} · {vehicle.trip.cargoName ?? ''}
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
          </MapContainer>
        </div>
      )}
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
  const { data: history, isLoading } = useQuery({
    queryKey: ['tracking', 'history', vehicleId, date],
    enabled: Boolean(vehicleId),
    queryFn: async () =>
      // The route arrives thinned to a couple of thousand points: more than
      // that cannot be seen on a polyline, and the unbounded version sent a
      // quarter of a million (TASK-4.1).
      (
        await api<{
          points: Array<{ lat: number; lng: number; recordedAt: string }>;
          totalPoints: number;
          truncated: boolean;
        }>(`/tracking/vehicles/${vehicleId}/history`, { query: { from, to } })
      ).data,
  });

  const track: [number, number][] = (history?.points ?? []).map((p) => [p.lat, p.lng]);
  const bounds = track.length > 1 ? L.latLngBounds(track) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex gap-3">
        <Select value={vehicleId} onChange={(e) => onVehicle(e.target.value)} className="w-56">
          <option value="">{t('map.selectVehicle')}</option>
          {(vehicles ?? [])
            .filter((v) => v.type !== 'TRAILER')
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.plateNumber}
              </option>
            ))}
        </Select>
        <input
          type="date"
          value={date}
          onChange={(e) => onDate(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-white/20 dark:bg-white/10"
          aria-label={t('map.selectDate')}
        />
        {vehicleId && !isLoading && track.length === 0 && (
          <span className="self-center text-sm text-muted-text dark:text-muted">
            {t('map.noTrack')}
          </span>
        )}
      </div>
      <div className="min-h-[480px] flex-1 overflow-hidden rounded-xl">
        <MapContainer
          center={TASHKENT}
          zoom={6}
          bounds={bounds}
          className="h-full w-full"
          style={{ minHeight: 480 }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {track.length > 1 && (
            <Polyline positions={track} pathOptions={{ color: '#F5A623', weight: 4 }} />
          )}
          {track.length > 0 && (
            <CircleMarker
              center={track[track.length - 1]!}
              radius={8}
              pathOptions={{ color: '#fff', weight: 2, fillColor: '#2FAE6A', fillOpacity: 1 }}
            />
          )}
        </MapContainer>
      </div>
    </div>
  );
}
