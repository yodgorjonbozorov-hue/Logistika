/** Geometry helpers for tracking — deterministic plain code, no AI. */

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance (km) from a point to the straight corridor between route endpoints.
 * A cheap route-deviation heuristic until a real routing engine exists:
 * projects into a local equirectangular plane (fine at truck-route scales).
 */
export function distanceToSegmentKm(point: GeoPoint, start: GeoPoint, end: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const cosLat = Math.cos(toRad((start.lat + end.lat) / 2));
  const toXY = (p: GeoPoint) => ({
    x: toRad(p.lng) * cosLat * EARTH_RADIUS_KM,
    y: toRad(p.lat) * EARTH_RADIUS_KM,
  });
  const p = toXY(point);
  const a = toXY(start);
  const b = toXY(end);

  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const lengthSquared = abX * abX + abY * abY;
  if (lengthSquared === 0) return haversineKm(point, start);

  let t = ((p.x - a.x) * abX + (p.y - a.y) * abY) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const closest = { x: a.x + t * abX, y: a.y + t * abY };
  const dx = p.x - closest.x;
  const dy = p.y - closest.y;
  return Math.sqrt(dx * dx + dy * dy);
}
