/**
 * AI-8 — what the daily digest is made of (TZ §8.9).
 *
 * Every number here is counted or summed by ordinary code. The model that words
 * the message receives this object and may use nothing else.
 */
export interface DigestFacts {
  /** Local calendar day the digest covers, "2026-08-16". */
  date: string;
  vehiclesOnRoad: number;
  vehiclesTotal: number;
  tripsFinished: number;
  tripsStarted: number;
  /** Money in tiyin, for the day itself. */
  revenueToday: bigint;
  expensesToday: bigint;
  profitToday: bigint;
  /** Open anomalies and unread alerts worth the boss's attention. */
  attention: Array<{ title: string; detail: string }>;
  /** Tomorrow: loadings booked and documents about to expire. */
  loadingsTomorrow: number;
  documentsExpiringSoon: number;
}

/** Nothing happened and nothing needs attention — not worth a message. */
export function isQuietDay(facts: DigestFacts): boolean {
  return (
    facts.vehiclesOnRoad === 0 &&
    facts.tripsFinished === 0 &&
    facts.tripsStarted === 0 &&
    facts.attention.length === 0 &&
    facts.loadingsTomorrow === 0 &&
    facts.documentsExpiringSoon === 0
  );
}

/**
 * Start and end of one local day, as UTC instants.
 *
 * The offset is read from the zone through Intl rather than assumed, so a
 * company in a zone with a different offset gets its own midnight — storage
 * stays UTC throughout (CLAUDE.md).
 */
export function localDayBounds(
  now: Date,
  timeZone: string,
): { from: Date; to: Date; date: string } {
  const date = localDateString(now, timeZone);
  const offsetMs = zoneOffsetMs(now, timeZone);
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - offsetMs);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000), date };
}

/** "2026-08-16" in the given zone. */
export function localDateString(now: Date, timeZone: string): string {
  return formatter(timeZone).format(now).slice(0, 10);
}

/** Local hour 0–23 in the given zone. */
export function localHour(now: Date, timeZone: string): number {
  return Number(formatter(timeZone).format(now).slice(11, 13));
}

/** How far the zone is ahead of UTC at this instant, in milliseconds. */
function zoneOffsetMs(now: Date, timeZone: string): number {
  const local = Date.parse(`${formatter(timeZone).format(now).replace(' ', 'T')}Z`);
  // Seconds are dropped by the formatter pattern, so compare on whole minutes.
  return local - Math.floor(now.getTime() / 60_000) * 60_000;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** "2026-08-16 20:00" in the zone; an unknown zone falls back to UTC. */
function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  let created: Intl.DateTimeFormat;
  try {
    created = buildFormatter(timeZone);
  } catch {
    // An unknown zone must not stop the digest; UTC is the honest fallback.
    created = buildFormatter('UTC');
  }
  formatters.set(timeZone, created);
  return created;
}

function buildFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** "20:00" → 20; anything unparseable falls back to the TZ default of 20:00. */
export function digestHour(digestTime: string): number {
  const match = /^(\d{1,2}):\d{2}$/.exec(digestTime.trim());
  const hour = match ? Number(match[1]) : NaN;
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 20;
}
