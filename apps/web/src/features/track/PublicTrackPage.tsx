import { useQuery } from '@tanstack/react-query';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet';
import { api } from '../../shared/api/client';
import { BRAND, Badge, Card, InfoItem, LogixaLogo, Spinner } from '../../shared/ui';
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
    // The tracking page is a brand surface: it always renders in the navy
    // palette, whatever theme the visitor's own device prefers.
    <div className="dark lx-route-grid min-h-screen bg-background px-4 py-8 text-ink">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="flex flex-col items-center gap-3 pb-2 text-center">
          <LogixaLogo tone="light" size="lg" />
          <span className="font-mono text-caption uppercase tracking-kicker text-ink-tertiary">
            {t('track.title')}
          </span>
        </header>

        {isLoading && <Spinner />}
        {error != null && (
          <Card className="text-center text-subhead text-ink-secondary">{t('track.notFound')}</Card>
        )}

        {data && (
          <>
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="font-mono text-headline font-semibold tabular-nums">
                  №{data.tripNumber}
                </span>
                <Badge tone="blue" dot={data.status === 'IN_PROGRESS'}>
                  {t(`status.${data.status}`)}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <InfoItem label={t('track.route')}>
                  {data.loadingAddress ?? '—'} → {data.unloadingAddress ?? '—'}
                </InfoItem>
                <InfoItem label={t('track.cargo')}>{data.cargoName ?? '—'}</InfoItem>
                {data.stage && (
                  <InfoItem label={t('track.stage')}>{t(`event.${data.stage}`)}</InfoItem>
                )}
                <InfoItem label={t('trips.unloadingDate')}>
                  {formatDate(data.unloadingDate)}
                </InfoItem>
              </div>
            </Card>

            {data.lastPosition ? (
              <div className="h-80 overflow-hidden rounded-lg ring-1 ring-line sm:h-96">
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
                    pathOptions={{
                      color: BRAND.white,
                      weight: 2,
                      fillColor: BRAND.primary,
                      fillOpacity: 1,
                    }}
                  />
                </MapContainer>
              </div>
            ) : (
              <Card className="text-center text-subhead text-ink-secondary">
                {t('map.noPosition')}
              </Card>
            )}

            {data.lastPosition && (
              <p className="text-center font-mono text-caption text-ink-tertiary">
                {t('track.updated')}: {formatDateTime(data.lastPosition.recordedAt)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
