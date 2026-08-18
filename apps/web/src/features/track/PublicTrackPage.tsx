import { useQuery } from '@tanstack/react-query';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet';
import { api } from '../../shared/api/client';
import { Card, Spinner } from '../../shared/ui';
import { formatDate, formatDateTime } from '../../shared/utils/date';

interface PublicTrackView {
  tripNumber: string;
  status: string;
  cargoName: string | null;
  loadingAddress: string | null;
  loadingDate: string | null;
  unloadingAddress: string | null;
  unloadingDate: string | null;
  stage: string | null;
  lastPosition: { lat: number; lng: number; recordedAt: string } | null;
}

/** TZ §4.2 — the cargo owner's login-free tracking page. */
export function PublicTrackPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['public-track', token],
    queryFn: async () => (await api<PublicTrackView>(`/public/track/${token}`)).data,
    refetchInterval: 60_000,
    retry: false,
  });

  return (
    <div className="min-h-screen bg-navy p-4 text-gray-100">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-center text-2xl font-extrabold">
          Truck<span className="text-accent-text dark:text-accent">Control</span> ·{' '}
          {t('track.title')}
        </h1>
        {isLoading && <Spinner />}
        {error != null && (
          <Card className="text-center text-danger-text dark:text-danger">
            {t('track.notFound')}
          </Card>
        )}
        {data && (
          <>
            <Card>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Info label="№">{data.tripNumber}</Info>
                <Info label={t('trips.status')}>{t(`status.${data.status}`)}</Info>
                <Info label={t('track.route')}>
                  {data.loadingAddress ?? '—'} → {data.unloadingAddress ?? '—'}
                </Info>
                <Info label={t('track.cargo')}>{data.cargoName ?? '—'}</Info>
                {data.stage && <Info label={t('track.stage')}>{t(`event.${data.stage}`)}</Info>}
                <Info label={t('trips.unloadingDate')}>{formatDate(data.unloadingDate)}</Info>
              </div>
            </Card>
            {data.lastPosition ? (
              <div className="h-96 overflow-hidden rounded-xl">
                <MapContainer
                  center={[data.lastPosition.lat, data.lastPosition.lng]}
                  zoom={8}
                  className="h-full w-full"
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <CircleMarker
                    center={[data.lastPosition.lat, data.lastPosition.lng]}
                    radius={10}
                    pathOptions={{ color: '#fff', weight: 2, fillColor: '#F5A623', fillOpacity: 1 }}
                  />
                </MapContainer>
              </div>
            ) : (
              <Card className="text-center text-muted-text dark:text-muted">
                {t('map.noPosition')}
              </Card>
            )}
            {data.lastPosition && (
              <p className="text-center text-xs text-muted-text dark:text-muted">
                {t('track.updated')}: {formatDateTime(data.lastPosition.recordedAt)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-text dark:text-muted">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
