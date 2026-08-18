import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from 'react-leaflet';
import { LiveStatus } from 'shared';
import { api } from '../../shared/api/client';
import { useLiveVehicles, useVehicles } from '../../shared/api/queries';
import {
  Button,
  Card,
  Icon,
  PageHeader,
  Segmented,
  Select,
  Spinner,
  StatusChip,
} from '../../shared/ui';
import { formatDateTime } from '../../shared/utils/date';
import { LIVE_STATUS_TONE } from '../../shared/utils/status';

const TASHKENT: [number, number] = [41.3, 69.25];

/** Marker fills read from the Nocturne ramps, not the browser's defaults. */
const STATUS_COLORS: Record<LiveStatus, string> = {
  [LiveStatus.MOVING]: '#9184d9',
  [LiveStatus.RESTING]: '#cfb27f',
  [LiveStatus.BREAKDOWN]: '#d98b84',
  [LiveStatus.IDLE]: '#75798c',
};

const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

type Mode = 'live' | 'history';

export function MapPage() {
  const [mode, setMode] = useState<Mode>('live');

  return (
    <div className="flex h-full flex-col">
      {mode === 'live' ? (
        <LiveMap mode={mode} onMode={setMode} />
      ) : (
        <HistoryMap mode={mode} onMode={setMode} />
      )}
    </div>
  );
}

function ModeHeader({
  mode,
  onMode,
  subtitle,
  onRefresh,
}: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  subtitle: string;
  onRefresh?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={t('map.title')}
      subtitle={subtitle}
      actions={
        <>
          <Segmented<Mode>
            value={mode}
            onChange={onMode}
            options={[
              { value: 'live', label: t('map.live') },
              { value: 'history', label: t('map.history') },
            ]}
          />
          {onRefresh ? (
            <Button variant="secondary" icon="arrows-clockwise" onClick={onRefresh}>
              {t('common.refresh')}
            </Button>
          ) : null}
        </>
      }
    />
  );
}

function LiveMap({ mode, onMode }: { mode: Mode; onMode: (mode: Mode) => void }) {
  const { t } = useTranslation();
  const { data, isLoading, refetch, dataUpdatedAt } = useLiveVehicles();
  const vehicles = useMemo(() => data ?? [], [data]);

  /** Route cards: distinct trip corridors currently being driven. */
  const routes = useMemo(() => {
    const map = new Map<string, { from: string; to: string; active: number }>();
    for (const vehicle of vehicles) {
      if (!vehicle.trip) continue;
      const key = vehicle.trip.tripNumber;
      const existing = map.get(key);
      if (existing) existing.active += 1;
      else
        map.set(key, { from: vehicle.plateNumber, to: vehicle.trip.cargoName ?? '—', active: 1 });
    }
    return [...map];
  }, [vehicles]);

  const counts = useMemo(() => {
    const totals = { MOVING: 0, RESTING: 0, BREAKDOWN: 0, IDLE: 0 } as Record<LiveStatus, number>;
    for (const vehicle of vehicles) totals[vehicle.status] += 1;
    return totals;
  }, [vehicles]);

  return (
    <>
      <ModeHeader
        mode={mode}
        onMode={onMode}
        onRefresh={() => void refetch()}
        subtitle={t('map.liveSubtitle', {
          count: vehicles.filter((v) => v.lastPosition).length,
          updated: dataUpdatedAt ? formatDateTime(new Date(dataUpdatedAt).toISOString()) : '—',
        })}
      />
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[290px_1fr]">
          <div className="flex flex-col gap-2 overflow-y-auto">
            <Card className="px-3.5 py-3">
              <div className="mb-2 text-[13px] font-medium">{t('map.statusBreakdown')}</div>
              <div className="flex flex-col gap-2">
                {Object.values(LiveStatus).map((status) => (
                  <div key={status} className="flex items-center gap-2 text-[12.5px]">
                    <StatusChip tone={LIVE_STATUS_TONE[status]}>{t(`map.${status}`)}</StatusChip>
                    <span className="ml-auto font-semibold tabular-nums">{counts[status]}</span>
                  </div>
                ))}
              </div>
            </Card>
            {routes.map(([tripNumber, route]) => (
              <Card key={tripNumber} className="cursor-pointer px-3.5 py-3">
                <div className="flex items-center gap-[7px] text-[13px] font-medium">
                  {route.from}
                  <Icon name="arrow-right" size={11} style={{ color: 'var(--color-accent)' }} />
                  {route.to}
                </div>
                <div className="mt-1 text-[11.5px] text-neutral-500">{tripNumber}</div>
                <div className="mt-[7px] text-[11.5px] text-accent-300">
                  {t('map.activeVehicles', { count: route.active })}
                </div>
              </Card>
            ))}
          </div>

          <div className="min-h-[480px] overflow-hidden rounded-md border border-neutral-800">
            <MapContainer
              center={TASHKENT}
              zoom={6}
              className="h-full w-full"
              style={{ minHeight: 480 }}
            >
              <TileLayer attribution={TILE_ATTRIBUTION} url={DARK_TILES} />
              {vehicles
                .filter((vehicle) => vehicle.lastPosition)
                .map((vehicle) => (
                  <CircleMarker
                    key={vehicle.vehicleId}
                    center={[vehicle.lastPosition!.lat, vehicle.lastPosition!.lng]}
                    radius={7}
                    pathOptions={{
                      color: '#161826',
                      weight: 2,
                      fillColor: STATUS_COLORS[vehicle.status],
                      fillOpacity: 1,
                    }}
                  >
                    <Popup>
                      <div className="flex flex-col gap-1 text-[12.5px]">
                        <span className="font-semibold">{vehicle.plateNumber}</span>
                        <span>{t(`map.${vehicle.status}`)}</span>
                        {vehicle.driverName ? <span>{vehicle.driverName}</span> : null}
                        {vehicle.trip ? (
                          <span className="text-accent-300">{vehicle.trip.tripNumber}</span>
                        ) : null}
                        {vehicle.lastPosition?.speed != null ? (
                          <span>
                            {t('map.speed')}: {Math.round(vehicle.lastPosition.speed)} km/h
                          </span>
                        ) : null}
                        {vehicle.deviationKm != null && vehicle.deviationKm > 20 ? (
                          <span className="font-semibold text-danger-text">
                            {t('map.deviation')}: {vehicle.deviationKm} km
                          </span>
                        ) : null}
                        <span className="text-neutral-500">
                          {t('map.lastSignal')}: {formatDateTime(vehicle.lastPosition?.recordedAt)}
                        </span>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
            </MapContainer>
          </div>
        </div>
      )}
    </>
  );
}

function HistoryMap({ mode, onMode }: { mode: Mode; onMode: (mode: Mode) => void }) {
  const { t } = useTranslation();
  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const vehicles = useVehicles();

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

  const track: [number, number][] = (points ?? []).map((point) => [point.lat, point.lng]);
  const bounds = track.length > 1 ? L.latLngBounds(track) : undefined;

  return (
    <>
      <ModeHeader mode={mode} onMode={onMode} subtitle={t('map.historySubtitle')} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          className="w-56"
          aria-label={t('map.selectVehicle')}
        >
          <option value="">{t('map.selectVehicle')}</option>
          {(vehicles.data ?? [])
            .filter((vehicle) => vehicle.type !== 'TRAILER')
            .map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plateNumber}
              </option>
            ))}
        </Select>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input w-auto"
          aria-label={t('map.selectDate')}
        />
        {vehicleId && !isLoading && track.length === 0 ? (
          <span className="self-center text-[13px] text-neutral-500">{t('map.noTrack')}</span>
        ) : null}
      </div>
      <div className="min-h-[480px] flex-1 overflow-hidden rounded-md border border-neutral-800">
        <MapContainer
          center={TASHKENT}
          zoom={6}
          bounds={bounds}
          className="h-full w-full"
          style={{ minHeight: 480 }}
        >
          <TileLayer attribution={TILE_ATTRIBUTION} url={DARK_TILES} />
          {track.length > 1 ? (
            <Polyline positions={track} pathOptions={{ color: '#9184d9', weight: 3 }} />
          ) : null}
          {track.length > 0 ? (
            <CircleMarker
              center={track[track.length - 1]!}
              radius={7}
              pathOptions={{
                color: '#161826',
                weight: 2,
                fillColor: '#9184d9',
                fillOpacity: 1,
              }}
            />
          ) : null}
        </MapContainer>
      </div>
    </>
  );
}
