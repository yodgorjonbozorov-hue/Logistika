import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from 'react-leaflet';
import { LiveStatus } from 'shared';
import { api } from '../../shared/api/client';
import type { Vehicle } from '../../shared/api/entities';
import { BRAND, Card, Input, PageHeader, SegmentedControl, Select, Spinner } from '../../shared/ui';
import { formatDateTime } from '../../shared/utils/date';

const TASHKENT: [number, number] = [41.3, 69.25];

const STATUS_COLORS: Record<LiveStatus, string> = {
  [LiveStatus.MOVING]: BRAND.success,
  [LiveStatus.RESTING]: BRAND.warning,
  [LiveStatus.BREAKDOWN]: BRAND.danger,
  [LiveStatus.IDLE]: BRAND.muted,
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
        subtitle={t('map.subtitle')}
        actions={
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={(['live', 'history'] as Mode[]).map((value) => ({
              value,
              label: t(`map.${value}`),
            }))}
          />
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

  if (isLoading) return <Spinner />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <Card className="shrink-0 self-start lg:w-56">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4 lg:grid-cols-1">
          {Object.values(LiveStatus).map((status) => (
            <li key={status} className="flex items-center gap-2 text-subhead">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[status] }}
              />
              <span className="min-w-0 flex-1 truncate text-ink-secondary">
                {t(`map.${status}`)}
              </span>
              <span className="font-mono font-semibold tabular-nums">{counts[status]}</span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="min-h-[420px] flex-1 overflow-hidden rounded-lg border border-line shadow-sm">
        <MapContainer
          center={TASHKENT}
          zoom={6}
          className="h-full w-full"
          style={{ minHeight: 420 }}
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
                  color: BRAND.white,
                  weight: 2,
                  fillColor: STATUS_COLORS[vehicle.status],
                  fillOpacity: 1,
                }}
              >
                <Popup>
                  <div className="space-y-1 text-subhead">
                    <div className="font-mono font-semibold">{vehicle.plateNumber}</div>
                    <div>{t(`map.${vehicle.status}`)}</div>
                    {vehicle.driverName && <div>{vehicle.driverName}</div>}
                    {vehicle.trip && (
                      <div>
                        №{vehicle.trip.tripNumber} · {vehicle.trip.cargoName ?? ''}
                      </div>
                    )}
                    {vehicle.lastPosition?.speed != null && (
                      <div>
                        {t('map.speed')}: {Math.round(vehicle.lastPosition.speed)} km/h
                      </div>
                    )}
                    {vehicle.deviationKm != null && vehicle.deviationKm > 20 && (
                      <div className="font-semibold text-danger">
                        {t('map.deviation')}: {vehicle.deviationKm} km
                      </div>
                    )}
                    <div className="text-caption text-ink-tertiary">
                      {t('map.lastSignal')}: {formatDateTime(vehicle.lastPosition?.recordedAt)}
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
        </MapContainer>
      </div>
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
      (
        await api<Array<{ lat: number; lng: number; recordedAt: string }>>(
          `/tracking/vehicles/${vehicleId}/history`,
          { query: { from, to } },
        )
      ).data,
  });

  const track: [number, number][] = (points ?? []).map((p) => [p.lat, p.lng]);
  const bounds = track.length > 1 ? L.latLngBounds(track) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Select
          aria-label={t('map.selectVehicle')}
          value={vehicleId}
          onChange={(e) => onVehicle(e.target.value)}
          className="w-56"
        >
          <option value="">{t('map.selectVehicle')}</option>
          {(vehicles ?? [])
            .filter((v) => v.type !== 'TRAILER')
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.plateNumber}
              </option>
            ))}
        </Select>
        <Input
          type="date"
          value={date}
          onChange={(e) => onDate(e.target.value)}
          className="w-44"
          aria-label={t('map.selectDate')}
        />
        {vehicleId && !isLoading && track.length === 0 && (
          <span className="self-center text-subhead text-ink-tertiary">{t('map.noTrack')}</span>
        )}
      </div>
      <div className="min-h-[420px] flex-1 overflow-hidden rounded-lg border border-line shadow-sm">
        <MapContainer
          center={TASHKENT}
          zoom={6}
          bounds={bounds}
          className="h-full w-full"
          style={{ minHeight: 420 }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {track.length > 1 && (
            <Polyline positions={track} pathOptions={{ color: BRAND.primary, weight: 4 }} />
          )}
          {track.length > 0 && (
            <CircleMarker
              center={track[track.length - 1]!}
              radius={8}
              pathOptions={{
                color: BRAND.white,
                weight: 2,
                fillColor: BRAND.success,
                fillOpacity: 1,
              }}
            />
          )}
        </MapContainer>
      </div>
    </div>
  );
}
