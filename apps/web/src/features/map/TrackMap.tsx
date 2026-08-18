import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ReactNode } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer } from 'react-leaflet';
import type { GpsPoint } from '../../shared/api/entities';

export const TASHKENT: [number, number] = [41.3, 69.25];

export const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Shared map frame — one place to keep tile source, height and rounding consistent. */
export function MapFrame({
  children,
  bounds,
  center = TASHKENT,
  zoom = 6,
  className = 'min-h-[360px] sm:min-h-[480px]',
}: {
  children?: ReactNode;
  bounds?: L.LatLngBounds;
  center?: [number, number];
  zoom?: number;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-xl border border-line ${className}`}>
      <MapContainer
        center={center}
        zoom={zoom}
        bounds={bounds}
        scrollWheelZoom
        className="h-full w-full"
        style={{ minHeight: 360 }}
      >
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
        {children}
      </MapContainer>
    </div>
  );
}

/** Route polyline with a highlighted last point. */
export function TrackMap({ points, className }: { points: GpsPoint[]; className?: string }) {
  const track: Array<[number, number]> = points.map((point) => [point.lat, point.lng]);
  const bounds = track.length > 1 ? L.latLngBounds(track) : undefined;

  return (
    <MapFrame bounds={bounds} className={className}>
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
    </MapFrame>
  );
}
