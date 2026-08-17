/**
 * Turns a database row into something an audit column can hold (TZ §9).
 *
 * Two jobs, and both matter. Money is BigInt and dates are Date objects —
 * neither survives a JSON column, so an audit write would fail on exactly the
 * records worth auditing. And a snapshot must never carry a secret: an audit
 * log is read by more people than the table it describes.
 */

/** Never copied into an audit entry, whatever the caller passes. */
const REDACTED_KEYS = new Set([
  'passwordHash',
  'password',
  'tokenHash',
  'codeHash',
  'refreshToken',
  'telegramChatId',
  'passport',
]);

/** Long free text is truncated: an audit row records the change, not the essay. */
const MAX_STRING = 500;

type Snapshot = Record<string, string | number | boolean | null>;

function toValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, MAX_STRING);
  if (value instanceof Date) return value.toISOString();
  // Prisma Decimal and anything else with a sane toString (never [object Object]).
  const text = String(value);
  return text === '[object Object]' ? undefined : text.slice(0, MAX_STRING);
}

/** A JSON-safe, secret-free copy of the fields worth recording. */
export function auditSnapshot(row: unknown, fields?: readonly string[]): Snapshot {
  if (typeof row !== 'object' || row === null) return {};
  const source = row as Record<string, unknown>;
  const keys = fields ?? Object.keys(source);

  const snapshot: Snapshot = {};
  for (const key of keys) {
    if (REDACTED_KEYS.has(key)) continue;
    if (!(key in source)) continue;
    const value = toValue(source[key]);
    if (value !== undefined) snapshot[key] = value;
  }
  return snapshot;
}

/**
 * Only what actually changed, as `{ field: { from, to } }`.
 * An update that changed one field should not read like a rewrite of the row.
 */
export function auditDiff(before: unknown, after: unknown): Snapshot {
  const from = auditSnapshot(before);
  const to = auditSnapshot(after);

  const changed: Snapshot = {};
  for (const key of Object.keys(to)) {
    if (from[key] === to[key]) continue;
    changed[key] = `${String(from[key] ?? '—')} → ${String(to[key] ?? '—')}`;
  }
  return changed;
}
