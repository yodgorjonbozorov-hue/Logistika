/**
 * Timestamps are stored in UTC (CLAUDE.md), but "today" for a logistics company
 * means today in ITS timezone — a trip opened at 02:00 Tashkent time must not
 * land in yesterday's KPI. These helpers translate a wall-clock day in a named
 * timezone into the UTC window the database is queried with.
 */

const PART_KEYS = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const;
type PartKey = (typeof PART_KEYS)[number];

function zonedParts(instant: Date, timeZone: string): Record<PartKey, number> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if ((PART_KEYS as readonly string[]).includes(part.type)) {
      parts[part.type] = Number(part.value);
    }
  }
  return parts as Record<PartKey, number>;
}

/** Offset of `timeZone` at `instant`, in milliseconds (east of UTC is positive). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Drop sub-second noise: formatToParts has no millisecond resolution.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** UTC window [from, to) covering the local calendar day that contains `instant`. */
export function zonedDayRange(instant: Date, timeZone: string): { from: Date; to: Date } {
  const p = zonedParts(instant, timeZone);
  const offset = zoneOffsetMs(instant, timeZone);
  const localMidnightAsUtc = Date.UTC(p.year, p.month - 1, p.day);
  const from = new Date(localMidnightAsUtc - offset);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

/** UTC instant of local midnight `days` days before the day containing `instant`. */
export function zonedDaysAgo(instant: Date, timeZone: string, days: number): Date {
  const { from } = zonedDayRange(instant, timeZone);
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

/** `YYYY-MM` bucket key of an instant in the given timezone (report grouping). */
export function zonedMonthKey(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}
