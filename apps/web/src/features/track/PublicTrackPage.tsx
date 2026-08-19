import { useQuery } from '@tanstack/react-query';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet';
import { TripStatus } from 'shared';
import { api } from '../../shared/api/client';
import { Card, EmptyBlock, Icon, Skeleton, StatusChip } from '../../shared/ui';
import { formatDate, formatDateTime } from '../../shared/utils/date';
import { TRIP_STATUS_TONE } from '../../shared/utils/status';

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

const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Only render a status we have a translation for; anything else is unknown. */
function knownStatus(status: string): TripStatus | null {
  return (Object.values(TripStatus) as string[]).includes(status) ? (status as TripStatus) : null;
}

/**
 * TZ §4.2 — the cargo owner's login-free tracking page.
 *
 * This is the one screen a customer sees, on a phone, usually from a link in a
 * message: single column, big status, map last. It carries no navigation
 * because the reader has no account and nowhere else to go.
 */
export function PublicTrackPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['public-track', token],
    queryFn: async () => (await api<PublicTrackView>(`/public/track/${token}`)).data,
    refetchInterval: 60_000,
    retry: false,
  });

  const status = data ? knownStatus(data.status) : null;

  return (
    <div className="tc-app-height overflow-y-auto bg-bg font-body text-sm text-ink">
      <div
        className="mx-auto flex w-full max-w-[640px] flex-col gap-3 px-4 pb-10 pt-5"
        style={{ paddingTop: 'calc(20px + env(safe-area-inset-top))' }}
      >
        <header className="mb-1 flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-accent text-accent"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}
          >
            <Icon name="truck" size={17} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold leading-tight">
              Truck<span className="text-accent">Control</span>
            </div>
            <div className="text-[11.5px] leading-tight text-neutral-500">{t('track.title')}</div>
          </div>
        </header>

        {isLoading ? (
          <>
            <Card className="px-4 py-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="mt-3 h-3.5 w-full" />
              <Skeleton className="mt-2 h-3.5 w-2/3" />
            </Card>
            <Skeleton className="h-[300px] rounded-md" />
          </>
        ) : error || !data ? (
          <Card>
            <EmptyBlock
              icon="link-break"
              title={t('track.notFound')}
              description={t('track.notFoundBody')}
            />
          </Card>
        ) : (
          <>
            <Card className="px-4 py-4">
              <div className="mb-3 flex flex-wrap items-center gap-2.5">
                <span className="text-[19px] font-semibold tabular-nums">{data.tripNumber}</span>
                {status ? (
                  <StatusChip tone={TRIP_STATUS_TONE[status]}>{t(`status.${status}`)}</StatusChip>
                ) : null}
              </div>

              <div className="flex flex-col gap-2.5">
                <Leg
                  icon="arrow-line-up-right"
                  label={t('trips.loadingAddress')}
                  place={data.loadingAddress}
                  at={data.loadingDate}
                />
                <Leg
                  icon="arrow-line-down-right"
                  label={t('trips.unloadingAddress')}
                  place={data.unloadingAddress}
                  at={data.unloadingDate}
                />
              </div>

              <div className="mt-3.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-divider pt-3">
                <Info label={t('track.cargo')}>{data.cargoName ?? '—'}</Info>
                {data.stage ? (
                  <Info label={t('track.stage')}>{t(`event.${data.stage}`)}</Info>
                ) : null}
              </div>
            </Card>

            {data.lastPosition ? (
              <>
                <div className="h-[300px] overflow-hidden rounded-md border border-neutral-800 md:h-[380px]">
                  <MapContainer
                    center={[data.lastPosition.lat, data.lastPosition.lng]}
                    zoom={8}
                    className="h-full w-full"
                  >
                    <TileLayer attribution={TILE_ATTRIBUTION} url={DARK_TILES} />
                    <CircleMarker
                      center={[data.lastPosition.lat, data.lastPosition.lng]}
                      radius={9}
                      pathOptions={{
                        color: 'var(--color-bg)',
                        weight: 2,
                        fillColor: 'var(--color-accent)',
                        fillOpacity: 1,
                      }}
                    />
                  </MapContainer>
                </div>
                <p className="m-0 text-center text-[11.5px] text-neutral-600">
                  {t('track.updated')}: {formatDateTime(data.lastPosition.recordedAt)}
                </p>
              </>
            ) : (
              <Card>
                <EmptyBlock icon="map-pin-line" title={t('map.noPosition')} />
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** One end of the route: where, and when it is due. */
function Leg({
  icon,
  label,
  place,
  at,
}: {
  icon: string;
  label: string;
  place: string | null;
  at: string | null;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon
        name={icon}
        size={16}
        className="mt-0.5 shrink-0"
        style={{ color: 'var(--color-accent)' }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] uppercase tracking-[0.06em] text-neutral-600">{label}</div>
        <div className="text-[14px]">{place ?? '—'}</div>
      </div>
      <div className="shrink-0 text-right text-[12px] tabular-nums text-neutral-400">
        {formatDate(at)}
      </div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-[0.06em] text-neutral-600">{label}</div>
      <div className="truncate text-[13px]">{children}</div>
    </div>
  );
}
