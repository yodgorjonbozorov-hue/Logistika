import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api/client';

/** Positions are batched, not streamed — one request per few minutes (TZ §3.1). */
const FLUSH_INTERVAL_MS = 3 * 60 * 1000;
const MAX_BUFFER = 200;

export type GpsState = 'off' | 'on' | 'blocked' | 'unsupported';

interface BufferedPosition {
  tripId: string;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  recordedAt: string;
}

export interface DriverGps {
  state: GpsState;
  lastFix: { lat: number; lng: number } | null;
  lastSyncedAt: Date | null;
  queued: number;
  start: () => void;
  stop: () => void;
  /** Latest coordinates for stamping an event, without waiting for a new fix. */
  current: () => { lat: number; lng: number } | null;
}

/**
 * Browser geolocation for the driver page. It keeps a buffer of positions and
 * flushes them to /tracking/positions; a failed flush keeps the buffer so the
 * points survive a tunnel.
 */
export function useDriverGps(tripId: string | undefined): DriverGps {
  const [state, setState] = useState<GpsState>(
    typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'off' : 'unsupported',
  );
  const [lastFix, setLastFix] = useState<{ lat: number; lng: number } | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [queued, setQueued] = useState(0);

  const watchId = useRef<number | null>(null);
  const buffer = useRef<BufferedPosition[]>([]);
  const tripRef = useRef(tripId);
  tripRef.current = tripId;

  const flush = useCallback(async () => {
    if (buffer.current.length === 0 || !navigator.onLine) return;
    const batch = buffer.current;
    buffer.current = [];
    setQueued(0);
    try {
      await api('/tracking/positions', { method: 'POST', body: { positions: batch } });
      setLastSyncedAt(new Date());
    } catch {
      // Put them back — losing a tunnel must not lose the track.
      buffer.current = [...batch, ...buffer.current].slice(-MAX_BUFFER);
      setQueued(buffer.current.length);
    }
  }, []);

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setState((current) => (current === 'on' ? 'off' : current));
  }, []);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState('unsupported');
      return;
    }
    if (watchId.current !== null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        setState('on');
        const fix = { lat: position.coords.latitude, lng: position.coords.longitude };
        setLastFix(fix);
        if (!tripRef.current) return;
        buffer.current = [
          ...buffer.current,
          {
            tripId: tripRef.current,
            ...fix,
            speed: position.coords.speed ?? undefined,
            heading: position.coords.heading ?? undefined,
            recordedAt: new Date(position.timestamp).toISOString(),
          },
        ].slice(-MAX_BUFFER);
        setQueued(buffer.current.length);
      },
      () => setState('blocked'),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [flush]);

  useEffect(() => stop, [stop]);

  return {
    state,
    lastFix,
    lastSyncedAt,
    queued,
    start,
    stop,
    current: () => lastFix,
  };
}
